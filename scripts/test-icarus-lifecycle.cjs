const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const path = require('node:path');
const source = ts.createSourceFile('simulate.ts', fs.readFileSync('src/function/sim/simulate.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'IcarusSimulate');
const names = ['runIverilog', 'runVvp'];
const methods = cls.members.filter(n => names.includes(n.name?.getText(source))).map(n => n.getText(source)).join('\n');
const callbacks = [];
const opeParam = { openMode: 'folder', workspacePath: 'A' };
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${methods} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, { opeParam, child_process: { exec(command, options, callback) { callbacks.push({ command, options, callback }); } },
    MainOutput: { report() {} }, ReportType: { Warn: 'Warn', Finish: 'Finish' },
    hdlPath: { join: path.posix.join }, makeSafeArgPath: x => `"${x}"` });
(async () => {
    const subject = new Subject();
    subject.reportCommandError = () => {};
    subject.handleVvpStdOutput = () => {};
    let done = false;
    const run = subject.runIverilog({ simulationHome: 'A/prj/icarus', vvpPath: 'tool path/vvp' }, 'compile', 'A/sim', { name: 'tb' }).then(() => { done = true; });
    opeParam.workspacePath = 'B';
    callbacks[0].callback(null, '', '');
    assert.equal(callbacks[1].options.cwd, 'A');
    assert(callbacks[1].command.includes('"tool path/vvp"'));
    await Promise.resolve();
    assert.equal(done, false);
    callbacks[1].callback(null, 'finished', '');
    await run;
    assert.equal(done, true);
    console.log('PASS: Icarus waits for vvp completion, captures cwd before callback, quotes executable paths');
})().catch(error => { console.error(error); process.exitCode = 1; });