const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const exportsObject = {};
const folders = ['01_mux2', '02_mux2'].map(name => ({ name, uri: { toString: () => name } }));
const code = ts.transpileModule(fs.readFileSync('src/manager/workspaceContext.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
vm.runInNewContext(code, { exports: exportsObject, require: () => ({
    workspace: { workspaceFolders: folders, getWorkspaceFolder: uri => folders.find(folder => folder.name === uri.folder) }
}) });
const { runInWorkspace, configureWorkspaceContext } = exportsObject;
(async () => {
    const events = [];
    let active = 'Digital-IDE';
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    // A simulation invoked before startup completion must wait.
    const first = runInWorkspace({ folder: '02_mux2' }, async () => {
        assert.equal(active, '02_mux2');
        events.push('simulate');
        await pending;
        assert.equal(active, '02_mux2');
    });
    configureWorkspaceContext(async folder => {
        await Promise.resolve();
        active = folder.name;
        events.push(active);
    });
    const second = runInWorkspace({ folder: '01_mux2' }, async () => events.push('next'));
    release();
    await Promise.all([first, second]);
    assert.deepEqual(events, ['02_mux2', 'simulate', '01_mux2', 'next']);
    await assert.rejects(runInWorkspace({}, async () => {}));
    await assert.rejects(runInWorkspace({ folder: '02_mux2' }, async () => { throw Error('failure'); }));
    await runInWorkspace({ folder: '01_mux2' }, async () => assert.equal(active, '01_mux2'));
    events.length = 0;
    await Promise.all([
        exportsObject.followEditorWorkspace({ folder: '01_mux2' }),
        exportsObject.followEditorWorkspace({ folder: '02_mux2' })
    ]);
    assert.deepEqual(events, ['02_mux2']);
    await exportsObject.stopWorkspaceContext();
    await assert.rejects(runInWorkspace({ folder: '01_mux2' }, async () => {}));
    console.log('PASS: startup wait, target root, serialized simulation, outside-root rejection, failure recovery');
})().catch(error => { console.error(error); process.exitCode = 1; });