const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
const text = fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8');
const source = ts.createSourceFile('xilinx.ts', text, ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'XilinxOperation');
const method = cls.members.find(n => n.name?.getText(source) === 'launchInternal');
const messages = [];
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${method.getText(source)} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, {
    fspath: path.posix, hdlPath: { join: path.posix.join },
    hdlFile: { pickFileRecursive: () => [] },
    hdlDir: { mkdir() { throw Error('must not create project directories'); } },
    HardwareOutput: { report() {} }, ReportType: { Info: 1, Error: 2 },
    vscode: { window: { showErrorMessage: async message => { messages.push(message); } } }
});
(async () => {
    const subject = new Subject();
    subject.sessionWorkspace = '02_mux2';
    subject.sessionProject = { prjName: { PL: 'template' }, arch: { hardware: { src: '02_mux2/user/src' } } };
    subject.prjInfo = { device: 'none' };
    subject.prjPath = '02_mux2/prj';
    assert.equal(await subject.launchInternal({}), undefined);
    assert.equal(subject.vivadoState, '失败');
    assert(messages[0].includes('不是 Vivado 安装路径错误'));
    assert(text.includes('DIDE_LAUNCH_READY'));
    assert(text.includes('DIDE_LAUNCH_FAILED:'));
    assert(!text.includes("t('error.pl.launch.not-valid-vivado-path'"));
    console.log('PASS: part none rejected before project creation/process launch; correct diagnostic; startup markers present');
})().catch(error => { console.error(error); process.exitCode = 1; });