const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const exportsObject = {};
const simulationSource = fs.readFileSync('src/function/sim/simulate.ts', 'utf8');
assert(simulationSource.indexOf('command += ` -s ${autoWave.name}`') < simulationSource.indexOf("command += ' ' + extaArgs"), 'all root options must precede source files');
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/function/sim/autoWave.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, { exports: exportsObject, require });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-auto-wave-'));
try {
    const source = path.join(temp, 'tb.sv');
    const original = 'module tb; reg a=0; initial begin #10 a=1; #10 a=0; end endmodule';
    fs.writeFileSync(source, original);
    const helper = exportsObject.prepareAutoWave('tb', [source], temp);
    assert(helper);
    assert.equal(fs.readFileSync(source, 'utf8'), original);
    assert(fs.readFileSync(helper.file, 'utf8').includes('$dumpvars(0, tb)'));
    const compiler = process.argv[2];
    const runtime = process.argv[3];
    if (compiler && runtime) {
        const executable = path.join(temp, 'tb.vvp');
        const compile = spawnSync(compiler, ['-g2012', '-s', 'tb', '-s', helper.name, '-o', executable, source, helper.file], { encoding: 'utf8' });
        assert.equal(compile.status, 0, compile.stderr);
        const run = spawnSync(runtime, [executable], { cwd: temp, encoding: 'utf8', timeout: 10000 });
        assert.equal(run.status, 0, run.stderr);
        const wave = fs.readFileSync(path.join(temp, 'tb.vcd'), 'utf8');
        assert(wave.includes('$var'));
        assert(wave.includes('#20'));
    }
    fs.writeFileSync(source, 'module tb; initial $dumpvars(0, tb); endmodule');
    assert.equal(exportsObject.prepareAutoWave('tb', [source], temp), undefined);
    for (const explicit of [false, true]) {
        fs.writeFileSync(source, '`timescale 1ns/1ps\nmodule tb; reg clk=0; always #1 clk=~clk; ' +
            (explicit ? 'initial begin $dumpfile("custom.vcd"); $dumpvars(0,tb); end ' : '') + 'endmodule');
        const timed = exportsObject.prepareAutoWave('tb', [source], temp, 25);
        const helperText = fs.readFileSync(timed.file, 'utf8');
        assert.equal(helperText.includes('$dumpfile'), !explicit);
        if (compiler && runtime) {
            const compiled = spawnSync(compiler, ['-g2012', '-s', 'tb', '-s', timed.name, '-o', 'timed.vvp', source, timed.file], { cwd: temp, encoding: 'utf8' });
            assert.equal(compiled.status, 0, compiled.stderr);
            const simulated = spawnSync(runtime, ['timed.vvp'], { cwd: temp, encoding: 'utf8', timeout: 10000 });
            assert.equal(simulated.status, 0, simulated.error?.message || simulated.stderr);
            assert(simulated.stdout.includes('DIDE_ICARUS_DURATION_REACHED 25 ns'));
            const wave = fs.readFileSync(path.join(temp, explicit ? 'custom.vcd' : 'tb.vcd'), 'utf8');
            assert.equal([...wave.matchAll(/^#(\d+)/gm)].pop()[1], '25000');
        }
    }
    for (const invalid of [0, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => exportsObject.prepareAutoWave('tb', [source], temp, invalid), /Invalid simulation duration/);
    }
    const simulate = fs.readFileSync('src/function/sim/simulate.ts', 'utf8');
    assert(simulate.includes('resetWaveFiles('));
    const index = fs.readFileSync('src/function/index.ts', 'utf8');
    assert(index.includes("title: 'Icarus Verilog 仿真'"));
    assert(index.includes('if (duration === undefined) { return; }'));
    console.log('PASS: automatic VCD helper, bounded Icarus runtime, explicit dump preserved, invalid duration rejected');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }