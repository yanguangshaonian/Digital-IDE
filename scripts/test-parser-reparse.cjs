// Run the real parser cache/classes without the editor or language server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, { exports, require: name => {
        if (name in dependencies) { return dependencies[name]; }
        throw new Error(`Unexpected dependency: ${name}`);
    }, console });
    return exports;
}
const common = load('src/hdlParser/common.ts', { vscode: {} });
const { hdlParam, HdlFile } = load('src/hdlParser/core.ts', {
    vscode: {}, os: require('node:os'),
    '../global': { opeParam: {} },
    '../global/enum': { HdlLangID: { Verilog: 'verilog', Vhdl: 'vhdl' } },
    '../global/outputChannel': { MainOutput: { report() {} }, ReportType: {} },
    './common': common,
    '../hdlFs': { hdlFile: {}, hdlPath: { toSlash: p => p.replace(/\\/g, '/') } },
    './util': { defaultMacro: {}, defaultRange: {} },
    '../i18n': { t: x => x }
});
const raw = name => ({ name, archName: '', range: {}, params: [], ports: [], instances: [] });
const make = (path, name, type) => new HdlFile(path, 'verilog', {}, [raw(name)], type, 'common');
hdlParam.clear();
const ip = make('project/ip/core.v', 'core', common.HdlFileProjectType.IP);
const other = make('project/sim/other.v', 'mux2_tb', common.HdlFileProjectType.Sim);
let previous;
for (let i = 0; i < 6; i++) {
    const file = make('project/sim/tb.v', 'mux2_tb', common.HdlFileProjectType.Sim);
    const module = file.getHdlModule('mux2_tb');
    assert.equal(hdlParam.getHdlFile(file.path), file);
    assert.equal(hdlParam.getAllHdlFiles().length, 3);
    assert.equal(hdlParam.modules.size, 3);
    assert.equal(hdlParam.getSimTopModules().length, 2, 'distinct files with the same module name remain visible');
    assert.equal(hdlParam.getSimTopModules().filter(m => m.path === file.path).length, 1);
    if (previous) { assert(!hdlParam.modules.has(previous)); }
    hdlParam.setHdlFile(file);
    assert.equal(file.getHdlModule('mux2_tb'), module, 'registering the same object is a no-op');
    assert.equal(hdlParam.getHdlFile(ip.path), ip, 'unrelated IP cache survives');
    assert.equal(hdlParam.getHdlFile(other.path), other);
    previous = module;
}
make('project/sim/tb.v', 'renamed_tb', common.HdlFileProjectType.Sim);
assert(!hdlParam.modules.has(previous));
assert.equal(hdlParam.getSimTopModules().filter(m => m.name === 'renamed_tb').length, 1);
hdlParam.deleteHdlFile('project/sim/tb.v');
assert.equal(hdlParam.getSimTopModules().length, 1);
console.log('PASS: repeated HDL reparse has one node per file, old modules removed, same-name files and IP preserved, rename/delete clean');