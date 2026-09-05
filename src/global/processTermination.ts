import * as childProcess from 'child_process';
import * as path from 'path';
import * as iconv from 'iconv-lite';

// Kept independent of VS Code so shutdown races can be tested without hardware.
export interface TerminationRuntime {
    platform: NodeJS.Platform;
    selfPid: number;
    env: NodeJS.ProcessEnv;
    execFile: typeof childProcess.execFile;
    kill: typeof process.kill;
}

const runtime: TerminationRuntime = {
    platform: process.platform,
    selfPid: process.pid,
    env: process.env,
    execFile: childProcess.execFile,
    kill: process.kill.bind(process)
};

export function decodeProcessOutput(buffer: Buffer, encoding: string): string {
    if (!iconv.encodingExists(encoding)) {
        throw new Error(`Unsupported process output encoding: ${encoding}`);
    }
    return iconv.decode(buffer, encoding);
}

function execute(rt: TerminationRuntime, file: string, args: string[]) {
    return new Promise<{
        error: childProcess.ExecFileException | null;
        stdout: Buffer;
        stderr: Buffer;
    }>((resolve) => {
        rt.execFile(file, args, { encoding: 'buffer', windowsHide: true },
            (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });
}

function isAbsent(pid: number, rt: TerminationRuntime): boolean {
    try {
        rt.kill(pid, 0);
        return false;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ESRCH') { return true; }
        // EPERM means it may exist. Do not interpret it as successful cleanup.
        if (code === 'EPERM') { return false; }
        throw error;
    }
}

async function windowsEncoding(rt: TerminationRuntime, systemDir: string): Promise<string> {
    // Explicit override for hosts whose console encoding differs from chcp.
    // Set this in the environment BEFORE starting VS Code, e.g. cp936 or utf8.
    const override = rt.env.DIDE_PROCESS_OUTPUT_ENCODING?.trim();
    if (override) {
        decodeProcessOutput(Buffer.alloc(0), override);
        return override;
    }
    const result = await execute(rt, path.win32.join(systemDir, 'cmd.exe'), ['/d', '/c', 'chcp']);
    // The label is localized, but the code-page number is ASCII on Windows.
    const codePage = result.stdout.toString('ascii').match(/\b(\d+)\s*$/)?.[1];
    const encoding = codePage === '65001' ? 'utf8' : `cp${codePage}`;
    if (result.error || !codePage || !iconv.encodingExists(encoding)) {
        throw new Error('Cannot determine Windows process output code page; set DIDE_PROCESS_OUTPUT_ENCODING (e.g. cp936 or utf8) before starting VS Code.');
    }
    return encoding;
}

/** Returns false when already gone, true when termination was requested successfully. */
export async function terminateProcess(pid: number, rt: TerminationRuntime = runtime): Promise<boolean> {
    // Exclude process groups, init/system PIDs, this extension host, and injection.
    if (!Number.isSafeInteger(pid) || pid <= 1 || pid > 0x7fffffff || pid === rt.selfPid) {
        throw new RangeError(`Refusing to terminate invalid or protected PID: ${pid}`);
    }
    if (isAbsent(pid, rt)) { return false; }

    if (rt.platform !== 'win32') {
        // Native POSIX errors avoid shell output/locale ambiguity altogether.
        try {
            rt.kill(pid, 'SIGKILL');
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') { return false; }
            throw error;
        }
    }

    const root = rt.env.SystemRoot || rt.env.WINDIR;
    if (!root || !path.win32.isAbsolute(root)) {
        throw new Error('Cannot locate Windows system directory (SystemRoot/WINDIR).');
    }
    const systemDir = path.win32.join(root, 'System32');
    const encoding = await windowsEncoding(rt, systemDir);
    // Recheck after async code-page detection, but never retry a numeric PID.
    if (isAbsent(pid, rt)) { return false; }
    const { error, stdout, stderr } = await execute(rt,
        path.win32.join(systemDir, 'taskkill.exe'), ['/PID', String(pid), '/F']);
    if (!error) { return true; }

    // taskkill reports missing/exited targets with 128. Confirm independently;
    // never swallow permission failures, launch failures, signals or timeouts.
    if (error.code === 128 && !error.killed && !error.signal && isAbsent(pid, rt)) {
        return false;
    }
    const detail = [decodeProcessOutput(stderr, encoding).trim(),
        decodeProcessOutput(stdout, encoding).trim()].filter(Boolean).join('\n');
    // execFile's error.message can itself embed incorrectly decoded output.
    // Keep metadata and the original error, but build the visible message afresh.
    throw Object.assign(new Error(`taskkill PID ${pid} failed (${error.code ?? 'unknown'}): ${detail || 'No diagnostic output'}`), {
        code: error.code,
        signal: error.signal,
        killed: error.killed,
        originalError: error
    });
}

export async function getProcessOutputEncoding(): Promise<string> {
    if (process.platform !== 'win32') { return 'utf8'; }
    const root = process.env.SystemRoot || process.env.WINDIR;
    if (!root) { throw new Error('无法确定 Windows 系统目录'); }
    return windowsEncoding(runtime, path.win32.join(root, 'System32'));
}

export function createOutputDecoder(encoding: string) {
    return iconv.getDecoder(encoding);
}