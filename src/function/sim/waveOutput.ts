import * as fs from 'fs';
import * as path from 'path';
import { forgetWaveLayout } from '../dide-viewer/waveCache';

export function resetWaveFiles(...files: string[]) {
    for (const file of files) {
        if (!file) { continue; }
        const vcd = file.replace(/\.view$/i, '.vcd');
        const view = vcd.replace(/\.vcd$/i, '.view');
        fs.rmSync(vcd, { force: true });
        fs.rmSync(view, { force: true });
        forgetWaveLayout(vcd);
        forgetWaveLayout(view);
    }
}

function isVcdIdentifier(id: string): boolean {
    if (!id) { return false; }
    for (let i = 0; i < id.length; i++) {
        const code = id.charCodeAt(i);
        if (code < 33 || code > 126) { return false; }
    }
    return true;
}

function cloneValueLine(line: string, original: string, mapped: string): string | undefined {
    if (!line || line[0] === '$' || line[0] === '#') { return undefined; }
    if (line[0] === 'b' || line[0] === 'B' || line[0] === 'r' || line[0] === 'R') {
        const splitAt = line.lastIndexOf(' ');
        if (splitAt < 0 || line.slice(splitAt + 1) !== original) { return undefined; }
        return line.slice(0, splitAt + 1) + mapped;
    }
    if (line.slice(1) !== original) { return undefined; }
    return line[0] + mapped;
}

export function uniquifyVcdAliases(file: string): string {
    if (!fs.existsSync(file)) { return file; }
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const used = new Set<string>();
    const extras = new Map<string, string[]>();
    let next = 0;
    const allocate = (original: string): string => {
        next += 1;
        const candidate = original + String(next);
        if (used.has(candidate) || !isVcdIdentifier(candidate)) {
            return allocate(original);
        }
        return candidate;
    };
    const rewritten = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] !== '$var' || parts.length < 5 || parts[parts.length - 1] !== '$end') {
            return line;
        }
        const type = parts[1];
        const width = parts[2];
        const id = parts[3];
        const rest = parts.slice(4, -1).join(' ');
        if (!isVcdIdentifier(id)) { return line; }
        if (used.has(id)) {
            const mapped = allocate(id);
            used.add(mapped);
            const copies = extras.get(id) || [];
            copies.push(mapped);
            extras.set(id, copies);
            return `$var ${type} ${width} ${mapped} ${rest} $end`;
        }
        used.add(id);
        return line;
    });
    if (!extras.size) { return file; }
    const output: string[] = [];
    for (const line of rewritten) {
        output.push(line);
        for (const [original, copies] of extras.entries()) {
            for (const mapped of copies) {
                const cloned = cloneValueLine(line, original, mapped);
                if (cloned) { output.push(cloned); }
            }
        }
    }
    fs.writeFileSync(file, output.join('\n'));
    return file;
}

/** Archive only bare relative dump names; explicit user paths remain untouched. */
export function collectWaveOutput(cwd: string, dumpName: string, outputDir: string): string {
    const source = path.resolve(cwd, dumpName);
    if (path.isAbsolute(dumpName) || /[\\/]/.test(dumpName) || !fs.existsSync(source)) {
        uniquifyVcdAliases(source);
        return source;
    }
    const target = path.resolve(outputDir, dumpName);
    resetWaveFiles(target);
    if (source !== target) {
        fs.mkdirSync(outputDir, { recursive: true });
        fs.copyFileSync(source, target);
        fs.unlinkSync(source);
    }
    uniquifyVcdAliases(target);
    return target;
}