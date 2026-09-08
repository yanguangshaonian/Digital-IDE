import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Finds the nearest ancestor containing .vscode/property.json, bounded by workspace root. */
export function findProjectProperty(uri: vscode.Uri): { root: vscode.Uri; property: vscode.Uri } | undefined {
    if (uri.scheme !== 'file') return undefined;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder) return undefined;
    let current = fs.existsSync(uri.fsPath) && fs.statSync(uri.fsPath).isDirectory()
        ? uri.fsPath : path.dirname(uri.fsPath);
    const workspaceRoot = path.resolve(folder.uri.fsPath);
    while (true) {
        const candidateRoot = path.resolve(current);
        const propertyPath = path.join(candidateRoot, '.vscode', 'property.json');
        if (fs.existsSync(propertyPath) && fs.statSync(propertyPath).isFile()) {
            return { root: vscode.Uri.file(candidateRoot), property: vscode.Uri.file(propertyPath) };
        }
        if (candidateRoot.toLowerCase() === workspaceRoot.toLowerCase()) break;
        const parent = path.dirname(candidateRoot);
        if (parent === candidateRoot || !parent.toLowerCase().startsWith(workspaceRoot.toLowerCase())) break;
        current = parent;
    }
    return undefined;
}

export function projectKey(uri: vscode.Uri): string | undefined {
    const property = findProjectProperty(uri)?.property;
    return property && path.normalize(property.fsPath).toLowerCase();
}

export function projectRoot(uri: vscode.Uri): vscode.Uri {
    return findProjectProperty(uri)?.root || vscode.workspace.getWorkspaceFolder(uri)?.uri || uri;
}
