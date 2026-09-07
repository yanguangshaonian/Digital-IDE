// Exercise the actual tree methods with isolated parser/editor state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = ts.createSourceFile('tree.ts', fs.readFileSync('src/function/treeView/tree.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'ModuleTreeProvider');
const names = ['getTopModuleItemList', 'resetTopSelection', 'setFirstTop', 'makeFirstTopIconName'];
const methods = cls.members.filter(n => names.includes(n.name?.getText(source))).map(n => n.getText(source)).join('\n');
let modules = [];
const opeParam = { firstSrcTopModule: {}, firstSimTopModule: {} };
const code = ts.transpileModule(`class Subject { ${methods} }; Subject`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const Subject = vm.runInNewContext(code, { opeParam, hdlParam: {
    getTopModulesByType: () => modules,
    getAllDependences: () => undefined
} });
const subject = new Subject();
subject.firstTop = { src: null, sim: null };
subject.judgeTopModuleIconByDoFastType = () => 'file';
const root = { name: 'sim' };
const makeModule = (path, name, archName) => ({ path, name, archName, file: {} });
modules = [makeModule('01/user/sim/tb.v', 'tb_led_blink')];
assert.equal(subject.getTopModuleItemList(root)[0].icon, 'current-sim-top');
modules = [makeModule('02/user/sim/tb.v', 'tb_led_blink')];
assert.equal(subject.getTopModuleItemList(root)[0].path, '02/user/sim/tb.v');
modules = [makeModule('02/user/sim/tb0.v', 'tb_led_blink0_0')];
assert.equal(subject.getTopModuleItemList(root)[0].name, 'tb_led_blink0_0');
assert.equal(opeParam.firstSimTopModule.name, 'tb_led_blink0_0');
modules = [];
assert.equal(subject.getTopModuleItemList(root).length, 0);
assert.equal(subject.firstTop.sim, null);
assert.equal(opeParam.firstSimTopModule.path, undefined);
modules = [makeModule('02/tb.vhd', 'tb', 'rtl')];
assert.equal(subject.getTopModuleItemList(root)[0].name, 'tb(rtl)');
assert.equal(subject.getTopModuleItemList(root)[0].icon, 'current-sim-top');
subject.resetTopSelection();
assert.equal(subject.firstTop.sim, null);
assert.equal(subject.firstTop.src, null);
console.log('PASS: cross-root same-name, renamed top, empty tree, zero/missing dependencies, VHDL architecture, reset');