import * as vscode from 'vscode';
import * as fs from 'fs';

import { MainOutput, ReportType, IProgress, globalLookup, opeParam } from './global';
import { hdlParam } from './hdlParser';
import * as manager from './manager';
import * as lspLinter from './function/lsp/linter';
import * as func from './function';
import { hdlMonitor } from './monitor';

import * as lspClient from './function/lsp-client';
import { refreshArchTree } from './function/treeView';
import { moduleTreeProvider } from './function/treeView/tree';
import { initialiseI18n, t } from './i18n';
import { configureWorkspaceContext, followEditorWorkspace, failWorkspaceContext, stopWorkspaceContext, enqueueWorkspaceCleanup } from './manager/workspaceContext';
import { findProjectProperty, projectKey, projectRoot } from './manager/projectLocator';


async function registerCommand(context: vscode.ExtensionContext, packageJson: any) {
    func.registerFunctionCommands(context);
    func.registerTreeViewDataProvider(context);
    func.registerLsp(context, packageJson.version);
    func.registerToolCommands(context);
    func.registerNetlist(context);
    func.registerWaveViewer(context);

    // onCommand 激活事件中的命令
    context.subscriptions.push(
        vscode.commands.registerCommand('digital-ide.property-json.generate', (resource?: vscode.Uri) => {
            return manager.prjManage.generatePropertyJson(context, resource);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('digital-ide.structure.from-xilinx-to-standard', () => {
            manager.prjManage.transformXilinxToStandard(context);
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('digital-ide.property-json.overwrite', () => {
            manager.prjManage.overwritePropertyJson()
        })
    )
}

function readPackageJson(context: vscode.ExtensionContext): any | undefined {
    const extensionPath = context.extensionPath;
    const packagePath = extensionPath + '/package.json';
    if (!fs.existsSync(packagePath)) {
        vscode.window.showErrorMessage("Digital IDE 安装目录已经被污染, 请重新安装!");
        return undefined;
    }
    const packageMeta = fs.readFileSync(packagePath, { encoding: 'utf-8' });
    return JSON.parse(packageMeta);
}

async function launch(context: vscode.ExtensionContext) {
    initialiseI18n(context);

    console.log(t('info.welcome.title'));
    console.log(t('info.welcome.join-qq-group') + ' https://qm.qq.com/q/1M655h3GsA');

    const packageJson = readPackageJson(context);
    MainOutput.report(t('info.launch.digital-ide-current-version') + packageJson.version, {
        level: ReportType.Launch
    });

    if (packageJson === undefined) {
        return;
    }
    
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: t('info.progress.register-command')
    }, async () => {
        await registerCommand(context, packageJson);
    });

    // 注册全局变量
    globalLookup.activeEditor = vscode.window.activeTextEditor;
    let initialized = false;
    let preparedWorkspace = '';
            const prepareWorkspace = async (folder: vscode.WorkspaceFolder, sourceUri?: vscode.Uri) => {
                const located = sourceUri && findProjectProperty(sourceUri);
                const targetRoot = located?.root || folder.uri;
                const targetKey = projectKey(sourceUri || targetRoot) || targetRoot.toString();
                if (targetKey === preparedWorkspace) {
                return;
            }
            preparedWorkspace = '';
            await hdlMonitor.close();
            await lspClient.deactivate();
            hdlParam.clear();
            opeParam.resetProjectInfo();
            moduleTreeProvider.resetTopSelection();
            const config = await manager.prjManage.initOpeParam(context, { ...folder, uri: targetRoot });
            await manager.prjManage.refreshPrjFolder(config);
            await lspClient.activate(context, packageJson);
            const files = await manager.prjManage.initialise(context, {
                report() { /* progress is optional during automatic switching */ }
            } as vscode.Progress<IProgress>);
            refreshArchTree();
            hdlMonitor.start();
            await lspLinter.initialise(context, files, {
                report() { /* progress is optional during automatic switching */ }
            } as vscode.Progress<IProgress>);
            preparedWorkspace = targetKey;
    };
    const switchToEditorWorkspace = (editor?: vscode.TextEditor) => {
        if (!editor || !vscode.workspace.getWorkspaceFolder(editor.document.uri)) {
            return Promise.resolve();
        }
        const located = findProjectProperty(editor.document.uri);
        return followEditorWorkspace(located?.property || editor.document.uri).catch(error => {
            vscode.window.showErrorMessage(`Digital-IDE 工作区切换失败: ${String(error)}`);
        });
    };
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(editor => {
        if (initialized) {
            switchToEditorWorkspace(editor);
        }
    }));
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(event => {
        void enqueueWorkspaceCleanup(async () => {
            for (const folder of event.removed) {
                if (folder.uri.toString() === vscode.Uri.file(opeParam.workspacePath).toString()) {
                    preparedWorkspace = '';
                    await hdlMonitor.close();
                    await lspClient.deactivate();
                    hdlParam.clear();
                    moduleTreeProvider.resetTopSelection();
                    refreshArchTree();
                }
                try {
                    await manager.prjManage.removeHardwareSession(folder.uri);
                } catch (error) {
                    vscode.window.showErrorMessage(`工作区已移除，但 Vivado 尚未退出，仍保留会话: ${String(error)}`);
                }
            }
        }).then(() => switchToEditorWorkspace(vscode.window.activeTextEditor)).catch(error => {
            vscode.window.showErrorMessage(`工作区移除清理失败: ${String(error)}`);
        });
    }));

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: t('info.progress.initialize-configure')        
    }, async () => {
        // 初始化 OpeParam
        // 包含基本的插件的文件系统信息、用户配置文件和系统配置文件的合并数据结构
        const activeUri = vscode.window.activeTextEditor?.document.uri;
        const located = activeUri && findProjectProperty(activeUri);
        const folder = activeUri && vscode.workspace.getWorkspaceFolder(located?.property || activeUri);
        const refreshPrjConfig = await manager.prjManage.initOpeParam(context, folder);
        await manager.prjManage.refreshPrjFolder(refreshPrjConfig);
    });

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: t('info.progress.launch-lsp')
    }, async () => {
        await lspClient.activate(context, packageJson);
    });
        
    const hdlFiles = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: t('info.progress.initialization')
    }, async (progress: vscode.Progress<IProgress>, token: vscode.CancellationToken) => {
        // 初始化解析
        const hdlFiles = await manager.prjManage.initialise(context, progress);
        
        // 这里是因为 pl 对象在 initialise 完成初始化，此处再注册它的行为
        manager.registerManagerCommands(context);

        // 刷新结构树
        refreshArchTree();

        // 启动监视器
        hdlMonitor.start();

        return hdlFiles;
    });


    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window,
        title: t('info.progress.doing-diagnostic')
    }, async (progress: vscode.Progress<IProgress>, token: vscode.CancellationToken) => {
        // 完成诊断器初始化
        await lspLinter.initialise(context, hdlFiles, progress);
    });

    initialized = true;
    preparedWorkspace = projectKey(vscode.Uri.file(opeParam.propertyJsonPath)) || vscode.Uri.file(opeParam.workspacePath).toString();
    configureWorkspaceContext(prepareWorkspace);
    await switchToEditorWorkspace(vscode.window.activeTextEditor);
    console.log(hdlParam);
    
    // show welcome information (if first install)
    const welcomeSetting = vscode.workspace.getConfiguration('digital-ide.welcome');
    const showWelcome = welcomeSetting.get('show', true);
 
    if (showWelcome) {
        // don't show in next time
        welcomeSetting.update('show', false, vscode.ConfigurationTarget.Global);
        const res = await vscode.window.showInformationMessage(
            t('info.welcome.title'),
            { title: t('info.welcome.star'), value: true },
            { title: t('info.welcome.refuse'), value: false },
        );
        if (res?.value) {
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/Digital-EDA/Digital-IDE'));
        }
    }
}

export function activate(context: vscode.ExtensionContext) {
    return launch(context).catch(error => {
        failWorkspaceContext(error);
        throw error;
    });
}

export async function deactivate() {
    await stopWorkspaceContext();
    await hdlMonitor.close();
    try {
        await manager.prjManage.closeHardwareSessions();
    } finally {
        await lspClient.deactivate();
    }
}