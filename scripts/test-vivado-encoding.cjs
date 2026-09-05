// Windows regression: generated fixtures only; never opens a user's XPR.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { encodeTclScript, quoteTcl, loadTclScript } = require('../out/manager/PL/tcl');

const vivado = process.argv[2];
if (!vivado) { throw new Error('Provide the official Vivado .bat path'); }
const portable = p => p.replace(/\\/g, '/');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dide-tcl-'));
let hdlDir;
try {
    // HDL paths must obey Vivado's restrictions; script paths need not.
    hdlDir = fs.mkdtempSync(path.join(process.env.DIDE_TEST_HDL_ROOT || path.join(__dirname, '../out'), 'dide-hdl-'));
    const nested = path.join(dir, '中文 空格 [test] $value');
    fs.mkdirSync(nested);
    const fixtures = [
        ['design.sv', 'module design; endmodule\n', 'sources_1'],
        ['tb_design.sv', 'module tb_design; design dut(); endmodule\n', 'sim_1'],
        ['design.xdc', '# Empty constraint fixture\n', 'constrs_1']
    ];
    const payload = fixtures.map(([name, contents, fileset]) => {
        const file = path.join(hdlDir, name);
        fs.writeFileSync(file, contents);
        return `add_files -fileset ${fileset} [list ${quoteTcl(portable(file))}]`;
    });
    payload.push('set_property top design [get_filesets sources_1]',
        'set_property top tb_design [get_filesets sim_1]');
    const refresh = path.join(nested, 'refresh.tcl');
    fs.writeFileSync(refresh, encodeTclScript(payload.join('\n')));
    const commands = [
        'create_project -in_memory regression',
        'set channel sentinel',
        loadTclScript(portable(refresh)),
        'if {$channel ne "sentinel"} {error "Loader leaked variables"}',
        'if {[llength [get_files -quiet]] != 3} {error "File import failed"}',
        'if {[get_property top [get_filesets sources_1]] ne "design"} {error "Wrong design top"}',
        'if {[get_property top [get_filesets sim_1]] ne "tb_design"} {error "Wrong simulation top"}',
        `if {![catch {${loadTclScript(portable(path.join(nested, 'missing.tcl')))}}]} {error "Missing file error swallowed"}`,
        'close_project'
    ];
    const wrapped = encodeTclScript('if {[catch {\n' + commands.join('\n') +
        '\n} message options]} {puts stderr [dict get $options -errorinfo]; exit 1}\n' +
        'puts "DIDE_ENCODING_TEST_PASS"\nexit 0\n');
    assert.match(wrapped, /^[\x00-\x7f]*$/);
    const launch = path.join(dir, 'launch.tcl');
    fs.writeFileSync(launch, wrapped);
    // The official wrapper initializes DLL paths on Windows.
    const args = ['-mode', 'batch', '-source', portable(launch), '-notrace', '-nolog', '-nojournal'];
    const command = `"${vivado}" ${args.map(arg => `"${arg}"`).join(' ')}`;
    const result = spawnSync(command, { shell: true, encoding: 'utf8', cwd: dir, timeout: 120000 });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) { throw result.error; }
    assert.equal(result.status, 0);
    assert.equal((result.stdout.match(/DIDE_ENCODING_TEST_PASS/g) || []).length, 1);
} finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (hdlDir) { fs.rmSync(hdlDir, { recursive: true, force: true }); }
}