import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fspath from 'path';
import { Worker } from 'worker_threads';
import { hdlFile, hdlPath } from '../../hdlFs';
import { t } from '../../i18n';
import { gotoDefinition, saveAsPdf, saveAsSvg } from './api';
import { getIconConfig } from '../../hdlFs/icons';
import { AbsPath, opeParam, ReportType, YosysOutput } from '../../global';
import { PathSet } from '../../global/util';

import { hdlParam } from '../../hdlParser';
import { defaultMacro, doFastApi } from '../../hdlParser/util';
import { HdlFile } from '../../hdlParser/core';
type SynthMode = 'before' | 'after' | 'RTL';

interface SimpleOpe {
    workspacePath: string,
    libCommonPath: string,
    prjPath: string,
    extensionPath: string
}


class NetlistRender {
    panel?: vscode.WebviewPanel;
    constructor() {

    }

    public create(moduleName: string) {
        // Create panel
        this.panel = vscode.window.createWebviewPanel(
            'Netlist',
            'Netlist',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                enableForms: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.onDidDispose(() => {
        });

        const previewHtml = this.getWebviewContent();
        if (this.panel && previewHtml) {
            const netlistPath = hdlPath.join(opeParam.extensionPath, 'resources', 'dide-netlist', 'view');
            const netlistPayloadFolder = hdlPath.join(opeParam.prjInfo.prjPath, 'netlist');
            const targetJson = hdlPath.join(netlistPayloadFolder, moduleName + '.json');
            const skinPath= hdlPath.join(netlistPath, 'dide.skin');

            const graph = this.panel.webview.asWebviewUri(vscode.Uri.file(targetJson)).toString();
            const skin = this.panel.webview.asWebviewUri(vscode.Uri.file(skinPath)).toString();
            this.panel.iconPath = getIconConfig('view');

            let preprocessHtml = previewHtml
                .replace('test.json', graph)
                .replace('test.module', moduleName)
                .replace('dide.skin', skin);

            this.panel.webview.html = preprocessHtml;

            registerMessageEvent(this.panel);
        } else {
            YosysOutput.report('preview html in <Netlist.create> is empty', {
                level: ReportType.Warn
            });
        }
    }

    public getWebviewContent() {
        const netlistPath = hdlPath.join(opeParam.extensionPath, 'resources', 'dide-netlist', 'view');
        const htmlIndexPath = hdlPath.join(netlistPath, 'index.html');
        
        const html = hdlFile.readFile(htmlIndexPath)?.replace(/(<link.+?href="|<script.+?src="|<img.+?src=")(.+?)"/g, (m, $1, $2) => {
            const absLocalPath = fspath.resolve(netlistPath, $2);
            const webviewUri = this.panel?.webview.asWebviewUri(vscode.Uri.file(absLocalPath));
            const replaceHref = $1 + webviewUri?.toString() + '"';
            return replaceHref;
        });
        return html;
    }
}

async function generateFilelist(path: AbsPath): Promise<AbsPath[]> {
    const pathset = new PathSet();
    path = hdlPath.toSlash(path);

    let moduleFile = hdlParam.getHdlFile(path);
    // 没有说明是单文件模式，直接打开解析
    if (!moduleFile) {
        const standardPath = hdlPath.toSlash(path);
        const response = await doFastApi(standardPath, 'common');
        const langID = hdlFile.getLanguageId(standardPath);
        const projectType = hdlParam.getHdlFileProjectType(standardPath, 'common');
        moduleFile = new HdlFile(
            standardPath, langID,
            response?.macro || defaultMacro,
            response?.content || [],
            projectType,
            'common'
        );
        // 从 hdlParam 中去除，避免干扰全局
        hdlParam.removeFromHdlFile(moduleFile);

        // const message = t('error.common.not-valid-hdl-file');
        // const errorMsg = path + ' ' + message + ' ' + opeParam.prjInfo.hardwareSrcPath + '\n' + opeParam.prjInfo.hardwareSimPath;
        // vscode.window.showErrorMessage(errorMsg);
        // return undefined;
    }

    for (const hdlModule of moduleFile.getAllHdlModules()) {
        const hdlDependence = hdlParam.getAllDependences(path, hdlModule.name);
        if (hdlDependence) {
            // include 宏在后续会被正确处理，所以只需要处理 others 即可
            hdlDependence.others.forEach(path => pathset.add(path));
        }
    }
    pathset.add(path);
    
    const filelist = [...pathset.files];
    return filelist;
}

function generateOpe(): SimpleOpe {
    return {
        workspacePath: opeParam.workspacePath,
        extensionPath: opeParam.extensionPath,
        libCommonPath: opeParam.prjInfo.libCommonPath,
        prjPath: opeParam.prjInfo.prjPath
    };
}

function registerMessageEvent(panel: vscode.WebviewPanel) {
    panel.webview.onDidReceiveMessage(message => {
        const { command, data } = message;

        switch (command) {
            case 'save-as-svg':
                saveAsSvg(data, panel);
                break;
            case 'save-as-pdf':
                saveAsPdf(data, panel);
                break;
            case 'goto-definition':
                gotoDefinition(data, panel);
                break;
            default:
                break;
        }
    });
}

async function runWorker(worker: Worker, request: unknown): Promise<boolean> {
    let success = true;
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: t('info.netlist.generate-network'),
        cancellable: true
    }, (_, token) => new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timer);
            cancellation.dispose();
            worker.removeListener('message', onMessage);
            worker.removeListener('error', onError);
            worker.removeListener('exit', onExit);
            void worker.terminate();
            if (error) { reject(error); } else { resolve(); }
        };
        const onError = (error: Error) => finish(error);
        const onExit = (code: number) => {
            if (!settled) { finish(new Error(`NetList worker exited before completion (code ${code}).`)); }
        };
        const onMessage = (message: any) => {
            if (message.command === 'error-log-file') {
                success = false;
                void showErrorLogFile(message.data);
            } else if (message.command === 'finish') {
                finish();
            }
        };
        const timer = setTimeout(() => finish(new Error('NetList generation timed out after 120 seconds.')), 120000);
        const cancellation = token.onCancellationRequested(() => finish(new vscode.CancellationError()));
        worker.on('message', onMessage);
        worker.once('error', onError);
        worker.once('exit', onExit);
        if (token.isCancellationRequested) { finish(new vscode.CancellationError()); return; }
        try { worker.postMessage(request); } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    }));
    return success;
}

function checkResource() {
    const netlistWasmPath = hdlPath.join(opeParam.extensionPath, 'resources', 'dide-netlist', 'static', 'yosys.wasm');
    if (!hdlPath.exist(netlistWasmPath)) {
        vscode.window.showErrorMessage(t('info.netlist.not-found-payload'));
        throw Error(t('info.netlist.not-found-payload'));
    }
}

export async function openNetlistViewer(context: vscode.ExtensionContext, uri: vscode.Uri, moduleName: string) {
    checkResource();
    const workerScriptPath = hdlPath.join(opeParam.extensionPath, 'out', 'function', 'dide-netlist', 'worker.js');
    const configuration = vscode.workspace.getConfiguration();
    const mode = configuration.get<SynthMode>('digital-ide.function.netlist.schema-mode') || 'before';
    const filelist = await generateFilelist(uri.fsPath);
    const ope = generateOpe();
    const generated = await runWorker(new Worker(workerScriptPath), {
        command: 'open',
        data: {
            path: uri.fsPath,
            moduleName, mode,
            filelist,
            ope
        }
    });
    if (generated) {
        const render = new NetlistRender();
        render.create(moduleName);
    }
}

async function showErrorLogFile(data: any) {
    const { logFilePath, error } = data || {};
    const saved = logFilePath && fs.existsSync(logFilePath) ? fs.readFileSync(logFilePath, 'utf8').trim() : '';
    const detail = [error, saved].filter(Boolean).join('\n');
    const res = await vscode.window.showErrorMessage(
        t('error.cannot-gen-netlist') + (detail ? `\n${detail.slice(0, 500)}` : ''),
        { title: t('error.look-up-log'), value: true }
    );
    if (res?.value) {
        if (logFilePath && fs.existsSync(logFilePath)) {
            const document = await vscode.workspace.openTextDocument(vscode.Uri.file(logFilePath));
            await vscode.window.showTextDocument(document);
        } else {
            vscode.window.showErrorMessage(error ? String(error) : 'NetList log file was not written.');
        }
    }
}

export async function runYsScript(context: vscode.ExtensionContext, uri: vscode.Uri) {
    checkResource();
    const workerScriptPath = hdlPath.join(opeParam.extensionPath, 'out', 'function', 'dide-netlist', 'worker.js');
    const ope = generateOpe();
    await runWorker(new Worker(workerScriptPath), {
        command: 'run',
        data: {
            path: uri.fsPath,
            ope
        }
    });
}
