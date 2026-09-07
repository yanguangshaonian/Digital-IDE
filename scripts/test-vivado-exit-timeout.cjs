const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = ts.createSourceFile('xilinx.ts', fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'XilinxOperation');
const method = cls.members.find(n => n.name?.getText(source) === 'exit');
let timeout;
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${method.getText(source)} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, {
    HardwareOutput: { report() {} }, ReportType: { Warn: 1 },
    setTimeout(callback) { timeout = callback; return 1; }, clearTimeout() {}
});
(async () => {
    const process = Object.assign(new EventEmitter(), { exitCode: null, stdin: { destroyed: false } });
    const context = { process };
    const subject = new Subject();
    subject.sendCommand = () => {};
    const pending = subject.exit(context);
    const rejected = assert.rejects(pending, /退出超时/);
    timeout();
    await rejected;
    assert.equal(context.process, process);
    assert.equal(process.listenerCount('close'), 0);
    assert.equal(subject.exitPromise, undefined);
    console.log('PASS: exit timeout rejects, retains process, releases listener and allows retry');
})().catch(error => { console.error(error); process.exitCode = 1; });