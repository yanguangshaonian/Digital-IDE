import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as os from 'os';
import { WASI } from 'wasi';

type SynthMode = 'before' | 'after' | 'RTL';
type AbsPath = string;

interface SimpleOpe {
    workspacePath: string,
    libCommonPath: string,
    prjPath: string,
    extensionPath: string
}

function report(command: string, data: Record<string, unknown> = {}) {
    parentPort?.postMessage({ command, data });
}

if (parentPort) {
    parentPort.on('message', message => {
        const command = message.command as string;
        const data = message.data;
        const task = command === 'open' ? open(data) : command === 'run' ? run(data) : Promise.resolve();
        void task.catch(error => {
            report('error-log-file', { logFilePath: '', error: String(error) });
            report('finish', { error: String(error) });
        });
    });
}

async function open(data: { moduleName: string, mode: SynthMode, filelist: AbsPath[], ope: SimpleOpe }) {
    await new Netlist(data.ope).open(data.moduleName, data.filelist, data.mode);
}

async function run(data: { path: string, ope: SimpleOpe }) {
    await new Netlist(data.ope).runYs(data.path);
}

function neededWindowsMounts(paths: string[]): string[] {
    const letters = new Set<string>();
    for (const value of paths) {
        const match = String(value || '').match(/^([A-Za-z]):/);
        if (match) { letters.add(match[1].toUpperCase() + ':'); }
    }
    return [...letters];
}

function mkdir(path: AbsPath): boolean {
    if (!path) { return false; }
    if (fs.existsSync(path)) { return true; }
    fs.mkdirSync(path, { recursive: true });
    return fs.existsSync(path);
}

function join(...paths: string[]): AbsPath {
    return paths.join('/');
}

function appendLog(path: AbsPath, text: string) {
    mkdir(path.replace(/[\\/][^\\/]+$/, '') || '.');
    fs.appendFileSync(path, text.endsWith('\n') ? text : text + '\n');
}

function isVlog(file: AbsPath): boolean {
    return ['.v', '.vh', '.vl', '.sv'].some(ext => file.toLowerCase().endsWith(ext));
}

class Netlist {
    wsName = '{workspace}';
    libName = '{library}';
    ope: SimpleOpe;
    wasm?: WebAssembly.Module;

    constructor(ope: SimpleOpe) {
        this.ope = ope;
    }

    public async open(moduleName: string, filelist: AbsPath[], mode: SynthMode) {
        const logFilePath = join(this.ope.prjPath, 'netlist', moduleName + '.log');
        mkdir(join(this.ope.prjPath, 'netlist'));
        try {
            const targetYs = this.makeYs(filelist, moduleName, mode);
            if (!targetYs) {
                throw new Error('NetList currently supports Verilog/SystemVerilog sources only.');
            }
            await this.runYosys(targetYs, logFilePath, join(this.ope.prjPath, 'netlist', moduleName + '.json'));
        } catch (error) {
            appendLog(logFilePath, `NetList failed: ${String(error)}`);
            report('error-log-file', { logFilePath, error: String(error) });
        } finally {
            report('finish', {});
        }
    }

    private mapGuestPath(file: AbsPath): string | undefined {
        const slash = file.replace(/\\/g, '/');
        if (slash.startsWith(this.ope.workspacePath)) {
            return slash.replace(this.ope.workspacePath, this.wsName);
        }
        if (this.ope.libCommonPath && slash.startsWith(this.ope.libCommonPath)) {
            return slash.replace(this.ope.libCommonPath, this.libName);
        }
        return undefined;
    }

    private makeYs(files: AbsPath[], topModule: string, mode: SynthMode) {
        const folder = join(this.ope.prjPath, 'netlist');
        mkdir(folder);
        const target = join(folder, topModule + '.ys');
        const targetJson = this.mapGuestPath(join(folder, topModule + '.json'));
        const scripts: string[] = [];
        const includes = new Set<string>();
        const mapped: string[] = [];
        for (const file of files) {
            if (!isVlog(file)) { return undefined; }
            const guest = this.mapGuestPath(file);
            if (!guest) { continue; }
            mapped.push(guest);
            const parent = this.mapGuestPath(file.replace(/[\\/][^\\/]+$/, ''));
            if (parent) { includes.add(parent); }
        }
        if (!mapped.length || !targetJson) { return undefined; }
        for (const directory of includes) {
            scripts.push(`verilog_defaults -add -I ${directory}`);
        }
        for (const guest of mapped) {
            scripts.push(`read_verilog -sv -formal -overwrite ${guest}`);
        }
        switch (mode) {
            case 'before':
                scripts.push('design -reset-vlog; proc;');
                break;
            case 'after':
                scripts.push('design -reset-vlog; proc; opt_clean;');
                break;
            case 'RTL':
                scripts.push('synth -run coarse;');
                break;
        }
        scripts.push(`hierarchy -top ${topModule}`);
        scripts.push(`write_json ${targetJson}`);
        fs.writeFileSync(target, scripts.join('\n') + '\n', { encoding: 'utf-8' });
        return this.mapGuestPath(target);
    }

    public getPreopens() {
        const preopens: Record<string, string> = {
            '/share': join(this.ope.extensionPath, 'resources', 'dide-netlist', 'static', 'share'),
            [this.wsName]: this.ope.workspacePath,
            [this.libName]: this.ope.libCommonPath || this.ope.workspacePath
        };
        if (os.platform() === 'win32') {
            for (const letter of neededWindowsMounts([
                this.ope.workspacePath, this.ope.libCommonPath, this.ope.extensionPath, this.ope.prjPath
            ])) {
                preopens[letter + '/'] = letter + '/';
                preopens[letter.toLowerCase() + '/'] = letter + '/';
            }
        } else {
            preopens['/'] = '/';
        }
        return preopens;
    }

    private async runYosys(script: string, logFilePath: string, targetJson?: string) {
        mkdir(join(this.ope.prjPath, 'netlist'));
        appendLog(logFilePath, `yosys -s ${script}`);
        if (targetJson && fs.existsSync(targetJson)) { fs.rmSync(targetJson, { force: true }); }
        if (!this.wasm) { this.wasm = await this.loadWasm(); }
        const stdinFd = fs.openSync(os.devNull, 'r');
        const logFd = fs.openSync(logFilePath, 'a');
        try {
            const wasi = new WASI({
                version: 'preview1',
                args: ['yosys', '-s', script],
                preopens: this.getPreopens(),
                stdin: stdinFd,
                stdout: logFd,
                stderr: logFd,
                env: {}
            } as ConstructorParameters<typeof WASI>[0]);
            const instance = await WebAssembly.instantiate(this.wasm, {
                wasi_snapshot_preview1: wasi.wasiImport
            });
            try {
                wasi.start(instance);
            } catch (error) {
                if (!/WASIProcExit|proc_exit|exit_code/i.test(String(error))) { throw error; }
            }
        } finally {
            fs.closeSync(stdinFd);
            fs.closeSync(logFd);
        }
        if (targetJson && !fs.existsSync(targetJson)) {
            const yosys = fs.existsSync(logFilePath) ? fs.readFileSync(logFilePath, 'utf8').trim() : '';
            throw new Error(yosys || `Yosys did not write ${targetJson}`);
        }
    }

    private async loadWasm() {
        return WebAssembly.compile(new Uint8Array(fs.readFileSync(join(this.ope.extensionPath, 'resources', 'dide-netlist', 'static', 'yosys.wasm'))));
    }

    public getJsonPathFromYs(path: AbsPath): AbsPath | undefined {
        for (const line of fs.readFileSync(path, { encoding: 'utf-8' }).split('\n')) {
            if (line.trim().startsWith('write_json')) {
                const guest = line.split(/\s+/).at(1);
                if (guest) {
                    return guest
                        .replace(this.wsName, this.ope.workspacePath)
                        .replace(this.libName, this.ope.libCommonPath)
                        .replace(/\\/g, '/');
                }
            }
        }
        return undefined;
    }

    public async runYs(path: string) {
        const ysPath = path.replace(/\\/g, '/');
        const name = ysPath.split('/').at(-1) as string;
        const logFilePath = join(this.ope.prjPath, 'netlist', name + '.log');
        mkdir(join(this.ope.prjPath, 'netlist'));
        try {
            await this.runYosys(ysPath, logFilePath, this.getJsonPathFromYs(ysPath));
        } catch (error) {
            appendLog(logFilePath, `NetList failed: ${String(error)}`);
            report('error-log-file', { logFilePath, error: String(error) });
        } finally {
            report('finish', {});
        }
    }
}