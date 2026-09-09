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
const cache = load('src/function/dide-viewer/waveCache.ts', { path });
const structs = load('src/function/sim/waveStructs.ts', { fs, path });
const { collectWaveOutput, resetWaveFiles, uniquifyVcdAliases } = load('src/function/sim/waveOutput.ts', {
    fs, path, '../dide-viewer/waveCache': cache, './waveStructs': structs
});
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-wave-'));
try {
    const output = path.join(root, 'prj', 'icarus');
    fs.writeFileSync(path.join(root, 'wave.vcd'), 'wave');
    fs.writeFileSync(path.join(root, 'wave.view'), 'layout');
    const target = collectWaveOutput(root, 'wave.vcd', output);
    assert.equal(fs.readFileSync(target, 'utf8'), 'wave');
    assert.equal(fs.existsSync(path.join(output, 'wave.view')), false);
    assert.equal(fs.existsSync(path.join(root, 'wave.vcd')), false);
    fs.writeFileSync(path.join(root, 'wave.vcd'), 'updated');
    fs.writeFileSync(path.join(root, 'wave.view'), 'new-layout');
    collectWaveOutput(root, 'wave.vcd', output);
    assert.equal(fs.readFileSync(target, 'utf8'), 'updated');
    assert.equal(fs.existsSync(path.join(output, 'wave.view')), false);
    const explicit = path.join(root, 'explicit.vcd');
    fs.writeFileSync(explicit, 'explicit');
    assert.equal(collectWaveOutput(root, explicit, output), explicit);
    assert.equal(fs.existsSync(explicit), true);
    fs.writeFileSync(path.join(output, 'wave.vcd'), 'stale');
    fs.writeFileSync(path.join(output, 'wave.view'), 'stale-layout');
    cache.mergePayloadCache(path.join(output, 'wave.view'), { stale: true });
    resetWaveFiles(path.join(output, 'wave.vcd'));
    assert.equal(fs.existsSync(path.join(output, 'wave.vcd')), false);
    assert.equal(fs.existsSync(path.join(output, 'wave.view')), false);
    assert.equal(cache.hasWaveLayout(path.join(output, 'wave.view')), false);
    const aliased = path.join(root, 'alias.vcd');
    fs.writeFileSync(aliased, [
        '$scope module tb $end',
        '$var wire 1 ! y $end',
        '$scope module u $end',
        '$var wire 1 ! y_ref $end',
        '$upscope $end',
        '$upscope $end',
        '$enddefinitions $end',
        '#0',
        '1!',
        '#10',
        '0!',
        ''
    ].join('\n'));
    uniquifyVcdAliases(aliased);
    const rewritten = fs.readFileSync(aliased, 'utf8');
    assert(rewritten.includes('$var wire 1 ! y $end'));
    assert(rewritten.includes('$var wire 1 !1 y_ref $end'));
    assert(rewritten.includes('1!'));
    assert(rewritten.includes('1!1'));
    assert(rewritten.includes('0!1'));
    console.log('PASS: default wave archive, layout replaced on rerun, explicit path, resetWaveFiles, unique VCD aliases');
} finally { fs.rmSync(root, { recursive: true, force: true }); }