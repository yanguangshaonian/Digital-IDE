# 本地开发（Windows）

## 统一构建规则（Windows / Linux）

- 要求 Node.js >= 22。Windows 执行根目录 build.bat；Linux 执行 `sh build.sh`；也可使用 `npm run build`。
- 默认执行 `npm ci`，然后检查运行资源、隔离编译、ESLint、Webpack 打包、VSIX 打包和包内资源校验。依赖已安装时可传 `--skip-install`。
- 工具使用 package-lock.json 锁定的本地版本，不依赖全局 webpack 或 vsce。
- 运行资源必须预先准备齐全且与当前插件版本匹配，包括全部支持平台的语言服务器和完整波形、网表资源。缺少关键资源立即失败，不生成缺资源的包，也不自动从本机安装版复制。
- 网络受限时设置 HTTP_PROXY、HTTPS_PROXY；npm 可设置 npm_config_proxy、npm_config_https_proxy。脚本不硬编码代理。
- 编译与暂存位于 dist/compiled、dist/stage，不删除或覆盖开发调试使用的 out。
- 最终产物为 dist/fpga-support-版本号.vsix。通过 ZIP 内容校验后才替换最终产物；失败时返回非零退出码。
- 使用暂存目录的运行资源白名单，不使用旧 .vscodeignore 中排除服务器、JS、WASM 的规则。生成的本机 Vivado 启动脚本不打包。
- 不自动安装、卸载、发布插件，不修改源码版本号。旧 scripts/build.bat 转发到统一入口；旧 Python 打包流程不作为标准构建方式。

## Vivado 2018.3 中文安装路径修复

启动和刷新 Tcl 现使用纯 ASCII 包装，在 Tcl 内显式解码 UTF-8；刷新通过标准 Tcl open/read/eval 加载，避免 Vivado source 包装器对空格路径的再次解析。设计顶层与仿真顶层状态也已分离。

已通过 Vivado 2018.3 的独立内存工程回归：中文、空格、方括号和美元符号的脚本目录加载成功；实际测试工程的两个 HDL 和 XDC 成功导入，顶层分别为 led_blink、tb_led_blink。HDL 文件自身的路径仍受 Vivado 支持范围限制。

回归脚本：scripts/test-vivado-encoding.cjs；编译后用 Node 执行，参数为 Vivado 官方 vivado.bat 路径。测试自动创建独立的设计源、仿真源及约束，在内存工程中验证导入、顶层、加载器变量隔离和错误传播，不依赖个人工程或固定器件，不修改原 XPR。脚本目录包含中文和特殊字符；HDL 目录默认在 out 下，可用 DIDE_TEST_HDL_ROOT 指定 Vivado 支持的现有目录。执行超时为 120 秒。

源码修复不会自动替换市场安装版，需在开发宿主中运行本仓库。

## 环境与依赖

- 使用 Node.js 22 LTS（本机验证版本：22.23.2，npm 10.9.8）。
- VS Code 最低版本由 package.json 的 engines.vscode 指定。
- 安装依赖使用 `npm ci`；仅在有意调整依赖时使用 `npm install`，并提交锁文件。
- 本机 Node.js 安装在当前用户的 LocalAppData/Programs 下，已加入用户 PATH。安装后需完全退出并重新启动 VS Code，使构建任务继承新 PATH。
- 网络受限时可在安装依赖的终端设置 HTTP_PROXY、HTTPS_PROXY 为 `http://127.0.0.1:7897`，并给 npm 传入 `--proxy=http://127.0.0.1:7897`。不要将个人代理写入共享配置。

## 运行资源

源码仓库不包含完整的预编译运行资源。首次调试前需要准备：

- resources/dide-lsp/server：语言服务器，Windows x64 使用 digital-lsp-x86_64-win.exe。
- resources/dide-viewer/view：波形查看器。
- resources/dide-netlist/static 和 resources/dide-netlist/view：网表工具与界面。
- resources/script：工具脚本。

本机已从安装的 sterben.fpga-support-0.4.6 扩展复制上述资源，与当前项目版本一致。大部分资源被 Git 忽略，不应作为本次环境配置提交。更换插件版本后需要重新确认资源兼容性。此方式不需要编译 Rust，但无法修改语言服务器或查看器内部实现；后续涉及这些组件时，需要对应的源码仓库与工具链。

## 编译与调试

1. 完全重启 VS Code 后，打开此仓库（也支持当前多根工作区）。
2. 在“运行和调试”中选择属于 Digital-IDE 的 **Run Extension**，按 F5。
3. 默认构建任务运行 `npm run watch`，将 TypeScript 编译到 out 并生成 source map。
4. 在新开的 Extension Development Host 窗口中打开 FPGA 测试工程，而不是扩展源码目录。当前可使用 V:/fpga_project2/01_mux2。
5. 在源码窗口设置断点，在开发宿主中打开 Verilog/SystemVerilog 文件或执行 Digital IDE 命令触发功能。
6. 修改 TypeScript 后等待 watch 编译完成，再在开发宿主中执行“Developer: Reload Window”加载新代码。

单次编译使用 `npm run compile`，代码检查使用 `npm run lint`。调试输出查看源码窗口的 Debug Console，以及开发宿主的 Output 面板。

## 当前验证结果与限制

- `npm ci`：通过；已修复原锁文件与依赖声明不一致的问题。
- `npm run compile`：通过。
- `npm run lint`：0 个错误，85 个现有警告。
- 依赖安装报告 30 项漏洞（5 low、6 moderate、16 high、3 critical）。需要单独评估，未执行破坏性自动升级。
- 仓库没有 src/test 测试入口，现有 `npm test` 和 Extension Tests 配置尚不能用于有效测试。
- 当前是源码开发环境，不代表发布打包流程已验证。webpack 配置读取 out-js，而默认编译输出到 out；发布前需要单独梳理打包脚本。
- GUI 下的 F5 激活、波形和仿真功能需要在开发宿主中进一步验证。
- Vivado、Icarus Verilog 等外部工具的安装路径仍由 FPGA 工程和本机配置决定，本次未修改。