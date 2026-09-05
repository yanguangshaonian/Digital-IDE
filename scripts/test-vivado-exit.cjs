// Execute the real exit method with fake process events, without loading VS Code.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const text = fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8');
const source = ts.createSourceFile('xilinx.ts', text, ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'XilinxOperation');
const method = cls.members.find(n => n.name?.getText(source) === 'exit');
const code = ts.transpileModule(`class Subject { ${method.getText(source)} }; Subject`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
let timers = 0;
const Subject = vm.runInNewContext(code, { HardwareOutput: { report() {} }, ReportType: { Warn: 1 },
    setTimeout() { timers++; return timers; }, clearTimeout() { timers--; } });
(async () => {
    const process = Object.assign(new EventEmitter(), { exitCode: null, stdin: { destroyed: false } });
    const context = { process };
    const subject = new Subject();
    let sent = 0;
    subject.sendCommand = () => { sent++; };
    const first = subject.exit(context);
    const second = subject.exit(context);
    assert.equal(sent, 1);
    assert.equal(process.listenerCount('close'), 1);
    process.exitCode = 0;
    process.emit('close');
    await Promise.all([first, second]);
    assert.equal(timers, 0);
    assert.equal(process.listenerCount('close'), 0);
    await subject.exit(context);
    assert.equal(sent, 1);
    assert.equal(context.process, undefined);
    console.log('PASS: concurrent Exit sends once, waits for close, clears timer, exited process is skipped');
})().catch(error => { console.error(error); process.exitCode = 1; });