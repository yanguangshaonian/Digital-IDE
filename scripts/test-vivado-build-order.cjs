const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('xilinx.ts', fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'XilinxOperation');
const members = cls.members.filter(n => ['build', 'getBitstreamCommands', 'generateBit'].includes(n.name?.getText(source))).map(n => n.getText(source)).join('\n');
let script;
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${members} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, {
    vscode: { window: { showInformationMessage() {} } },
    hdlFile: { writeFile: (_path, text) => { script = text; return true; } },
    HardwareOutput: { report() {} }, ReportType: {},
    fs: { existsSync: () => false }, quoteTcl: JSON.stringify, loadTclScript: x => x
});
const subject = new Subject();
subject.prjConfig = { soc: { core: 'none' } };
subject.prjInfo = { path: 'project', name: 'design' };
subject.scriptPath = name => `${name}.tcl`;
let sent = 0;
subject.sendCommand = () => { sent++; };
subject.build({});
assert.equal(sent, 1, 'full build sends a single ordered script');
const stages = ['launch_runs synth_1', 'wait_on_run synth_1', 'Synthesis failed', 'launch_runs impl_1', 'wait_on_run impl_1', 'Implementation failed', 'open_run impl_1', 'write_bitstream'];
let last = -1;
for (const stage of stages) {
    const index = script.indexOf(stage);
    assert(index > last, `Incorrect order: ${stage}`);
    last = index;
}
assert.equal(script.split('write_bitstream').length - 1, 1);
subject.generateBit({});
assert.equal(sent, 2);
assert(script.includes('write_bitstream'));
assert(!script.includes('launch_runs'));
console.log('PASS: synthesis -> implementation -> bitstream, failure guards, one build request, standalone bit generation');