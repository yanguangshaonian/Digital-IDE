import * as fs from 'fs';
import * as path from 'path';

/** Find literal includes relative to each source/header, not only the testbench cwd. */
export function collectIncludeDirectories(files: string[], searchDirectories: string[] = []): string[] {
    const directories = new Set(searchDirectories.map(directory => path.resolve(directory)));
    const visited = new Set<string>();
    const visit = (file: string) => {
        file = path.resolve(file);
        if (visited.has(file) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { return; }
        visited.add(file);
        const parent = path.dirname(file);
        directories.add(parent);
        // Preserve strings while removing comments, so commented-out includes are ignored.
        const source = fs.readFileSync(file, 'utf8').replace(/"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
            text => text.startsWith('"') ? text : ' ');
        const include = /`include\s+"([^"\r\n]+)"/g;
        let match: RegExpExecArray | null;
        while ((match = include.exec(source)) !== null) {
            const candidates = [parent, ...directories].map(directory => path.resolve(directory, match![1]));
            const header = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
            if (header) { visit(header); }
        }
    };
    files.forEach(visit);
    return [...directories];
}