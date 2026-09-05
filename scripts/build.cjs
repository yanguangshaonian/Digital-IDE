// Shared Windows/Linux build. Never installs, uninstalls or publishes an extension.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
process.chdir(root);
const args = new Set(process.argv.slice(2));
if (args.has('--help')) {
    console.log('build.bat | sh build.sh [--skip-install]\nDefault: npm ci, compile, bundle, validate resources, package and verify VSIX.');
    process.exit(0);
}
for (const arg of args) {
    if (arg !== '--skip-install') { throw new Error(`Unknown argument: ${arg}`); }
}
if (Number(process.versions.node.split('.')[0]) < 22) { throw new Error('Node.js >= 22 is required'); }

function run(command, argv, cwd = root) {
    const result = spawnSync(command, argv, { cwd, stdio: 'inherit', env: process.env });
    if (result.error) { throw result.error; }
    if (result.status !== 0) { throw new Error(`${command} failed (${result.status})`); }
}
function cli(relative, argv, cwd = root) {
    run(process.execPath, [path.join(root, 'node_modules', relative), ...argv], cwd);
}

async function build() {
    if (!args.has('--skip-install')) {
        // Use npm's JS entry to avoid Windows shell quoting and execution policies.
        const npm = process.env.npm_execpath || path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
        if (fs.existsSync(npm)) { run(process.execPath, [npm, 'ci', '--no-fund']); }
        else { run('npm', ['ci', '--no-fund']); }
    }
    const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    const required = [
        'resources/dide-viewer/view/index.html',
        'resources/dide-viewer/view/vcd.wasm',
        'resources/dide-netlist/view/index.html',
        'resources/dide-netlist/static/yosys.wasm'
    ];
    // Produce a universal package only when every supported LSP binary exists.
    for (const platform of ['aarch64-darwin', 'aarch64-linux', 'aarch64-win.exe',
        'loongarch64-linux', 'x86_64-darwin', 'x86_64-linux', 'x86_64-win.exe']) {
        required.push(`resources/dide-lsp/server/digital-lsp-${platform}`);
    }
    for (const file of required) {
        if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
            throw new Error(`Missing runtime resource: ${file}. Prepare matching-version release resources before building.`);
        }
    }
    const stage = path.join(root, 'dist', 'stage');
    const compiled = path.join(root, 'dist', 'compiled');
    for (const dir of [stage, compiled]) {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
    }
    cli('typescript/bin/tsc', ['-p', '.', '--outDir', compiled]);
    cli('eslint/bin/eslint.js', ['src', '--ext', 'ts']);
    // Separate output from the development watch task's out directory.
    const webpack = require('webpack');
    const config = require('../webpack.config')({}, { mode: 'production' });
    config.mode = 'production';
    // Large embedded renderers make parallel minification memory intensive.
    // Keep the bundle readable and buildable on ordinary development machines.
    config.optimization = { minimize: false };
    config.entry = path.join(compiled, 'extension.js');
    config.resolve = { ...config.resolve, alias: {
        '../../../resources/json5': path.join(root, 'resources/json5'),
        '../../../resources/wavedrom': path.join(root, 'resources/wavedrom'),
        '../../resources/formatter': path.join(root, 'resources/formatter'),
        '../../resources/translator': path.join(root, 'resources/translator')
    } };
    config.output = { ...config.output, path: path.join(stage, 'out') };
    await new Promise((resolve, reject) => {
        const compiler = webpack(config);
        compiler.run((error, stats) => {
            compiler.close(() => {
                if (error) { reject(error); return; }
                console.log(stats.toString({ colors: false, chunks: false, modules: false }));
                if (stats.hasErrors()) { reject(new Error('Webpack failed')); }
                else { resolve(); }
            });
        });
    });
    for (const name of ['config', 'css', 'fonts', 'images', 'l10n', 'project', 'resources', 'snippets', 'syntaxes',
        'README.md', 'CHANGELOG.md', 'LICENSE', ...fs.readdirSync(root).filter(n => /^package\.nls.*\.json$/.test(n))]) {
        fs.cpSync(path.join(root, name), path.join(stage, name), {
            recursive: true,
            filter: source => !/(?:^|[\\/])(?:\.git|node_modules)(?:[\\/]|$)/.test(source) &&
                !/\.(?:zip|tar\.gz|log|str)$/i.test(source)
        });
    }
    // These are machine-specific generated commands, not shipped runtime assets.
    for (const name of ['launch', 'refresh', 'build', 'bit', 'simulate']) {
        fs.rmSync(path.join(stage, 'resources/script/xilinx', `${name}.tcl`), { force: true });
    }
    const packagedManifest = { ...manifest };
    delete packagedManifest.scripts;
    delete packagedManifest.devDependencies;
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(packagedManifest, null, 4) + '\n');
    const output = path.join(root, 'dist', `${manifest.name}-${manifest.version}.vsix`);
    const temporary = path.join(root, 'dist', `${manifest.name}-${manifest.version}.building.vsix`);
    try {
        // Stage is an explicit runtime allowlist; do not use the old .vscodeignore,
        // which excludes language servers and webview JavaScript/WASM.
        cli('@vscode/vsce/vsce', ['package', '--no-dependencies', '--out', temporary], stage);
        const Zip = require('adm-zip');
        const zip = new Zip(temporary);
        for (const file of ['package.json', 'out/extension.js', ...required]) {
            const entry = zip.getEntry(`extension/${file}`);
            if (!entry || entry.header.size === 0) { throw new Error(`VSIX missing ${file}`); }
        }
        fs.rmSync(output, { force: true });
        fs.renameSync(temporary, output);
        console.log(`\nBUILD OK: ${output}`);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}

build().catch(error => { console.error(`BUILD FAILED: ${error.message}`); process.exitCode = 1; });