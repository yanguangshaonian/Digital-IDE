import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

/** An extra simulation root records the selected top without editing user HDL. */
export function prepareAutoWave(top: string, files: string[], outputDirectory: string): { name: string; file: string } | undefined {
    const visited = new Set<string>();
    const hasDump = (file: string): boolean => {
        file = path.resolve(file);
        if (visited.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { return false; }
        visited.add(file);
        const text = fs.readFileSync(file, 'utf8').replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
            token => token.startsWith('"') ? token : ' ');
        const withoutStrings = text.replace(/"(?:\\.|[^"\\])*"/g, '');
        if (/\$(?:dumpfile|dumpvars|dumpports)\s*\(/.test(withoutStrings)) { return true; }
        for (const match of text.matchAll(/`include\s+"([^"\r\n]+)"/g)) {
            if (hasDump(path.resolve(path.dirname(file), match[1]))) { return true; }
        }
        return false;
    };
    if (files.some(hasDump)) { return undefined; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(top)) {
        throw new Error('Automatic waveform export requires a simple Verilog top module name.');
    }
    fs.mkdirSync(outputDirectory, { recursive: true });
    const name = `dide_wave_${randomBytes(8).toString('hex')}`;
    const file = path.join(outputDirectory, `${top}.dide-wave.sv`);
    // Use an ASCII basename; the existing collector archives it after simulation.
    // Some Windows Icarus builds cannot open UTF-8 absolute paths from HDL strings.
    const wave = `${top}.vcd`;
    fs.writeFileSync(file, `module ${name};\ninitial begin\n  $dumpfile(${JSON.stringify(wave)});\n  $dumpvars(0, ${top});\nend\nendmodule\n`);
    return { name, file };
}