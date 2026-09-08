const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { spawnSync } = require('node:child_process');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/function/sim/includePaths.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, { exports: exportsObject, require });
const collect = exportsObject.collectIncludeDirectories;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dide include test-'));
try {
    for (const dir of ['src/include/nested', 'sim']) { fs.mkdirSync(path.join(temp, dir), { recursive: true }); }
    const src = path.join(temp, 'src/mux.sv');
    const tb = path.join(temp, 'sim/tb.sv');
    fs.writeFileSync(src, '`include "include/types.svh"\n// `include "missing.svh"\n');
    fs.writeFileSync(tb, '`include "../src/include/types.svh"\n');
    fs.writeFileSync(path.join(temp, 'src/include/types.svh'), '`include "nested/child.svh"\n');
    fs.writeFileSync(path.join(temp, 'src/include/nested/child.svh'), '`include "../types.svh"\n');
    const directories = collect([tb, src]);
    for (const dir of ['src', 'sim', 'src/include', 'src/include/nested']) {
        assert(directories.includes(path.join(temp, dir)));
    }
    assert.equal(directories.length, 4, 'cycles and shared headers are deduplicated');
    const source = fs.readFileSync('src/function/sim/simulate.ts', 'utf8');
    assert(source.includes("command += ' -I ' + makeSafeArgPath(directory)"));
    console.log('PASS: source-relative includes, nested headers, cycle dedup, paths with spaces, separate -I arguments');
    // Optional real compiler check: executable, testbench, design source.
    const [compiler, testbench, design] = process.argv.slice(2);
    if (compiler) {
        const dirs = collect([testbench, design]);
        const args = ['-g2012', ...dirs.flatMap(dir => ['-I', dir]), '-s', 'mux2_tb', '-o', path.join(temp, 'mux2_tb.vvp'), testbench, design];
        const result = spawnSync(compiler, args, { cwd: path.dirname(testbench), encoding: 'utf8' });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stderr);
        console.log('PASS: actual mux2 project compiles with Icarus; output isolated in temporary directory');
    }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }