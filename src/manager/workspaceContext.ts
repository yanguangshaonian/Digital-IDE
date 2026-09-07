import * as vscode from 'vscode';

let prepare: (folder: vscode.WorkspaceFolder) => Promise<void>;
let readyResolve: () => void;
let readyReject: (error: unknown) => void;
const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
void ready.catch(() => undefined);
let queue: Promise<unknown> = Promise.resolve();
let stopped = false;
let editorGeneration = 0;

export function failWorkspaceContext(error: unknown) {
    readyReject(error);
}

export async function stopWorkspaceContext() {
    stopped = true;
    editorGeneration++;
    readyReject(new Error('扩展正在停止'));
    await queue;
}

export function followEditorWorkspace(uri: vscode.Uri) {
    const generation = ++editorGeneration;
    return runInWorkspace(uri, async () => undefined, () => generation === editorGeneration);
}

export function configureWorkspaceContext(handler: typeof prepare) {
    prepare = handler;
    readyResolve();
}

/** Keep project preparation and its consumer in the same serialized operation. */
export function runInWorkspace<T>(uri: vscode.Uri, action: () => Promise<T>, current?: () => boolean): Promise<T | undefined> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
        return Promise.reject(new Error('目标文件不属于已打开的工作区，无法使用项目仿真。'));
    }
    const operation = queue.then(async () => {
        if (stopped) { throw new Error('扩展正在停止'); }
        if (current && !current()) { return undefined; }
        await ready;
        if (stopped) { throw new Error('扩展正在停止'); }
        if (current && !current()) { return undefined; }
        if (!vscode.workspace.workspaceFolders?.some(item => item.uri.toString() === folder.uri.toString())) {
            throw new Error('目标工作区已移除');
        }
        await prepare(folder);
        return action();
    });
    queue = operation.catch(() => undefined);
    return operation;
}

/** Lifecycle work shares the queue but does not require a still-open root. */
export function enqueueWorkspaceCleanup(action: () => Promise<void>) {
    const operation = queue.then(async () => {
        if (!stopped) { await action(); }
    });
    queue = operation.catch(() => undefined);
    return operation;
}