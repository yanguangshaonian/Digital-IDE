const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const source = ts.createSourceFile('xilinx.ts', fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'XilinxOperation');
const method = cls.members.find(n => n.name?.getText(source) === 'onVivadoClose');
const launch = cls.members.find(n => n.name?.getText(source) === 'launchInternal').getText(source);
assert(launch.indexOf('const closePaths') < launch.indexOf('await '));
assert(launch.includes('onVivadoClose(closePaths)'));
const moves = [];
const code = ts.transpileModule(`class Subject { ${method.getText(source)} }; Subject`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 }
}).outputText;
const Subject = vm.runInNewContext(code, {
    // Any late read of the current workspace is a regression.
    opeParam: new Proxy({}, { get() { throw Error('global workspace accessed during close'); } }),
    hdlDir: { isDir: () => true, mvdir: (...args) => moves.push(args) },
    HardwareOutput: { report() {} }
});
(async () => {
    await new Subject().onVivadoClose(Object.freeze({
        workspacePath: 'A', plName: 'projectA', targetPath: 'A/user'
    }));
    assert.equal(moves.length, 4);
    for (const [source, target] of moves) {
        assert(source.startsWith('A/prj/xilinx/projectA.'));
        assert.equal(target, 'A/user');
    }
    console.log('PASS: delayed Vivado close uses captured workspace only; no global reads');
})().catch(error => { console.error(error); process.exitCode = 1; });