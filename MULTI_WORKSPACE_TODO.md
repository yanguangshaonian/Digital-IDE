# 多工作区隔离与资源生命周期整改

记录日期：2026-09-07。依据源码审查；风险不等同于已在真实 Vivado 环境复现。

## 执行规则

- 每次只将一个整改项标记为进行中。
- 修复后记录修改范围、验证证据及剩余限制，再标记已解决。
- 单元测试通过不能替代实际扩展宿主或 Vivado 集成验证。
- 修改代码后执行编译、回归测试、打包并核验 VSIX 内容及更新时间。
- 未经明确要求，不启动或关闭用户真实 Vivado 会话；不自动提交或推送。

## 多项目 property.json 设计

- 项目身份使用最近祖先 `.vscode/property.json` 的规范化 URI，而不是仅使用 VS Code workspace 根目录。
- 同一 `property.json` 下的文件必须复用同一项目上下文，不重复创建解析器、监视器、LSP 或 Vivado 管理器。
- 查找边界是当前 VS Code workspace 根；不会越过 workspace 读取外部目录的配置。
- 资源管理器右键创建时，目标是实际选中的文件夹；选中文件时目标为文件所在文件夹，不回退到 workspace 根。
- 当前批次已加入查找和创建路径代码，但 LSP/硬件会话按 property URI 的完整去重尚未完成，需单独测试后再标记完成。
- 当前批次已完成 projectKey 去重：不同文件向上找到同一 property.json 时复用项目准备队列；test-project-locator.cjs 已通过。实际多项目宿主集成仍需验证。

## 待办

- [x] 01【已解决】按 workspace URI 保存硬件管理器，切换编辑器不退出旧会话；Xilinx 核心路径和顶层绑定管理器所属配置。返回该工作区重新绑定配置；停用遍历受管会话。独立会话测试通过，真实 Vivado 并行集成尚未执行。
- [x] 02【已解决】退出超时拒绝 Promise，保留进程引用，阻止切换流程继续替换管理器；允许再次退出。测试 test-vivado-exit-timeout.cjs 已通过。
- [x] 03【已解决】退出回调路径隔离：启动请求在首次 await 前捕获不可变路径快照，进程关闭回调显式传递；onVivadoClose 不再读取全局 opeParam。
- [ ] 04【待解决】硬件命令已按资源 URI 进入工作区队列，Launch 已返回 Promise；仍需完善 Exit 的显式会话选择、工具链配置改变及全入口异步审计。
- [ ] 05【进行中】编译及 vvp 已返回可等待的 Promise，固定 vvp 工作目录，去除无等待递归重跑；仍需覆盖取消、长任务、终端模式及子进程测试。
- [ ] 06【待解决】文件监视回调隔离：跟踪在途异步任务，切换前 drain 或通过 generation 校验阻止旧结果污染新项目。
- [ ] 07【待解决】初始化失败恢复：区分 selected/initializing/ready/failed，禁止仅凭路径相同跳过未完成初始化。
- [ ] 08【待解决】切换请求管理：合并过时编辑器切换请求，保留显式命令请求，执行前复核目标工作区存在性，处理根目录移除。
- [ ] 09【待解决】扩展停用收尾：停止接收任务、清理监听器与监视器、处理队列及受管进程，返回清理 Promise。
- [x] 10【已解决】已删除无调用点的 closeAllWindows 及其 killProcess 导入，移除按名称终止所有 srcscanner 和按当前全局目录删除记录文件的路径；完整构建通过。
- [x] 11【已解决】脚本迁移到工作区 .digital-ide/vivado/session-* 唯一目录，每条请求有唯一序号，进程关闭后仅清理自己目录；source/delete 使用安全引用。会话脚本唯一性测试、编译通过；真实 Tcl 运行未验证。
- [ ] 12【待解决】补充多工作区回归测试：覆盖启动中切换、退出超时后切换、延迟关闭回调、监视回调、初始化失败恢复、真实仿真异步回调及停用。

## 审查定位

- 工作区切换：src/extension.ts、src/manager/workspaceContext.ts。
- 硬件命令及会话：src/manager/index.ts、src/manager/PL/index.ts、src/manager/PL/xilinx.ts。
- 仿真进程：src/function/sim/simulate.ts。
- 文件监视：src/monitor/event.ts、src/monitor/index.ts、src/monitor/propery.ts。
- 已有 LSP 监听器 dispose/drain 与生命周期队列应保留，不应以全面回滚替代整改。

## 解决记录

### 实际启动日志回归 — 2026-09-07 23:47

- 用户日志与磁盘配置确认 02_mux2 使用 template/device none；不是安装路径错误。未替用户修改器件型号。
- 新建项目时拒绝空 device/none，显示项目配置入口，不启动进程。
- 启动 Tcl catch 输出 DIDE_LAUNCH_READY 或 DIDE_LAUNCH_FAILED；仅完成标记确认为就绪，横幅/进程存活不再冒充工程成功；等待超时保留进程供 Exit。
- 删除把工程初始化错误归因安装路径的弹窗，失败状态阻止非 Exit 命令。
- test-vivado-invalid-part.cjs 验证 none 时不创建目录/进程；编译、会话及退出回归通过。完整构建包时间 23:47:11，包内校验关键标记通过。
- 未运行真实 Vivado 启动，本记录不意味着全部状态机/并行集成测试完成。

### 持续整改进度 — 独立会话批次

- 01：hardwareSessions 按 URI 保留会话，切换不再 exit；Xilinx 会话路径/配置/顶层不跟随其他工作区全局对象，返回时 bindActiveProject。
- 04：硬件命令进入目标 URI 的共享队列，Launch 返回真实 Promise。仍需工具链变更、全部异步入口及资源树项输入兼容审计，不标完成。
- 08：根目录移除新增串行清理，停止当前解析/监视，关闭对应受管会话；超时保留引用。仍需明确可供用户操作的失联会话 UI。
- 11：每会话独立目录，每请求唯一序号，避免排队脚本互相覆盖；进程关闭只删自身目录。修复 build 脚本自我 source 递归。
- 新测试 test-vivado-session.cjs：跨根路径与顶层隔离、错误根阻止、唯一脚本、编辑器切换不 exit。
- 新测试 test-monitor-drain.cjs：等待在途回调、丢弃关闭后/旧 watcher 事件。
- 新测试 test-icarus-lifecycle.cjs：编译期间全局根改变后 vvp 仍使用 A 的 cwd，Promise 等待 vvp 完成，路径安全引用。
- 编译及上述测试通过；再次执行完整打包。未做真实 Vivado 并行/退出集成验证，05/06/07/08/09/12 不因部分用例通过而标全部完成。

### 持续整改进度 — 2026-09-07 23:16

- 02：超时测试验证拒绝、保留进程、移除 close listener、清除退出 Promise；既有退出和路径快照测试通过。
- 06 部分：监视事件串行跟踪，close 停止接收并 drain；尚需覆盖手动配置更新和监视重建测试。
- 07 部分：单独记录成功初始化的 workspace URI，失败后不再仅凭全局路径跳过；启动 gate 可拒绝。
- 08 部分：合并过时编辑器请求，保留显式任务，执行前复核根存在；尚缺工作区移除事件完整处理。
- 09 部分：停用停止队列并等待 watcher、PL、LSP；长任务取消和全部会话关闭待完善。
- test-simulation-workspace.cjs 新增合并请求及停止后拒绝的测试，已通过；TypeScript 编译通过。
- 最新 VSIX 更新时间 23:16:08，已核验队列及退出超时代码。不是全部事项完成版本，未实际运行 Vivado 集成测试。

### 03 — 2026-09-07

- 修改：src/manager/PL/xilinx.ts；启动时捕获 workspacePath、plName、targetPath，close 回调使用局部快照。
- 测试：scripts/test-vivado-close-workspace.cjs 执行真实退出清理方法，任何全局上下文读取直接报错；验证四次 IP/BD 迁移均只指向 A 项目。另运行既有 test-vivado-exit.cjs。
- 构建：完整构建脚本执行，VSIX 包内已核验 onVivadoClose(closePaths)，更新时间 2026-09-07 23:04:33。
- 限制：未操作真实 Vivado；本项仅消除退出清理读取其他工作区路径的问题。自定义/外部 XPR 路径映射沿用原实现；启动期间跨工作区、退出超时及独立会话仍由 01、02、04、11 项继续处理。
