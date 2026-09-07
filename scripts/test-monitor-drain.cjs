const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = ts.createSourceFile('monitor.ts', fs.readFileSync('src/monitor/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n));
const selected = ['accepting', 'pending', 'dispatch', 'close'];
const methods = cls.members.filter(n => selected.includes(n.name?.getText(source))).map(n => n.getText(source)).join('\n');
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${methods} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, { MainOutput: { report() {} }, ReportType: { Error: 1 } });
(async () => {
    const subject = new Subject();
    const watcher = { close: async () => {} };
    subject.hdlMonitor = watcher;
    subject.accepting = true;
    let release;
    let finish = false;
    let skipped = false;
    subject.dispatch(watcher, async () => {
        await new Promise(resolve => { release = resolve; });
        finish = true;
    });
    await Promise.resolve();
    subject.dispatch(watcher, async () => { skipped = true; });
    let closed = false;
    const closing = subject.close().then(() => { closed = true; });
    await Promise.resolve();
    assert.equal(closed, false);
    release();
    await closing;
    assert.equal(finish, true);
    assert.equal(skipped, false);
    assert.equal(subject.hdlMonitor, undefined);
    subject.accepting = true;
    subject.hdlMonitor = { close: async () => {} };
    subject.dispatch(watcher, async () => { skipped = true; });
    await subject.pending;
    assert.equal(skipped, false);
    console.log('PASS: watcher close drains running callbacks, skips queued/obsolete callbacks, clears handles');
})().catch(error => { console.error(error); process.exitCode = 1; });