const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { Worker } = require('node:worker_threads');

const source = fs.readFileSync('src/function/dide-netlist/worker.ts', 'utf8');
assert(!source.includes('process.stdin.fd'), 'Yosys must not inherit the host stdin');
assert(!source.includes('wmic logicaldisk'), 'must not enumerate every Windows volume');
assert(source.includes("openSync(os.devNull, 'r')"));
assert(source.includes('hierarchy -top'));
assert(source.includes('verilog_defaults -add -I'));
assert(source.includes('appendLog'));

const host = fs.readFileSync('src/function/dide-netlist/index.ts', 'utf8');
assert(host.includes('runWorker'));
assert(!host.includes('waitForFinish'));
assert(host.includes('fs.existsSync(logFilePath)'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-netlist-'));
const file = path.join(root, 'worker.js');
fs.writeFileSync(file, ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText);
const worker = new Worker(file);
(async () => {
    try {
        const messages = [];
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('worker did not finish')), 2000);
            worker.on('message', message => {
                messages.push(message);
                if (message.command === 'finish') { clearTimeout(timer); resolve(); }
            });
            worker.once('error', reject);
            worker.postMessage({ command: 'open', data: {
                moduleName: 'tb', mode: 'before', filelist: ['tb.vhd'],
                ope: { workspacePath: root, libCommonPath: root, prjPath: root, extensionPath: root }
            } });
        });
        const failure = messages.find(message => message.command === 'error-log-file');
        assert(failure);
        const log = fs.readFileSync(failure.data.logFilePath, 'utf8');
        assert(log.includes('NetList currently supports Verilog/SystemVerilog sources only.'));
        assert.equal(messages.at(-1).command, 'finish');
        console.log('PASS: netlist worker finishes on unsupported sources, writes non-empty log');
    } finally {
        await worker.terminate();
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
