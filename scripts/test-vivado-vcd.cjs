const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/manager/PL/vcd.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, { exports: exportsObject, require: () => ({ quoteTcl: x => JSON.stringify(x) }) });
const make = exportsObject.makeVivadoVcdScript;
assert.equal(exportsObject.makeVivadoVcdName('mux2_tb', new Date(2026, 7, 22, 14, 8, 14)), 'mux2_tb_2026_08_22_140814');
assert.equal(exportsObject.makeVivadoVcdName('tb/invalid', new Date(2026, 0, 2, 3, 4, 5)), 'tb_invalid_2026_01_02_030405');
const script = make('project A/prj/vivado/tb.vcd', 2000, 'test_1');
assert(script.indexOf('restart') < script.indexOf('open_vcd'));
assert(script.indexOf('log_vcd') < script.indexOf('run 2000 ns'));
assert(script.indexOf('close_vcd') < script.indexOf('DIDE_VCD_DONE_test_1'));
assert(script.includes('DIDE_VCD_ERROR_test_1'));
assert.throws(() => make('test.vcd', 0, 'test'));
assert.throws(() => make('test.vcd', 2, 'bad;token'));
console.log('PASS: VCD restart/log/run/close ordering, error marker, finite duration validation');