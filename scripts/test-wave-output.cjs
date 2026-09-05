const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectWaveOutput } = require('../out/function/sim/waveOutput');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-wave-'));
try {
    const output = path.join(root, 'prj', 'icarus');
    fs.writeFileSync(path.join(root, 'wave.vcd'), 'wave');
    fs.writeFileSync(path.join(root, 'wave.view'), 'layout');
    const target = collectWaveOutput(root, 'wave.vcd', output);
    assert.equal(fs.readFileSync(target, 'utf8'), 'wave');
    assert.equal(fs.readFileSync(path.join(output, 'wave.view'), 'utf8'), 'layout');
    assert.equal(fs.existsSync(path.join(root, 'wave.vcd')), false);
    fs.writeFileSync(path.join(root, 'wave.vcd'), 'updated');
    collectWaveOutput(root, 'wave.vcd', output);
    assert.equal(fs.readFileSync(target, 'utf8'), 'updated');
    assert.equal(fs.readFileSync(path.join(output, 'wave.view'), 'utf8'), 'layout');
    const explicit = path.join(root, 'explicit.vcd');
    fs.writeFileSync(explicit, 'explicit');
    assert.equal(collectWaveOutput(root, explicit, output), explicit);
    assert.equal(fs.existsSync(explicit), true);
    console.log('PASS: default wave archive, layout migration/preservation, repeated run, explicit path');
} finally { fs.rmSync(root, { recursive: true, force: true }); }