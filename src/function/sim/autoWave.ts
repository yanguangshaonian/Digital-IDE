import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';

/** An extra simulation root records the selected top without editing user HDL. */
export function prepareAutoWave(top: string, files: string[], outputDirectory: string, durationNs?: number): { name: string; file: string } | undefined {
    if (durationNs !== undefined && (!Number.isSafeInteger(durationNs) || durationNs <= 0)) {
        throw new Error('Invalid simulation duration in ns');
    }
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
    const explicitDump = files.some(hasDump);
    if (explicitDump && durationNs === undefined) { return undefined; }
    if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(top)) {
        throw new Error('Automatic waveform export requires a simple Verilog top module name.');
    }
    fs.mkdirSync(outputDirectory, { recursive: true });
    const name = `dide_wave_${randomBytes(8).toString('hex')}`;
    const file = path.join(outputDirectory, `${top}.dide-wave.sv`);
    // Use an ASCII basename; the existing collector archives it after simulation.
    // Some Windows Icarus builds cannot open UTF-8 absolute paths from HDL strings.
    const wave = `${top}.vcd`;
    const recording = explicitDump ? '' : `initial begin\n  $dumpfile(${JSON.stringify(wave)});\n  $dumpvars(0, ${top});\nend\n`;
    const timer = durationNs === undefined ? '' : `initial begin\n  #(${durationNs});\n  $display("DIDE_ICARUS_DURATION_REACHED ${durationNs} ns");\n  $finish;\nend\n`;
    fs.writeFileSync(file, `${durationNs === undefined ? '' : '\u0060timescale 1ns/1ps\n'}module ${name};\n${recording}${timer}endmodule\n`);
    return { name, file };
}