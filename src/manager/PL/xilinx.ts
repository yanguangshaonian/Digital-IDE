/* eslint-disable @typescript-eslint/naming-convention */
import * as vscode from 'vscode';
import { ChildProcessWithoutNullStreams, exec, spawn } from 'child_process';
import * as fspath from 'path';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';

import { AbsPath, opeParam, PrjInfo } from '../../global';
import { hdlParam } from '../../hdlParser/core';
import { hdlFile, hdlDir, hdlPath } from '../../hdlFs';
import { PropertySchema } from '../../global/propertySchema';

import { XilinxIP } from '../../global/enum';
import { HardwareOutput, MainOutput, ReportType } from '../../global/outputChannel';
import { debounce, getPIDsWithName, killProcess } from '../../global/util';
import { t } from '../../i18n';
import { HdlFileProjectType } from '../../hdlParser/common';
import { encodeTclScript, loadTclScript, quoteTcl } from './tcl';

interface XilinxCustom {
    ipRepo: AbsPath, 
    bdRepo: AbsPath
};

interface TopMod {
    src: string, 
    sim: string
};

// Programmable Logic Context for short
interface PLContext {
    // 保留启动上下文
    terminal? : vscode.Terminal,
    // 目前使用的启动上下文
    process?: ChildProcessWithoutNullStreams,
    // 工具类型
    tool? : string,
    // 第三方工具运行路径
    path? : string,
    // 操作类
    ope : Record<string, any>
};

interface PLPrjInfo {
    path : AbsPath,
    name : string,
    device : string
};

interface BootInfo {
    outsidePath : AbsPath,
    insidePath : AbsPath,
    outputPath : AbsPath,
    elfPath : AbsPath,
    bitPath : AbsPath,
    fsblPath : AbsPath
};

/**
 * xilinx operation under PL
 */
class XilinxOperation {
    guiLaunched: boolean;
    guiPid: number;
    private diagnosticProjectPath = '';
    constructor() {
        this.guiLaunched = false;
        this.guiPid = -1;

        HardwareOutput.report(`========== Vivado 操作管理器初始化（尚未启动工具） ==========\n工作区：${opeParam.workspacePath}\n插件目录：${opeParam.extensionPath}`, { level: ReportType.Info });
    }

    public get xipRepo(): XilinxIP[] {
        return opeParam.prjInfo.IP_REPO; 
    }

    public get xipPath(): AbsPath {
        return hdlPath.join(opeParam.extensionPath, 'IP_repo');
    }

    public get xbdPath(): AbsPath {
        return hdlPath.join(opeParam.extensionPath, 'library', 'Factory', 'xilinx', 'bd');
    }

    public get xilinxPath(): AbsPath {
        return hdlPath.join(opeParam.extensionPath, 'resources', 'script', 'xilinx');
    }

    public get prjPath(): AbsPath {
        return opeParam.prjInfo.arch.prjPath;
    }

    public get srcPath(): AbsPath {
        return opeParam.prjInfo.arch.hardware.src;
    }

    public get simPath(): AbsPath {
        return opeParam.prjInfo.arch.hardware.sim;
    }

    public get datPath(): AbsPath {
        return opeParam.prjInfo.arch.hardware.data;
    }

    public get softSrc(): AbsPath {
        return opeParam.prjInfo.arch.software.src;
    }

    public get HWPath(): AbsPath {
        return fspath.dirname(this.srcPath);
    }

    public get extensionPath(): AbsPath {
        return opeParam.extensionPath;
    }

    public get prjConfig(): PrjInfo {
        return opeParam.prjInfo;
    }

    public get custom(): XilinxCustom {
        return {
            ipRepo: vscode.workspace.getConfiguration().get('digital-ide.prj.xilinx.IP.repo.path', ''),
            bdRepo: vscode.workspace.getConfiguration().get('digital-ide.prj.xilinx.BD.repo.path', '')
        };
    }
    
    public get topMod(): TopMod {
        return {
            src : opeParam.firstSrcTopModule.name,
            sim : opeParam.firstSimTopModule.name,
        };
    }

    public get prjInfo(): PLPrjInfo {
        return {
            path : hdlPath.join(this.prjPath, 'xilinx'),
            name : opeParam.prjInfo.prjName.PL,
            device : opeParam.prjInfo.device
        };
    }

    /**
     * xilinx下的launch运行，打开存在的工程或者再没有工程时进行新建
     * @param context
     */
    public async launch(context: PLContext): Promise<string | undefined> {
        HardwareOutput.report(`收到 Vivado 启动请求；工程搜索目录：${this.prjPath}；原进程 PID：${context.process?.pid ?? '无'}；原进程退出码：${context.process?.exitCode ?? '未退出或无进程'}`, { level: ReportType.Info });
        this.guiLaunched = false;
        this.guiPid = -1;

        let scripts: string[] = [];
        let prjFilePath = this.prjPath as AbsPath;
        // 找到所有的 xilinx 工程文件
        const prjFiles = hdlFile.pickFileRecursive(prjFilePath, 
            filePath => filePath.endsWith('.xpr')
        );
        HardwareOutput.report(`工程搜索目录：${prjFilePath}；发现 ${prjFiles.length} 个 Vivado 工程`, { level: ReportType.Info });

        if (prjFiles.length) {
            if (prjFiles.length > 1) {
                const selection = await vscode.window.showQuickPick(prjFiles, {
                    placeHolder : t('info.pl.xilinx.launch.pick-project-placeholder'),
                    canPickMany: false
                });
                if (selection) {
                    this.open(selection, scripts);
                } else {
                    HardwareOutput.report('用户取消工程选择，本次启动已取消。', { level: ReportType.Info });
                    return undefined;
                }
            } else {
                prjFilePath = prjFiles[0];
                this.open(prjFilePath, scripts);
            }
        } else {
            if (!hdlDir.mkdir(this.prjInfo.path)) {
                HardwareOutput.report(`启动中止：创建工程目录失败：${this.prjInfo.path}`, { level: ReportType.Error });
                vscode.window.showErrorMessage(`创建工程目录失败：${this.prjInfo.path}`);
                return undefined;
            }

            this.create(scripts);
        }

        const tclPath = hdlPath.join(this.xilinxPath, 'launch.tcl');
        scripts.push(this.getRefreshXprDesignSourceCommand());
        scripts.push(`file delete -force ${quoteTcl(tclPath)}`);
        const tclCommands = scripts.join('\n') + '\n';
        const launchScriptWritten = hdlFile.writeFile(tclPath, encodeTclScript(tclCommands));
        HardwareOutput.report(`启动脚本写入${launchScriptWritten ? '完成' : '失败'}：${tclPath}\n计划启动命令：\n${tclCommands}`, { level: launchScriptWritten ? ReportType.Info : ReportType.Error });

        const argu = `-notrace -nolog -nojournal`;
        context.path = this.updateVivadoPath();
        const cmd = `${context.path} -mode tcl -s "${tclPath}" ${argu}`;
        HardwareOutput.report(`启动脚本：${tclPath}\n脚本编码：ASCII 包装 / UTF-8 解码\n执行命令：${cmd}\n注意：收到进程输出不代表工程初始化完成，请检查后续 Vivado 输出。`, { level: ReportType.Info });
        
        const _this = this;
        
        const onVivadoClose = debounce(() => {
            _this.onVivadoClose();
        }, 100);

        function launchScript(pids: number[]): Promise<ChildProcessWithoutNullStreams | undefined> {
            if (!opeParam.workspacePath) {
                HardwareOutput.report('启动中止：工作区路径为空，未创建 Vivado 进程。', { level: ReportType.Error });
                return Promise.resolve(undefined);
            }

            const vivadoPids = new Set<number>(pids);
            const vivadoProcess = spawn(cmd, [], { shell: true, stdio: 'pipe', cwd: opeParam.workspacePath });
            HardwareOutput.report(`已请求创建 Vivado 启动进程；Shell PID：${vivadoProcess.pid ?? '尚未分配'}；工作目录：${opeParam.workspacePath}；工程：${_this.diagnosticProjectPath}。尚未确认工程加载成功。`, { level: ReportType.Info });
            let status: 'pending' | 'fulfilled' = 'pending';

            vivadoProcess.on('close', () => {
                HardwareOutput.report(`Vivado 启动进程通道已关闭；PID：${vivadoProcess.pid ?? '未知'}`, { level: ReportType.Info });
                onVivadoClose();            
            });
            vivadoProcess.on('exit', (code, signal) => {
                HardwareOutput.report(`Vivado 启动进程已退出：退出码=${code}，信号=${signal ?? '无'}`, {
                    level: code === 0 ? ReportType.Info : ReportType.Error
                });
                onVivadoClose();
            });
            vivadoProcess.on('disconnect', () => {
                HardwareOutput.report(`Vivado 启动进程连接已断开；PID：${vivadoProcess.pid ?? '未知'}`, { level: ReportType.Warn });
                onVivadoClose();
            });

            return new Promise(resolve => {
                vivadoProcess.once('error', error => {
                    HardwareOutput.report(`无法启动 Vivado 进程：${error.message}\n执行命令：${cmd}`, { level: ReportType.Error });
                    resolve(undefined);
                });
                vivadoProcess.once('close', () => resolve(undefined));
                vivadoProcess.stdout.on('data', async data => {
                    const message: string = _this.handleMessage(_this.decodeVivadoOutput(data), status);
                    if (status === 'pending') {
                        HardwareOutput.show();
                        const pids = await getPIDsWithName('vivado');
                        const newPid = pids.find(p => !vivadoPids.has(p));
                        if (newPid) {
                            _this.guiPid = newPid;
                        }
                        HardwareOutput.report(`Vivado 进程已响应；检测到的 Vivado PID：${newPid ?? '未识别'}。工程加载结果请查看下方输出。`, { level: ReportType.Info });
                        resolve(vivadoProcess);
                    }
                    HardwareOutput.report(message, {
                        level: ReportType.Info
                    });
                    status = 'fulfilled';
                });

                vivadoProcess.stderr.on('data', async data => {
                    HardwareOutput.report(_this.decodeVivadoOutput(data), {
                        level: ReportType.Error
                    });
                    HardwareOutput.show();
                    if (status === 'pending') {
                        // pending 阶段就出现 stderr 说明启动失败
                        HardwareOutput.report('启动待响应阶段收到标准错误；当前启动流程将返回无可用进程。具体原因请查看 Vivado 原始输出，不能仅据此判定安装路径错误。', { level: ReportType.Warn });
                        resolve(undefined);

                        const vivadoInstallPath = vscode.workspace.getConfiguration('digital-ide').get<string>('prj.vivado.install.path') || '';
                        
                        const res = await vscode.window.showErrorMessage(
                            t('error.pl.launch.not-valid-vivado-path', _this.decodeVivadoOutput(data), vivadoInstallPath.toString()),
                            {
                                title: t('info.pl.launch.set-vivado-path'),
                                value: true
                            }
                        );
                        if (res?.value) {
                            await vscode.commands.executeCommand('workbench.action.openSettings', 'digital-ide.prj.vivado.install.path');
                        }
                    }
                });
            });
        }

        const process = await vscode.window.withProgress({
            title: t('info.pl.launch.progress.launch-tcl.title'),
            location: vscode.ProgressLocation.Notification,
            cancellable: true
        }, async () => {
            const originVivadoPids = await getPIDsWithName('vivado');
            return await launchScript(originVivadoPids);
        });

        context.process = process;
        HardwareOutput.report(process ? `启动流程已返回进程句柄；PID：${process.pid ?? '未知'}；工程是否初始化成功仍以 Vivado 输出为准。` : '启动流程未返回可用进程句柄。', { level: process ? ReportType.Info : ReportType.Warn });
    }

    private handleMessage(message: string, _status: 'pending' | 'fulfilled'): string {
        // 保留 Vivado 原始输出，不过滤 source 行，也不插入启动成功提示。
        return message;
    }

    private decodeVivadoOutput(data: Buffer): string {
        // Vivado 2018.3 on a Chinese Windows system writes the console using CP936.
        // Decode in the extension so Vivado itself and its Tcl scripts remain unchanged.
        const utf8 = data.toString('utf8');
        const replacementCount = (utf8.match(/�/g) || []).length;
        const decoded = iconv.decode(data, 'cp936');
        return replacementCount > 0 || decoded.includes('阳光少年') ? decoded : utf8;
    }

    private sendCommand(context: PLContext, operation: string, command: string): void {
        const process = context.process;
        HardwareOutput.report(`【${operation}】准备发送请求\n工程：${this.diagnosticProjectPath || this.prjInfo.path}\n命令：${command}\n进程 PID：${process?.pid ?? '无'}；退出码：${process?.exitCode ?? '未退出或无进程'}；终止信号：${process?.signalCode ?? '无'}；已请求终止：${process?.killed ?? false}；输入流已销毁：${process?.stdin.destroyed ?? '无输入流'}；输入流可写：${process?.stdin.writable ?? false}`, { level: ReportType.Info });
        if (!process) {
            HardwareOutput.report(`【${operation}】未发送：没有 Vivado 进程句柄，请先启动。`, { level: ReportType.Warn });
            return;
        }
        try {
            const writable = process.stdin.write(command + '\n', error => {
                if (error) {
                    HardwareOutput.report(`【${operation}】标准输入写入失败；PID：${process.pid ?? '未知'}；工程：${this.diagnosticProjectPath || this.prjInfo.path}；错误：${error.message}`, { level: ReportType.Error });
                }
            });
            HardwareOutput.report(`【${operation}】已调用标准输入写入${writable ? '' : '（返回 false，可能存在背压或流不可用）'}；这不代表 Vivado 已接收或执行成功，请检查后续原始输出。`, { level: ReportType.Info });
        } catch (error) {
            HardwareOutput.report(`【${operation}】写入请求异常：${String(error)}`, { level: ReportType.Error });
            throw error;
        }
    }

    private async onVivadoClose() {
        const workspacePath = opeParam.workspacePath;
        const plName = opeParam.prjInfo.prjName.PL;
        const targetPath = fspath.dirname(opeParam.prjInfo.arch.hardware.src);

        if (hdlDir.isDir(`${workspacePath}/prj/xilinx/${plName}.gen`)) {            
            const sourceIpPath = `${workspacePath}/prj/xilinx/${plName}.gen/sources_1/ip`;
            const sourceBdPath = `${workspacePath}/prj/xilinx/${plName}.gen/sources_1/bd`;
    
            hdlDir.mvdir(sourceIpPath, targetPath, true);
            HardwareOutput.report(`已调用 IP 目录迁移：${sourceIpPath} → ${targetPath}；未校验迁移结果。`);
    
            hdlDir.mvdir(sourceBdPath, targetPath, true);
            HardwareOutput.report(`已调用 BD 目录迁移：${sourceBdPath} → ${targetPath}；未配置 BD 时源目录可能不存在，不代表工程错误。`);
        }

        if (hdlDir.isDir(`${workspacePath}/prj/xilinx/${plName}.srcs`)) {            
            const sourceIpPath = `${workspacePath}/prj/xilinx/${plName}.srcs/sources_1/ip`;
            const sourceBdPath = `${workspacePath}/prj/xilinx/${plName}.srcs/sources_1/bd`;
    
            hdlDir.mvdir(sourceIpPath, targetPath, true);
            HardwareOutput.report(`已调用 IP 目录迁移：${sourceIpPath} → ${targetPath}；未校验迁移结果。`);
    
            hdlDir.mvdir(sourceBdPath, targetPath, true);
            HardwareOutput.report(`已调用 BD 目录迁移：${sourceBdPath} → ${targetPath}；未配置 BD 时源目录可能不存在，不代表工程错误。`);
        }

        await this.closeAllWindows();
    }

    public create(scripts: string[]) {
        this.diagnosticProjectPath = hdlPath.join(this.prjInfo.path, this.prjInfo.name + '.xpr');
        HardwareOutput.report(`准备创建工程：${this.prjInfo.name}\n工程目录：${this.prjInfo.path}\n目标器件：${this.prjInfo.device}`, { level: ReportType.Info });
        scripts.push(`set_param general.maxThreads 8`);
        scripts.push(`create_project ${this.prjInfo.name} ${this.prjInfo.path} -part ${this.prjInfo.device} -force`);
        scripts.push(`set_property SOURCE_SET sources_1   [get_filesets sim_1]`);
        scripts.push(`set_property top_lib xil_defaultlib [get_filesets sim_1]`);
        scripts.push(`update_compile_order -fileset sim_1 -quiet`);
    }

    public open(path: AbsPath, scripts: string[]) {
        this.diagnosticProjectPath = path;
        HardwareOutput.report(`准备打开工程：${path}`, { level: ReportType.Info });
        scripts.push(`set_param general.maxThreads 8`);
        scripts.push(`open_project ${quoteTcl(path)} -quiet`);
    }

    /**
     * @description 更新 xpr 设计源的命令
     * @returns 
     */
    private getRefreshXprDesignSourceCommand(): string {
        const scripts: string[] = [];
        HardwareOutput.report('准备生成源文件同步脚本：将先移除 Vivado 当前文件列表，再按插件识别结果重新添加。', { level: ReportType.Info });
        scripts.push('puts "DIDE_SYNC_BEGIN"');
        HardwareOutput.report(`设计源目录：${this.srcPath}\n约束目录：${this.datPath}\n设计顶层：${this.topMod.src || '未识别'}\n仿真顶层：${this.topMod.sim || '未识别'}`, { level: ReportType.Info });
        // 清除所有源文件
        scripts.push(`remove_files -quiet [get_files]`);

        // 导入 IP_repo_paths
        scripts.push(`set xip_repo_paths {}`);

        if (fs.existsSync(this.custom.ipRepo)) {
            scripts.push(`lappend xip_repo_paths ${this.custom.ipRepo}`);
        }

        this.xipRepo.forEach(
            ip => scripts.push(`lappend xip_repo_paths ${this.xipPath}/${ip}`));
        
        scripts.push(`set_property ip_repo_paths $xip_repo_paths [current_project] -quiet`);
        scripts.push(`update_ip_catalog -quiet`);

        // BD is optional: an absent, empty or whitespace-only name means no import.
        const bd = this.prjConfig.soc?.bd?.trim();
        HardwareOutput.report(bd ? `配置的 Block Design：${bd}` : '未配置 Block Design，正常跳过 BD 导入。', { level: ReportType.Info });
        if (bd) {
            const bdFile = bd + '.bd';
            let bdSrcPath = hdlPath.join(this.xbdPath, bdFile);
            if (!hdlFile.isFile(bdSrcPath)) {
                bdSrcPath = hdlPath.join(this.custom.bdRepo, bdFile);
            }
    
            if (!hdlFile.isFile(bdSrcPath)) {
                HardwareOutput.report(`找不到已配置的 BD：${bdFile}；搜索目录：${this.xbdPath}、${this.custom.bdRepo}`, { level: ReportType.Error });
                vscode.window.showErrorMessage(`找不到 ${bdFile}；搜索目录：${this.xbdPath}、${this.custom.bdRepo}`);
            } else {
                if (hdlFile.copyFile(
                    bdSrcPath, 
                    hdlPath.join(this.HWPath, 'bd', bd, bdFile)
                )) {
                    HardwareOutput.report(`BD 文件复制接口返回成功：${bdSrcPath} → ${hdlPath.join(this.HWPath, 'bd', bd, bdFile)}；尚未执行 Vivado 导入。`, { level: ReportType.Info });
                } else {
                    HardwareOutput.report(`BD 文件复制接口返回失败：${bdSrcPath} → ${hdlPath.join(this.HWPath, 'bd', bd, bdFile)}`, { level: ReportType.Error });
                }
            }

            const loadBdPath = hdlPath.join(this.HWPath, 'bd', bd, bdFile);
            scripts.push(`generate_target all [get_files ${loadBdPath}] -quiet`);
            scripts.push(`make_wrapper -files [get_files ${loadBdPath}] -top -quiet`);
            scripts.push(`open_bd_design ${loadBdPath} -quiet`);
        }
        
        const bdPaths = [
            hdlPath.join(this.HWPath, 'bd'),
            hdlPath.join(this.prjInfo.path, this.prjInfo.name + '.src', 'sources_1', 'bd')
        ];

        hdlFile.pickFileRecursive(bdPaths, filePath => {
            if (filePath.endsWith('.bd')) {
                scripts.push(`add_files ${filePath} -quiet`);
                scripts.push(`add_files ${fspath.dirname(filePath)}/hdl -quiet`);
            }
        });

        const mrefPath = hdlPath.join(this.HWPath, 'bd', 'mref');
        hdlFile.pickFileRecursive(mrefPath, filePath => {
            if (filePath.endsWith('.tcl')) {
                scripts.push(`source ${filePath}`);
            }
        });

        // 导入ip设计源文件
        const ipPaths = [
            hdlPath.join(this.HWPath, 'ip'),
            hdlPath.join(this.prjInfo.path, this.prjInfo.name + '.src', 'sources_1', 'ip')
        ];

        hdlFile.pickFileRecursive(ipPaths, filePath => {
            if (filePath.endsWith('.xci')) {
                scripts.push(`add_files ${filePath} -quiet`);
            }
        });

        hdlFile.pickFileRecursive(this.srcPath, 
            filePath => filePath.endsWith('.edf')
        ).forEach((edfFile) => {
            scripts.push(`add_file ${edfFile} -quiet`);
        });

        // 导入设计源文件
        let sourceCount = 0;
        let simulationCount = 0;
        for (const hdlFile of hdlParam.getAllHdlFiles()) {
            switch (hdlFile.projectType) {
                case HdlFileProjectType.Src:
                case HdlFileProjectType.LocalLib:
                case HdlFileProjectType.RemoteLib:
                    // src 和 library 加入 source_1 设计源
                    scripts.push(`add_files [list ${quoteTcl(hdlFile.path)}]`);
                    sourceCount++;
                    HardwareOutput.report(`计划添加设计源：${hdlFile.path}`, { level: ReportType.Info });
                    break;
                case HdlFileProjectType.Sim:
                    // sim 加入 sim_1 设计源
                    scripts.push(`add_files -fileset sim_1 [list ${quoteTcl(hdlFile.path)}]`);
                    simulationCount++;
                    HardwareOutput.report(`计划添加仿真源：${hdlFile.path}`, { level: ReportType.Info });
                    break;
                case HdlFileProjectType.IP:
                case HdlFileProjectType.Primitive:
                    // IP 和 原语不用管
                    break;
                default:
                    break;
            }
        }

        scripts.push(`add_files -fileset constrs_1 [list ${quoteTcl(this.datPath)}]`);
        HardwareOutput.report(`同步计划：设计源 ${sourceCount} 个，仿真源 ${simulationCount} 个；约束从目录导入。此计数是待执行计划，不代表已导入成功。`, { level: ReportType.Info });

        if (this.topMod.src !== '') {
            scripts.push(`set_property top ${this.topMod.src} [current_fileset]`);
        }
        if (this.topMod.sim !== '') {
            scripts.push(`set_property top ${this.topMod.sim} [get_filesets sim_1]`);
        }

        scripts.push('puts "DIDE_SYNC_DONE files=[llength [get_files -quiet]]"');
        HardwareOutput.report('执行标记说明：DIDE_SYNC_BEGIN=Vivado 开始同步；DIDE_SYNC_DONE=同步脚本执行到末尾，files 为实际文件数量。若没有结束标记，请检查原始 Tcl 错误。', { level: ReportType.Info });
        let script = scripts.join('\n') + '\n';

        const scriptPath = `${this.xilinxPath}/refresh.tcl`;
        HardwareOutput.report(`源文件同步脚本：${scriptPath}`, { level: ReportType.Info });
        script += `file delete -force ${quoteTcl(scriptPath)}\n`;
        const refreshScriptWritten = hdlFile.writeFile(scriptPath, encodeTclScript(script));
        HardwareOutput.report(`同步脚本写入${refreshScriptWritten ? '完成' : '失败'}：${scriptPath}\n计划同步命令：\n${script}`, { level: refreshScriptWritten ? ReportType.Info : ReportType.Error });
        return encodeTclScript(loadTclScript(scriptPath)).trim();
    }

    /**
     * @description 【Xilinx Vivado 操作】更新 xpr 文件
     * @param context 
     */
    public refresh(context: PLContext) {
        if (!context.process || context.process.exitCode !== null || context.process.stdin.destroyed) {
            HardwareOutput.report(`无法同步：没有可用的 Vivado 进程，请先执行 Launch。工程：${this.diagnosticProjectPath || this.prjInfo.path}；PID：${context.process?.pid ?? '无'}；退出码：${context.process?.exitCode ?? '未退出或无进程'}；输入流已销毁：${context.process?.stdin.destroyed ?? '无输入流'}`, { level: ReportType.Error });
            return;
        }
        HardwareOutput.report('收到手动刷新请求，准备向 Vivado 发送同步命令。', { level: ReportType.Info });
        vscode.window.showInformationMessage(
            "Xilinx：请求刷新工程",
            { title: 'ok', value: true }
        );
        const cmd = this.getRefreshXprDesignSourceCommand();
        this.sendCommand(context, '刷新工程源文件', cmd);
    }

    public async closeAllWindows() {
        HardwareOutput.report(`开始执行 Vivado 关闭清理；记录的 Vivado PID：${this.guiPid}；工作区：${opeParam.workspacePath}`, { level: ReportType.Info });
        if (this.guiPid > 0) {
            HardwareOutput.report(`请求终止 Vivado 进程：${this.guiPid}；结果以进程退出事件为准。`, { level: ReportType.Info });
            await killProcess(this.guiPid);
        }

        const srcscannerPids = await getPIDsWithName('srcscanner');
        for (const pid of srcscannerPids) {
            HardwareOutput.report(`请求终止 srcscanner 进程：${pid}`, { level: ReportType.Info });
            await killProcess(pid);
        }

        // 删除所有 vivado_pid21812.str
        for (const file of fs.readdirSync(opeParam.workspacePath)) {
            if (file.startsWith('vivado_pid') && file.endsWith('.str')) {
                const file_path = hdlPath.join(opeParam.workspacePath, file);
                hdlFile.rmSync(file_path);
                HardwareOutput.report(`已执行 Vivado 临时记录清理：${file_path}`, { level: ReportType.Info });
            }
        }
    }

    public async exit(context: PLContext) {
        this.sendCommand(context, '退出 Vivado', 'exit');
        await this.closeAllWindows();
    }

    public simulate(context: PLContext) {
        this.simulateCli(context);
    }

    public simulateGui(context: PLContext) {
        vscode.window.showInformationMessage(
            "Xilinx：请求 GUI 仿真",
            { title: 'ok', value: true }
        );

        const scriptPath = `${this.xilinxPath}/simulate.tcl`;

        const script = `
if {[current_sim] != ""} {
    relaunch_sim -quiet
} else {
    launch_simulation -quiet
}

set curr_wave [current_wave_config]
if { [string length $curr_wave] == 0 } {
    if { [llength [get_objects]] > 0} {
        add_wave /
        set_property needs_save false [current_wave_config]
    } else {
        send_msg_id Add_Wave-1 WARNING "未找到顶层信号，仿真器将不打开波形窗口。可通过 File->New Waveform Configuration 或 Tcl 命令 create_wave_config 创建波形配置。"
    }
}
run 1us

start_gui -quiet
file delete ${scriptPath} -force\n`;

        const scriptWritten = hdlFile.writeFile(scriptPath, script);
        HardwareOutput.report(`GUI 仿真脚本写入${scriptWritten ? '完成' : '失败'}：${scriptPath}`, { level: scriptWritten ? ReportType.Info : ReportType.Error });
        const cmd = `source ${scriptPath} -quiet`;
        
        HardwareOutput.report(`GUI 仿真脚本：${scriptPath}；仿真顶层：${this.topMod.sim || '未识别'}；计划运行 1us。`, { level: ReportType.Info });
        this.sendCommand(context, 'GUI 仿真', cmd);
    }

    public simulateCli(context: PLContext) {
        vscode.window.showInformationMessage(
            "Xilinx：请求命令行仿真",
            { title: 'ok', value: true }
        );

        const scriptPath = hdlPath.join(this.xilinxPath, 'simulate.tcl');
        const script = `
if {[current_sim] != ""} {
    relaunch_sim -quiet
} else {
    launch_simulation -quiet
}

set curr_wave [current_wave_config]
if { [string length $curr_wave] == 0 } {
    if { [llength [get_objects]] > 0} {
        add_wave /
        set_property needs_save false [current_wave_config]
    } else {
        send_msg_id Add_Wave-1 WARNING "未找到顶层信号，仿真器将不打开波形窗口。可通过 File->New Waveform Configuration 或 Tcl 命令 create_wave_config 创建波形配置。"
    }
}
run 1us
file delete ${scriptPath} -force\n`;

        const scriptWritten = hdlFile.writeFile(scriptPath, script);
        HardwareOutput.report(`命令行仿真脚本写入${scriptWritten ? '完成' : '失败'}：${scriptPath}`, { level: scriptWritten ? ReportType.Info : ReportType.Error });
        const cmd = `source ${scriptPath} -quiet`;

        HardwareOutput.report(`命令行仿真脚本：${scriptPath}；仿真顶层：${this.topMod.sim || '未识别'}；计划运行 1us。`, { level: ReportType.Info });
        this.sendCommand(context, '命令行仿真', cmd);
    }

    public synth(context: PLContext) {
        vscode.window.showInformationMessage(
            "Xilinx：请求综合",
            { title: 'ok', value: true }
        );

        let quietArg = '';
        if (opeParam.prjInfo.enableShowLog) {
            quietArg = '-quiet';
        }

        let script = '';
        script += `reset_run synth_1 ${quietArg};`;
        script += `launch_runs synth_1 ${quietArg} -jobs 4;`;
        script += `wait_on_run synth_1 ${quietArg}`;

        this.sendCommand(context, '综合 synth_1', script);
    }

    impl(context: PLContext) {
        vscode.window.showInformationMessage(
            "Xilinx：请求实现",
            { title: 'ok', value: true }
        );

        let quietArg = '';
        if (opeParam.prjInfo.enableShowLog) {
            quietArg = '-quiet';
        }

        let script = '';
        script += `reset_run impl_1 ${quietArg};`;
        script += `launch_runs impl_1 ${quietArg} -jobs 4;`;
        script += `wait_on_run impl_1 ${quietArg};`;
        script += `open_run impl_1 ${quietArg};`;
        script += `report_timing_summary ${quietArg}`;

        this.sendCommand(context, '实现 impl_1', script);
    }

    build(context: PLContext) {
        vscode.window.showInformationMessage(
            "Xilinx：请求构建",
            { title: 'ok', value: true }
        );
        let quietArg = '';
        if (this.prjConfig.enableShowLog) {
            quietArg = '-quiet';
        }
        
        let script = '';
        script += `reset_run synth_1 ${quietArg}\n`;
        script += `launch_runs synth_1 ${quietArg} -jobs 4\n`;
        script += `wait_on_run synth_1 ${quietArg}\n`;
        script += `reset_run impl_1 ${quietArg}\n`;
        script += `launch_runs impl_1 ${quietArg} -jobs 4\n`;
        script += `wait_on_run impl_1 ${quietArg}\n`;
        script += `open_run impl_1 ${quietArg}\n`;
        script += `report_timing_summary ${quietArg}\n`;

        this.generateBit(context);

        const scriptPath = `${this.xilinxPath}/build.tcl`;
        script += `source ${scriptPath} -notrace\n`;

        script += `file delete ${scriptPath} -force\n`;
        const scriptWritten = hdlFile.writeFile(scriptPath, script);
        HardwareOutput.report(`构建脚本写入${scriptWritten ? '完成' : '失败'}：${scriptPath}`, { level: scriptWritten ? ReportType.Info : ReportType.Error });
        const cmd = `source ${scriptPath} -quiet`;

        HardwareOutput.report(`构建脚本：${scriptPath}\n计划命令：\n${script}\n沿用现有调用顺序：生成 bit 请求先于构建脚本发送；本日志不确认构建结果。`, { level: ReportType.Info });
        this.sendCommand(context, '构建', cmd);
    }

    generateBit(context: PLContext) {
        vscode.window.showInformationMessage(
            "Xilinx：请求生成 bit",
            { title: 'ok', value: true }
        );

        let scripts: string[] = [];
        let core = this.prjConfig.soc.core;
        let sysdefPath = `${this.prjInfo.path}/${this.prjInfo.name}.runs` + 
                         `/impl_1/${this.prjInfo.name}.sysdef`;

        if (core && (core !== "none")) {
            if (fs.existsSync(sysdefPath)) {
                scripts.push(`file copy -force ${sysdefPath} ${this.softSrc}/[current_project].hdf`);
            } else {
                scripts.push(`write_hwdef -force -file ${this.softSrc}/[current_project].hdf`);
            }
            // TODO: 是否专门设置输出文件路径的参数
            scripts.push(`write_bitstream ./[current_project].bit -force -quiet`);
        } else {
            scripts.push(`write_bitstream ./[current_project].bit -force -quiet -bin_file`);
        }

        let script = '';
        for (let i = 0; i < scripts.length; i++) {
            const content = scripts[i];
            script += content + '\n';
        }
        let scriptPath = `${this.xilinxPath}/bit.tcl`;
        script += `file delete ${scriptPath} -force\n`;
        const scriptWritten = hdlFile.writeFile(scriptPath, script);
        HardwareOutput.report(`bit 脚本写入${scriptWritten ? '完成' : '失败'}：${scriptPath}`, { level: scriptWritten ? ReportType.Info : ReportType.Error });
        const cmd = `source ${scriptPath} -quiet`;

        HardwareOutput.report(`生成 bit 脚本：${scriptPath}；SoC 核：${core || '未配置'}\n计划命令：\n${script}\nbit 输出路径相对于 Vivado 当前工作目录，不保证等同于工程目录。`, { level: ReportType.Info });
        this.sendCommand(context, '生成 bit', cmd);
    }

    program(context: PLContext) {
        vscode.window.showInformationMessage(
            "Xilinx：请求下载到硬件",
            { title: 'ok', value: true }
        );

        let scriptPath = `${this.xilinxPath}/program.tcl`;
        let script = `
open_hw -quiet
connect_hw_server -quiet
set found 0
foreach hw_target [get_hw_targets] {
    current_hw_target $hw_target
    open_hw_target -quiet
    foreach hw_device [get_hw_devices] {
        if { [string equal -length 6 [get_property PART $hw_device] ${this.prjInfo.device}] == 1 } {
            puts "------已找到匹配 ${this.prjInfo.device} 的硬件目标，尚未执行下载------ "
            current_hw_device $hw_device
            set found 1
        }
    }
    if {$found == 1} {break}
    close_hw_target
}   

#download the hw_targets
if {$found == 0 } {
    puts "******错误：未找到匹配 ${this.prjInfo.device} 的硬件目标，未执行下载****** "
} else {
    set_property PROGRAM.FILE ./[current_project].bit [current_hw_device]
    program_hw_devices [current_hw_device] -quiet
    disconnect_hw_server -quiet
}
file delete ${scriptPath} -force\n`;

        const scriptWritten = hdlFile.writeFile(scriptPath, script);
        HardwareOutput.report(`下载脚本写入${scriptWritten ? '完成' : '失败'}：${scriptPath}`, { level: scriptWritten ? ReportType.Info : ReportType.Error });
        const cmd = `source ${scriptPath} -quiet`;

        HardwareOutput.report(`下载脚本：${scriptPath}；目标器件：${this.prjInfo.device}；待下载文件：./[current_project].bit（相对于 Vivado 当前工作目录）。找到器件不代表下载成功。`, { level: ReportType.Info });
        this.sendCommand(context, '下载到硬件', cmd);
    }

    public async gui(context: PLContext) {
        HardwareOutput.report(`收到打开 Vivado GUI 请求；GUI 请求标志：${this.guiLaunched}；Vivado PID：${this.guiPid}；工程：${this.diagnosticProjectPath || this.prjInfo.path}`, { level: ReportType.Info });
        if (context.process === undefined) {
            HardwareOutput.report('GUI 请求没有进程句柄，先执行启动流程。', { level: ReportType.Info });
            await this.launch(context);
        }

        const tclProcess = context.process;
        if (tclProcess === undefined) {
            HardwareOutput.report('GUI 请求未发送：启动流程未返回可用进程。', { level: ReportType.Warn });
            return;
        }

        this.sendCommand(context, '打开 GUI', 'start_gui -quiet');
        vscode.window.showInformationMessage(
            '已提交 Vivado GUI 打开请求，尚未确认窗口已打开。',
            { title: t('ok'), value: true }
        );
        HardwareOutput.report('GUI 打开请求流程已返回；guiLaunched 仅记录请求标志，不表示已检测到窗口。', {
            level: ReportType.Info
        });

        HardwareOutput.show();
        this.guiLaunched = true;
    }

    public addFiles(files: string[], context: PLContext) {
        if (!this.guiLaunched && files.length > 0) {
            const filesString = files.join("\n");
            HardwareOutput.report('准备添加工程文件：\n' + filesString);
            this.execCommandToFilesInTclInterpreter(files, context, "add_file");
        } else {
            HardwareOutput.report(`跳过自动添加文件：GUI 请求标志=${this.guiLaunched}；文件数=${files.length}。`, { level: ReportType.Info });
        }
    }

    public delFiles(files: string[], context: PLContext) {
        if (!this.guiLaunched && files.length > 0) {
            const filesString = files.join("\n");
            HardwareOutput.report('准备移除工程文件：\n' + filesString);
            this.execCommandToFilesInTclInterpreter(files, context, "remove_files");
        } else {
            HardwareOutput.report(`跳过自动移除文件：GUI 请求标志=${this.guiLaunched}；文件数=${files.length}。`, { level: ReportType.Info });
        }
    }

    /**
     * @description 设置为 src 顶层文件
     * @param name 
     * @param context 
     */
    public setSrcTop(name: string, context: PLContext) {
        const cmd = `set_property top ${name} [current_fileset]`;
        this.sendCommand(context, '设置设计顶层', cmd);
    }

    /**
     * @description 设置为 sim 顶层文件
     * @param name 
     * @param context 
     */
    public setSimTop(name: string, context: PLContext) {
        const cmd = `set_property top ${name} [get_filesets sim_1]`;
        this.sendCommand(context, '设置仿真顶层', cmd);
    }

    /**
     * @description 为输入的每一个文件在 TCL 解释器中执行 command
     * @param files 
     * @param context 
     * @param command 
     */
    public execCommandToFilesInTclInterpreter(files: string[], context: PLContext, command: string) {
        if (context.process === undefined) {
            HardwareOutput.report(`文件更新未发送：没有 Vivado 进程；命令：${command}；文件数：${files.length}；工程：${this.diagnosticProjectPath || this.prjInfo.path}`, { level: ReportType.Warn });
            return;
        }
        for (const file of files) {
            this.sendCommand(context, '更新工程文件列表', command + ' ' + file);
        }
    }

    public xExecShowLog(logPath: AbsPath) {
        let logPathList = ["runme", "xvlog", "elaborate"];
        let fileName = fspath.basename(logPath, ".log");

        if (!logPathList.includes(fileName)) {
            return null;
        }

        let content = hdlFile.readFile(logPath);
        if (!content) {
            return null;
        }

        if (content.indexOf("INFO: [Common 17-206] Exiting Vivado") === -1) {
            return null;
        }

        let log = '';
        var regExp = /(?<head>CRITICAL WARNING:|ERROR:)(?<content>[\w\W]*?)(INFO:|WARNING:)/g;

        while (true) {
            let match = regExp.exec(content);
            if (match === null) {
                break;      
            }

            if (match.groups) {
                log += match.groups.head.replace("ERROR:", "[error] :");
                log += match.groups.content;
            }
        }

        MainOutput.report(log);
    }

    public updateVivadoPath(): string {
        const vivadoBinFolder = vscode.workspace.getConfiguration('digital-ide.prj.vivado.install').get<string>('path') || '';
        if (hdlFile.isDir(vivadoBinFolder)) {
            let vivadoPath = hdlPath.join(hdlPath.toSlash(vivadoBinFolder), 'vivado');
            if (opeParam.os === 'win32') {
                vivadoPath += '.bat';
            }
            HardwareOutput.report(`使用配置的 Vivado 可执行路径：${vivadoPath}`, { level: ReportType.Info });
            return vivadoPath;
        } else {
            // 没有设置 vivado bin 文件夹，就认为用户已经把对应的路径加入环境变量了
            HardwareOutput.report(`Vivado 安装目录${vivadoBinFolder ? '配置不是有效目录' : '未配置'}，沿用系统命令解析执行 vivado；不输出环境变量。`, { level: ReportType.Info });
            return 'vivado';
        }
    }
}

class XilinxBd {
    setting : vscode.WorkspaceConfiguration;
    extensionPath: AbsPath;
    xbdPath: AbsPath;
    schemaPath: AbsPath;
    schemaCont: PropertySchema;
    bdEnum: string[];
    bdRepo: AbsPath;

    constructor() {
        this.setting = vscode.workspace.getConfiguration();
        this.extensionPath = opeParam.extensionPath;
        this.xbdPath = hdlPath.join(this.extensionPath, 'lib', 'bd', 'xilinx');
        this.schemaPath = opeParam.propertySchemaPath;


        this.schemaCont = hdlFile.readJSON(this.schemaPath) as PropertySchema;
        
        this.bdEnum = this.schemaCont.properties.soc.properties.bd.enum;
        this.bdRepo = this.setting.get('digital-ide.prj.xilinx.BD.repo.path', '');
    }
    
    public getConfig() {
        this.extensionPath = opeParam.extensionPath;
        this.xbdPath = hdlPath.join(this.extensionPath, 'lib', 'bd', 'xilinx');
        this.schemaPath = opeParam.propertySchemaPath;
        this.schemaCont = hdlFile.readJSON(this.schemaPath) as PropertySchema;
        this.bdEnum = this.schemaCont.properties?.soc.properties.bd.enum;
        this.bdRepo = this.setting.get('digital-ide.prj.xilinx.BD.repo.path', '');
    }

    public async overwrite(uri: vscode.Uri): Promise<void> {
        this.getConfig();
        // 获取当前bd file的路径
        const select = await vscode.window.showQuickPick(this.bdEnum);
        // the user canceled the select
        if (!select) {
            return;
        }
        
        let bdSrcPath = `${this.xbdPath}/${select}.bd`;
        if (!hdlFile.isFile(bdSrcPath)) {
            bdSrcPath = `${this.bdRepo}/${select}.bd`;
        }

        if (!hdlFile.isFile(bdSrcPath)) {
            vscode.window.showErrorMessage(`can not find ${select}.bd in ${this.xbdPath} and ${this.bdRepo}, please load again.`);
        } else {
            const docPath = hdlPath.toSlash(uri.fsPath);
            const doc = hdlFile.readFile(docPath);
            if (doc) {
                hdlFile.writeFile(bdSrcPath, doc);
            }
        }
    }

    public add(uri: vscode.Uri) {
        this.getConfig();
        // 获取当前bd file的路径
        let docPath = hdlPath.toSlash(uri.fsPath);
        let bd_name = hdlPath.basename(docPath); 

        // 检查是否重复
        if (this.bdEnum.includes(bd_name)) {
            vscode.window.showWarningMessage(`The file already exists.`);
            return null;
        }

        // 获取存放路径
        let storePath = this.setting.get('digital-ide.prj.xilinx.BD.repo.path', '');
        if (!fs.existsSync(storePath)) {
            vscode.window.showWarningMessage(`This bd file will be added into extension folder.We don't recommend doing this because it will be cleared in the next update.`);
            storePath = this.xbdPath;
        }

        // 写入
        const bd_path = `${storePath}/${bd_name}.bd`;
        const doc = hdlFile.readFile(docPath);
        if (doc) {
            hdlFile.writeFile(bd_path, doc);
        }

        this.schemaCont.properties.soc.properties.bd.enum.push(bd_name);
        hdlFile.writeJSON(this.schemaPath, this.schemaCont);
    }

    
    public delete() {
        this.getConfig();
        vscode.window.showQuickPick(this.bdEnum).then(select => {
            // the user canceled the select
            if (!select) {
                return;
            }
            
            let bdSrcPath = `${this.xbdPath}/${select}.bd`;
            if (!hdlFile.isFile(bdSrcPath)) {
                bdSrcPath = `${this.bdRepo}/${select}.bd`;
            }

            if (!hdlFile.isFile(bdSrcPath)) {
                vscode.window.showErrorMessage(`can not find ${select}.bd in ${this.xbdPath} and ${this.bdRepo}, please load again.`);
            } else {
                hdlFile.removeFile(bdSrcPath);
            }
        });
    }

    public load() {
        this.getConfig();
        if (hdlFile.isDir(this.bdRepo)) {
            for (const file of fs.readdirSync(this.bdRepo)) {
                if (file.endsWith('.bd')) {
                    let basename = hdlPath.basename(file);
                    if (this.bdEnum.includes(basename)) {
                        return;
                    }
                    this.schemaCont.properties.soc.properties.bd.enum.push(basename);
                }
            }
        }

        hdlFile.writeJSON(this.schemaPath, this.schemaCont);
    }
};

const tools = {
    async boot() {
        // 声明变量
        const bootInfo: BootInfo = {
            outsidePath : hdlPath.join(fspath.dirname(opeParam.prjStructure.prjPath), 'boot'),
            insidePath  : hdlPath.join(opeParam.extensionPath, 'resources', 'boot', 'xilinx'),
            outputPath  : hdlPath.join(opeParam.extensionPath, 'resources', 'boot', 'xilinx', 'output.bif'),
            elfPath    : '',
            bitPath    : '',
            fsblPath   : ''
        };

        if (opeParam.prjInfo.INSIDE_BOOT_TYPE) {
            bootInfo.insidePath = hdlPath.join(bootInfo.insidePath, opeParam.prjInfo.INSIDE_BOOT_TYPE);
        } else {
            bootInfo.insidePath = hdlPath.join(bootInfo.insidePath, 'microphase');
        }
    
        let output_context =  "//arch = zynq; split = false; format = BIN\n";
            output_context += "the_ROM_image:\n";
            output_context += "{\n";
    
        bootInfo.fsblPath = await this.getfsblPath(bootInfo.outsidePath, bootInfo.insidePath);
        if (!bootInfo.fsblPath) {
            return null;
        }
        output_context += bootInfo.fsblPath;

        bootInfo.bitPath  = await this.getBitPath(opeParam.workspacePath);
        if (bootInfo.bitPath) {
            output_context += bootInfo.bitPath;
        }

        bootInfo.elfPath  = await this.getElfPath(bootInfo);
        if (!bootInfo.elfPath) {
            return null;
        }
        output_context += bootInfo.elfPath;

        output_context += "}";
        let result = hdlFile.writeFile(bootInfo.outputPath, output_context);
        if (!result) {
            HardwareOutput.report(`启动镜像配置写入失败：${bootInfo.outputPath}`, { level: ReportType.Error });
            return null;
        }

        let command = `bootgen -arch zynq -image ${bootInfo.outputPath} -o ${opeParam.workspacePath}/BOOT.bin -w on`;
        HardwareOutput.report(`准备生成启动镜像；工作区：${opeParam.workspacePath}\n执行命令：${command}；尚未确认生成成功。`, { level: ReportType.Info });
        exec(command, function (error, stdout, stderr) {
            if (stdout) {
                HardwareOutput.report(stdout, { level: ReportType.Info });
            }
            if (stderr) {
                HardwareOutput.report(stderr, { level: ReportType.Error });
            }
            if (error) {
                HardwareOutput.report(`启动镜像生成进程失败：${error.message}\n命令：${command}`, { level: ReportType.Error });
                vscode.window.showErrorMessage(`${error}`);
                vscode.window.showErrorMessage(`标准错误：${stderr}`);
                return;
            } else {
                HardwareOutput.report(`bootgen 进程已正常退出；预期输出：${opeParam.workspacePath}/BOOT.bin；未校验文件内容。`, { level: ReportType.Info });
                vscode.window.showInformationMessage("启动镜像生成命令已正常退出，文件内容尚未校验。");
            }
        });
    },

    async getfsblPath(outsidePath: AbsPath, insidePath: AbsPath): Promise<string> {
        const paths: AbsPath[] = hdlFile.pickFileRecursive(outsidePath,
            filePath => filePath.endsWith('fsbl.elf'));

        if (paths.length) {
            if (paths.length === 1) {
                return `\t[bootloader]${outsidePath}/${paths[0]}\n`;
            }

            let selection = await vscode.window.showQuickPick(paths);
            if (!selection) {
                return '';
            }
            return `\t[bootloader]${outsidePath}/${selection}\n`;
        }
        
        return `\t[bootloader]${insidePath}/fsbl.elf\n`;
    },

    async getBitPath(bitPath: AbsPath): Promise<string> {
        let bitList = hdlFile.pickFileRecursive(bitPath,
            filePath => filePath.endsWith('.bit'));

        if (bitList.length === 0) {
            HardwareOutput.report(`未发现 bit 文件：${bitPath}；按原流程仅使用 ELF 生成启动镜像。`, { level: ReportType.Info });
            vscode.window.showInformationMessage("仅使用 ELF 文件生成启动镜像");
        } 
        else if (bitList.length === 1) {
            return"\t" + bitPath + bitList[0] + "\n";
        }
        else {
            let selection = await vscode.window.showQuickPick(bitList);
            if (!selection) {
                return '';
            }
            return "\t" + bitPath + selection + "\n";
        }
        return '';
    },

    async getElfPath(bootInfo: BootInfo): Promise<string> {
        // 优先在外层寻找elf文件
        let elfs = this.pickElfFile(bootInfo.outsidePath);

        if (elfs.length) {
            if (elfs.length === 1) {
                return `\t${bootInfo.outsidePath}/${elfs[0]}\n`;
            }

            let selection = await vscode.window.showQuickPick(elfs);
            if (!selection) {
                return '';
            }
            return `\t${bootInfo.outsidePath}/${selection}\n`;
        }

        // 如果外层找不到文件则从内部调用
        elfs = this.pickElfFile(bootInfo.insidePath);
        if (elfs.length) {
            if (elfs.length === 1) {
                return `\t${bootInfo.insidePath}/${elfs[0]}\n`;
            }

            let selection = await vscode.window.showQuickPick(elfs);
            if (!selection) {
                return '';
            }
            return `\t${bootInfo.insidePath}/${selection}\n`;
        }

        // 如果内层也没有则直接退出
        HardwareOutput.report(`未找到 ELF 文件；搜索目录：${bootInfo.outsidePath}、${bootInfo.insidePath}`, { level: ReportType.Error });
        vscode.window.showErrorMessage("未找到 ELF 文件");
        return '';
    },
    
    pickElfFile(path: AbsPath): AbsPath[] {
        return hdlFile.pickFileRecursive(path,
            filePath => filePath.endsWith('.elf') && !filePath.endsWith('fsbl.elf'));
    }
};

export {
    XilinxOperation,
    tools,
    XilinxBd,
    PLContext
};
