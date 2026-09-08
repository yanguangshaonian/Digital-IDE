const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = ts.createSourceFile('xilinx.ts', fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'XilinxOperation');
const members = cls.members.filter(n => ['simulate', 'simulateCli', 'simulateGui'].includes(n.name?.getText(source))).map(n => n.getText(source)).join('\n');
let script;
const Subject = vm.runInNewContext(ts.transpileModule(`class Subject { ${members} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText, {
    vscode: { window: { showInformationMessage() {} } },
    hdlFile: { writeFile: (_path, content) => { script = content; return true; } },
    HardwareOutput: { report() {} }, ReportType: {}, quoteTcl: JSON.stringify, loadTclScript: x => x
});
const subject = new Subject();
subject.scriptPath = () => 'test script.tcl';
subject.topMod = { sim: 'tb' };
const context = {};
subject.sendCommand = ctx => assert.equal(ctx, context);
for (const mode of ['simulate', 'simulateCli', 'simulateGui']) {
    subject[mode](5432, context);
    assert(script.includes('run 5432 ns'));
    assert(!script.includes('run 1us'));
    for (const value of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '2; exit']) {
        assert.throws(() => subject[mode](value, context), /正整数/);
    }
}
const manager = fs.readFileSync('src/manager/index.ts', 'utf8');
assert(manager.includes("simulateWithDuration('simulate')"));
assert(manager.includes("simulateWithDuration('simulateCli')"));
assert(manager.includes("simulateWithDuration('simulateGui')"));
assert(manager.includes("requestSimulationDuration('Vivado → VCD → VS Code')"));
const wrapper = manager.slice(manager.indexOf('const simulateWithDuration'), manager.indexOf("registerHardwareCommand('digital-ide.hard.simulate',"));
assert(wrapper.indexOf('if (duration === undefined) { return; }') < wrapper.indexOf('return plManage[mode](Number(duration))'));
const translations = JSON.parse(fs.readFileSync('l10n/bundle.l10n.zh-cn.json', 'utf8'));
assert.equal(translations['Vivado simulation: export VCD and open in VS Code'], 'Vivado 仿真：导出 VCD 波形并在 VS Code 中打开');
console.log('PASS: all simulation modes accept duration, invalid input blocked, cancel before dispatch, Chinese VCD tooltip');