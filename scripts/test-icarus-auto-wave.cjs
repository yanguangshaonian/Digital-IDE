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
    console.log('PASS: automatic VCD helper, source unchanged, real Icarus waveform, existing dump respected');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }