import * as fs from 'fs';
import * as path from 'path';

export interface PackedStructField {
    name: string;
    width: number;
}

export interface PackedStructType {
    name: string;
    width: number;
    fields: PackedStructField[];
}

const IDENT = '[A-Za-z_][A-Za-z0-9_$]*';
const packedScalarWidth: Record<string, number> = {
    bit: 1, logic: 1, reg: 1, wire: 1, integer: 32, int: 32, shortint: 16, longint: 64, byte: 8, time: 64
};

function isVcdIdentifier(id: string): boolean {
    if (!id) { return false; }
    for (let i = 0; i < id.length; i++) {
        const code = id.charCodeAt(i);
        if (code < 33 || code > 126) { return false; }
    }
    return true;
}

function stripHdlCommentsAndStrings(text: string): string {
    return text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, token => token.startsWith('"') ? token : ' ');
}

function packedRangeWidth(range: string | undefined): number {
    if (!range) { return 1; }
    const match = range.match(/\[\s*(\d+)\s*:\s*(\d+)\s*\]/);
    if (!match) { return 1; }
    return Math.abs(Number(match[1]) - Number(match[2])) + 1;
}

function packedTypeWidth(type: string, range: string | undefined, structs: Map<string, PackedStructType>): number | undefined {
    if (structs.has(type)) { return structs.get(type)!.width * packedRangeWidth(range); }
    if (!(type in packedScalarWidth)) { return undefined; }
    return packedScalarWidth[type] * packedRangeWidth(range);
}

export function collectHdlSources(roots: string[]): string[] {
    const files: string[] = [];
    const visit = new Set<string>();
    const walk = (entry: string) => {
        entry = path.resolve(entry);
        if (visit.has(entry) || !fs.existsSync(entry)) { return; }
        visit.add(entry);
        const stat = fs.statSync(entry);
        if (stat.isDirectory()) {
            for (const child of fs.readdirSync(entry)) { walk(path.join(entry, child)); }
            return;
        }
        if (/\.(?:svh?|vh?|inc)$/i.test(entry)) { files.push(entry); }
    };
    for (const root of roots) { walk(root); }
    return files;
}

export function collectPackedStructs(files: string[]): PackedStructType[] {
    const structs = new Map<string, PackedStructType>();
    const pending: Array<{ name: string; body: string }> = [];
    const visit = new Set<string>();
    const scan = (file: string) => {
        file = path.resolve(file);
        if (visit.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { return; }
        visit.add(file);
        const raw = fs.readFileSync(file, 'utf8');
        const text = stripHdlCommentsAndStrings(raw);
        for (const match of raw.matchAll(/`include\s+"([^"\r\n]+)"/g)) {
            scan(path.resolve(path.dirname(file), match[1]));
        }
        const packed = /typedef\s+struct\s+packed\s*\{([^}]*)\}\s*([A-Za-z_][A-Za-z0-9_$]*)\s*;/g;
        let found: RegExpExecArray | null;
        while ((found = packed.exec(text))) {
            pending.push({ name: found[2], body: found[1] });
        }
    };
    for (const file of files) { scan(file); }
    let progress = true;
    while (progress) {
        progress = false;
        for (let i = pending.length - 1; i >= 0; i--) {
            const item = pending[i];
            const fields: PackedStructField[] = [];
            const member = new RegExp('(?:' + IDENT + '\\s+)+(' + IDENT + ')(?:\\s*(\\[[^\\]]+\\]))?\\s*;', 'g');
            let match: RegExpExecArray | null;
            let ok = true;
            while ((match = member.exec(item.body))) {
                const tokens = match[0].replace(/;|\[[^\]]+\]/g, ' ').trim().split(/\s+/);
                const fieldName = tokens.pop();
                const type = tokens.pop();
                if (!fieldName || !type) { ok = false; break; }
                const width = packedTypeWidth(type, match[2], structs);
                if (!width) { ok = false; break; }
                fields.push({ name: fieldName, width });
            }
            if (!ok || !fields.length) { continue; }
            structs.set(item.name, {
                name: item.name,
                width: fields.reduce((sum, field) => sum + field.width, 0),
                fields
            });
            pending.splice(i, 1);
            progress = true;
        }
    }
    return [...structs.values()];
}

export function parsePackedInstances(files: string[], structs: PackedStructType[]): Map<string, PackedStructType> {
    const byName = new Map(structs.map(item => [item.name, item]));
    const instances = new Map<string, PackedStructType>();
    if (!structs.length) { return instances; }
    const visit = new Set<string>();
    const typeNames = [...byName.keys()].map(name => name.replace(/\$/g, '\\$')).join('|');
    const pattern = new RegExp('\\b(' + typeNames + ')\\s+(' + IDENT + ')\\b', 'g');
    const scan = (file: string) => {
        file = path.resolve(file);
        if (visit.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { return; }
        visit.add(file);
        const raw = fs.readFileSync(file, 'utf8');
        const text = stripHdlCommentsAndStrings(raw);
        for (const match of raw.matchAll(/`include\s+"([^"\r\n]+)"/g)) {
            scan(path.resolve(path.dirname(file), match[1]));
        }
        let found: RegExpExecArray | null;
        pattern.lastIndex = 0;
        while ((found = pattern.exec(text))) {
            const packed = byName.get(found[1]);
            if (packed) { instances.set(found[2], packed); }
        }
    };
    for (const file of files) { scan(file); }
    return instances;
}

function sliceVector(bits: string, msb: number, lsb: number): string {
    const start = bits.length - 1 - msb;
    const end = bits.length - lsb;
    if (start < 0 || end > bits.length || start >= end) { return 'x'; }
    return bits.slice(start, end);
}

function compactXsimLogic(bits: string, logicalWidth: number): string {
    if (bits.length === logicalWidth) { return bits; }
    if (logicalWidth === 1) { return bits.slice(-1); }
    const group = Math.floor(bits.length / logicalWidth);
    if (group <= 1) { return bits.slice(-logicalWidth); }
    let compact = '';
    for (let i = 0; i < logicalWidth; i++) {
        compact += bits.slice((i + 1) * group - 1, (i + 1) * group);
    }
    return compact;
}

function fieldValueLine(value: string, id: string, width: number): string {
    if (width <= 1) { return value + id; }
    return 'b' + value + ' ' + id;
}

function padVector(value: string, width: number): string {
    if (value.length >= width) { return value.slice(-width); }
    const lead = value[0];
    const fill = lead === 'x' || lead === 'X' || lead === 'z' || lead === 'Z' ? lead : '0';
    return fill.repeat(width - value.length) + value;
}

export function expandPackedStructVcd(file: string, files: string[]): string {
    if (!files.length || !fs.existsSync(file)) { return file; }
    const structs = collectPackedStructs(files);
    const instances = parsePackedInstances(files, structs);
    if (!instances.size) { return file; }
    const used = new Set<string>();
    const widths = new Map<string, number>();
    const names = new Set<string>();
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === '$var' && parts.length >= 5) {
            used.add(parts[3]);
            widths.set(parts[3], Number(parts[2]));
            names.add(parts.slice(4, -1).join(' ').replace(/\s*\[[^\]]+\]\s*$/, '').trim());
        }
    }
    let next = 0;
    const allocate = (): string => {
        next += 1;
        const candidate = 'S' + String(next);
        if (used.has(candidate) || !isVcdIdentifier(candidate)) { return allocate(); }
        used.add(candidate);
        return candidate;
    };
    type FieldMap = { name: string; width: number; displayWidth: number; id: string; msb: number; lsb: number };
    const expansions = new Map<string, FieldMap[]>();
    const rewritten = lines.map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] !== '$var' || parts.length < 5 || parts[parts.length - 1] !== '$end') { return line; }
        const type = parts[1];
        const width = Number(parts[2]);
        const id = parts[3];
        const rest = parts.slice(4, -1).join(' ');
        const signal = rest.replace(/\s*\[[^\]]+\]\s*$/, '').trim();
        const packed = instances.get(signal);
        if (!packed || packed.width <= 0 || signal.includes('.')) { return line; }
        if (packed.fields.some(field => names.has(signal + '.' + field.name))) { return line; }
        if (width !== packed.width && width !== packed.width * 32) { return line; }
        const scale = width / packed.width;
        let msb = width - 1;
        const fields = packed.fields.map(field => {
            const stored = field.width * scale;
            const mapped: FieldMap = {
                name: signal + '.' + field.name,
                width: stored,
                displayWidth: field.width,
                id: allocate(),
                msb,
                lsb: msb - stored + 1
            };
            msb -= stored;
            return mapped;
        });
        expansions.set(id, fields);
        const extras = fields.map(field => '$var ' + type + ' ' + field.displayWidth + ' ' + field.id + ' ' + field.name + ' $end');
        return [line, ...extras].join('\n');
    });
    if (!expansions.size) { return file; }
    const output: string[] = [];
    for (const line of rewritten.join('\n').split(/\r?\n/)) {
        output.push(line);
        if (!line || line[0] === '$' || line[0] === '#') { continue; }
        if (line[0] !== 'b' && line[0] !== 'B') { continue; }
        const splitAt = line.lastIndexOf(' ');
        if (splitAt < 0) { continue; }
        const value = line.slice(1, splitAt);
        const id = line.slice(splitAt + 1);
        const fields = expansions.get(id);
        if (!fields) { continue; }
        const padded = padVector(value, widths.get(id) || value.length);
        for (const field of fields) {
            const bits = compactXsimLogic(sliceVector(padded, field.msb, field.lsb), field.displayWidth);
            output.push(fieldValueLine(bits, field.id, field.displayWidth));
        }
    }
    fs.writeFileSync(file, output.join('\n'));
    return file;
}
