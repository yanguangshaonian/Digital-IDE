const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('xilinx.ts', fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'XilinxOperation');
const names = ['sessionWorkspace', 'sessionExtension', 'sessionProject', 'sessionTopSrc', 'sessionTopSim', 'scriptDirectory', 'scriptSequence', 'scriptPath', 'xilinxPath', 'prjPath', 'srcPath', 'topMod', 'assertWorkspace', 'bindActiveProject'];
const members = cls.members.filter(n => names.includes(n.name?.getText(source))).map(n => n.getText(source)).join('\n');
const globals = { workspacePath: 'A', extensionPath: 'extension', prjInfo: { arch: { prjPath: 'A/prj', hardware: { src: 'A/user/src' } } }, firstSrcTopModule: { name: 'A_top' }, firstSimTopModule: {} };
let sequence = 0;
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${members} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, {
    opeParam: globals, fspath: path.posix,
    hdlPath: { join: path.posix.join, toSlash: x => x },
    fs: { mkdirSync() {}, mkdtempSync: prefix => prefix + ++sequence },
    vscode: { Uri: { file: p => ({ toString: () => p }) } }
});
const a = new Subject();
globals.workspacePath = 'B';
globals.prjInfo = { arch: { prjPath: 'B/prj', hardware: { src: 'B/user/src' } } };
globals.firstSrcTopModule = { name: 'B_top' };
const b = new Subject();
assert.equal(a.prjPath, 'A/prj');
assert.equal(a.srcPath, 'A/user/src');
assert.equal(a.topMod.src, 'A_top');
assert.equal(b.prjPath, 'B/prj');
assert.throws(() => a.assertWorkspace());
assert(a.scriptPath('launch').startsWith('A/.digital-ide/vivado/'));
assert(b.scriptPath('launch').startsWith('B/.digital-ide/vivado/'));
assert.notEqual(b.scriptPath('refresh'), b.scriptPath('refresh'));
const extension = fs.readFileSync('src/extension.ts', 'utf8');
assert(!extension.slice(extension.indexOf('const prepareWorkspace'), extension.indexOf('const switchToEditorWorkspace')).includes('.exit('));
console.log('PASS: session paths/top isolated, wrong-root guard, per-session unique scripts, editor switch does not exit Vivado');
const vivadoSource = fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8');
assert(vivadoSource.includes('const startupDirectory = this.xilinxPath;'));
assert(vivadoSource.includes("spawn(cmd, [], { shell: true, stdio: 'pipe', cwd: startupDirectory })"));
assert(vivadoSource.includes('scripts.unshift(`cd ${quoteTcl(this.sessionWorkspace)}`)'));
assert(vivadoSource.indexOf('scripts.unshift(`cd ${quoteTcl(this.sessionWorkspace)}`)') < vivadoSource.indexOf('const tclCommands ='));
console.log('PASS: startup artifacts use session directory; Tcl restores quoted workspace before project commands');