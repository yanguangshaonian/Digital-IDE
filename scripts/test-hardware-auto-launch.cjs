const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function extract(file, className, names, globals) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const cls = source.statements.find(n => ts.isClassDeclaration(n) && n.name.text === className);
    const members = cls.members.filter(n => names.includes(n.name?.getText(source))).map(n => n.getText(source)).join('\n');
    return vm.runInNewContext(ts.transpileModule(`class Subject { ${members} }; Subject`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020 }
    }).outputText, globals);
}

async function main() {
    const output = { report() {}, show() {} };
    const Xilinx = extract('src/manager/PL/xilinx.ts', 'XilinxOperation', ['launch', 'ensureReady'], {
        HardwareOutput: output, ReportType: {}, vscode: { window: { showErrorMessage() {} } }
    });
    const readyProcess = () => ({ killed: false, exitCode: null, signalCode: null, stdin: { destroyed: false, writable: true } });
    const operation = new Xilinx();
    operation.assertWorkspace = () => {};
    const context = {};
    let launches = 0;
    let finish;
    operation.launchInternal = async ctx => {
        launches++;
        ctx.process = readyProcess();
        operation.vivadoState = '等待工具输出';
        await new Promise(resolve => { finish = resolve; });
        operation.vivadoState = '就绪';
    };
    let completed = false;
    const first = operation.ensureReady(context);
    const second = operation.ensureReady(context).then(() => { completed = true; });
    await Promise.resolve();
    assert.equal(completed, false, 'process handle alone must not bypass startup wait');
    assert.equal(launches, 1);
    finish();
    await Promise.all([first, second]);
    await operation.ensureReady(context);
    assert.equal(launches, 1, 'reuse ready session');
    context.process.exitCode = 1;
    const restart = operation.ensureReady(context);
    finish();
    await restart;
    assert.equal(launches, 2, 'restart dead session');
    operation.vivadoState = '失败';
    await assert.rejects(operation.ensureReady(context), /未就绪/);
    assert.equal(launches, 2, 'failed live session must not spawn duplicate');
    context.process = undefined;
    operation.launchInternal = async () => { operation.vivadoState = '失败'; };
    await assert.rejects(operation.ensureReady(context), /未就绪/);
    operation.exitPromise = Promise.resolve();
    await assert.rejects(operation.ensureReady(context), /未就绪/);

    class Efinity {}
    const actions = ['simulate', 'simulateCli', 'simulateGui', 'refresh', 'build', 'synth', 'impl', 'bitstream', 'program', 'gui'];
    const Manager = extract('src/manager/PL/index.ts', 'PlManage', ['dispatchWithSession', 'exit', ...actions], {
        XilinxOperation: Xilinx, EfinityOperation: Efinity, HardwareOutput: output
    });
    const manager = new Manager();
    manager.context = { ope: new Xilinx() };
    const calls = [];
    manager.context.ope.ensureReady = async () => { calls.push('ready'); };
    manager.dispatch = async action => { calls.push(action); return 'done'; };
    for (const action of actions) {
        calls.length = 0;
        assert.equal(await manager[action](), 'done');
        assert.deepEqual(calls, ['ready', action === 'bitstream' ? 'generateBit' : action]);
    }
    calls.length = 0;
    manager.context.ope.ensureReady = async () => { throw new Error('startup failed'); };
    await assert.rejects(manager.build(), /startup failed/);
    assert.deepEqual(calls, []);
    await manager.exit();
    assert.deepEqual(calls, ['exit'], 'Exit never launches a session');
    manager.context.ope = new Efinity();
    calls.length = 0;
    await manager.build();
    assert.deepEqual(calls, ['launch', 'build']);

    const tree = fs.readFileSync('src/function/treeView/command.ts', 'utf8');
    assert(!tree.slice(tree.indexOf('class HardwareTreeProvider'), tree.indexOf('class SoftwareTreeProvider')).includes('digital-ide.hard.launch'));
    assert(!JSON.parse(fs.readFileSync('package.json', 'utf8')).contributes.commands.some(c => c.command === 'digital-ide.hard.launch'));
    const source = fs.readFileSync('src/manager/PL/xilinx.ts', 'utf8');
    const vcd = source.slice(source.indexOf('public async exportVcd'), source.indexOf('public synth'));
    assert(vcd.indexOf('await this.ensureReady(context)') < vcd.indexOf('const process = context.process'));
    console.log('PASS: hardware auto-launch, startup dedup/wait/failure, ready reuse, dead-session restart, Exit without launch, hidden Launch, VCD readiness');
}
main().catch(error => { console.error(error); process.exitCode = 1; });