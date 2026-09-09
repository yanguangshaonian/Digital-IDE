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

/** Archive only bare relative dump names; explicit user paths remain untouched. */
export function collectWaveOutput(cwd: string, dumpName: string, outputDir: string): string {
    const source = path.resolve(cwd, dumpName);
    if (path.isAbsolute(dumpName) || /[\\/]/.test(dumpName) || !fs.existsSync(source)) {
        return source;
    }
    const target = path.resolve(outputDir, dumpName);
    if (source === target) { return source; }
    fs.mkdirSync(outputDir, { recursive: true });
    resetWaveFiles(target);
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
    const sourceView = source.replace(/\.vcd$/i, '.view');
    if (sourceView !== source && fs.existsSync(sourceView)) {
        fs.copyFileSync(sourceView, path.resolve(outputDir, path.basename(sourceView)));
        fs.unlinkSync(sourceView);
    }
    return target;
}