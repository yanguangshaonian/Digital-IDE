const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-project-'));
fs.mkdirSync(path.join(root, 'project', '.vscode'), { recursive: true });
fs.writeFileSync(path.join(root, 'project', '.vscode', 'property.json'), '{}');
fs.mkdirSync(path.join(root, 'project', 'src', 'deep'), { recursive: true });
const source = fs.readFileSync('src/manager/projectLocator.ts', 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exportsObject = {};
const vscode = { workspace: {
    getWorkspaceFolder: uri => uri.fsPath.startsWith(root) ? { uri: { fsPath: root } } : undefined
}, Uri: { file: fsPath => ({ scheme: 'file', fsPath, toString: () => `file://${fsPath}` }) } };
vmRun(code, { exports: exportsObject, require: id => id === 'vscode' ? vscode : require(id) });
const { findProjectProperty, projectKey } = exportsObject;
const a = vscode.Uri.file(path.join(root, 'project', 'src', 'deep', 'a.sv'));
const b = vscode.Uri.file(path.join(root, 'project', 'src', 'b.sv'));
const first = findProjectProperty(a);
const second = findProjectProperty(b);
assert(first && second);
assert.equal(first.property.fsPath, second.property.fsPath);
assert.equal(projectKey(a), projectKey(b));
assert.equal(first.root.fsPath, path.join(root, 'project'));
console.log('PASS: different files share one nearest property.json project identity');
function vmRun(text, sandbox) { return require('node:vm').runInNewContext(text, sandbox); }
