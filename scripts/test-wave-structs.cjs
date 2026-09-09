const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
function load(file, deps) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, { exports, require: name => {
        if (name in deps) { return deps[name]; }
        throw new Error('Unexpected dependency: ' + name);
    }, console });
    return exports;
}
const { collectPackedStructs, expandPackedStructVcd } = load('src/function/sim/waveStructs.ts', { fs, path });
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-struct-'));
try {
    const types = path.join(root, 'mux2_types.svh');
    const source = path.join(root, 'mux2.sv');
    fs.writeFileSync(types, 'typedef struct packed { logic a; logic b; logic sel; } Mux2Field;');
    fs.writeFileSync(source, '`include "mux2_types.svh"\nmodule Mux2(input Mux2Field mux2_field_ref, output logic y_ref);\nMux2Field mux_field_ref;\nendmodule\n');
    const structs = collectPackedStructs([source]);
    assert.equal(structs[0].name, 'Mux2Field');
    assert.equal(structs[0].fields.map(f => f.name).join(','), 'a,b,sel');
    const icarus = path.join(root, 'icarus.vcd');
    fs.writeFileSync(icarus, [
        '$scope module mux2_tb $end',
        '$var reg 3 " mux_field_ref [2:0] $end',
        '$enddefinitions $end',
        '#0',
        'b100 "',
        '#10',
        'b101 "',
        ''
    ].join('\n'));
    expandPackedStructVcd(icarus, [source]);
    const icarusText = fs.readFileSync(icarus, 'utf8');
    assert(icarusText.includes('$var reg 1 S1 mux_field_ref.a $end'));
    assert(icarusText.includes('$var reg 1 S2 mux_field_ref.b $end'));
    assert(icarusText.includes('$var reg 1 S3 mux_field_ref.sel $end'));
    assert(icarusText.includes('1S1'));
    assert(icarusText.includes('0S2'));
    assert(icarusText.includes('0S3'));
    assert(icarusText.includes('1S3'));
    const omitted = path.join(root, 'omitted.vcd');
    fs.writeFileSync(omitted, [
        '$scope module mux2_tb $end',
        '$var reg 3 " mux_field_ref [2:0] $end',
        '$enddefinitions $end',
        '#0',
        'b11 "',
        ''
    ].join('\n'));
    expandPackedStructVcd(omitted, [source]);
    const omittedText = fs.readFileSync(omitted, 'utf8');
    assert(omittedText.includes('0S1'));
    assert(omittedText.includes('1S2'));
    assert(omittedText.includes('1S3'));
    expandPackedStructVcd(icarus, [source]);
    assert.equal([...icarusText.matchAll(/mux_field_ref\.a/g)].length, [...fs.readFileSync(icarus, 'utf8').matchAll(/mux_field_ref\.a/g)].length);
    const xsim = path.join(root, 'xsim.vcd');
    fs.writeFileSync(xsim, [
        '$scope module mux2_tb $end',
        '$var reg 96 ! mux_field_ref $end',
        '$enddefinitions $end',
        '#0',
        'bx1xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx0xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx0 !',
        ''
    ].join('\n'));
    expandPackedStructVcd(xsim, [source]);
    const xsimText = fs.readFileSync(xsim, 'utf8');
    assert(xsimText.includes('$var reg 1 S1 mux_field_ref.a $end'));
    assert(xsimText.includes('1S1'));
    assert(xsimText.includes('0S2'));
    assert(xsimText.includes('0S3'));
    console.log('PASS: packed struct fields expanded from Icarus and XSim VCD');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
