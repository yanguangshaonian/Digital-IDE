import * as fs from 'fs';
import * as path from 'path';

/** Archive only bare relative dump names; explicit user paths remain untouched. */
export function collectWaveOutput(cwd: string, dumpName: string, outputDir: string): string {
    const source = path.resolve(cwd, dumpName);
    if (path.isAbsolute(dumpName) || /[\\/]/.test(dumpName) || !fs.existsSync(source)) {
        return source;
    }
    const target = path.resolve(outputDir, dumpName);
    if (source === target) { return source; }
    fs.mkdirSync(outputDir, { recursive: true });
    // Copy first: configured output directories may be on another volume.
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
    const sourceView = source.replace(/\.vcd$/i, '.view');
    const targetView = target.replace(/\.vcd$/i, '.view');
    if (sourceView !== source && fs.existsSync(sourceView) && !fs.existsSync(targetView)) {
        fs.copyFileSync(sourceView, targetView);
        fs.unlinkSync(sourceView);
    }
    return target;
}