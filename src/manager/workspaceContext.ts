import * as vscode from 'vscode';

let prepare: (folder: vscode.WorkspaceFolder) => Promise<void>;
let readyResolve: () => void;
const ready = new Promise<void>(resolve => { readyResolve = resolve; });
let queue: Promise<unknown> = Promise.resolve();

export function configureWorkspaceContext(handler: typeof prepare) {
    prepare = handler;
    readyResolve();
}

/** Keep project preparation and its consumer in the same serialized operation. */
export function runInWorkspace<T>(uri: vscode.Uri, action: () => Promise<T>): Promise<T> {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) {
        return Promise.reject(new Error('目标文件不属于已打开的工作区，无法使用项目仿真。'));
    }
    const operation = queue.then(async () => {
        await ready;
        await prepare(folder);
        return action();
    });
    queue = operation.catch(() => undefined);
    return operation;
}