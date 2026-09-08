const assert = require('node:assert/strict');
const fs = require('node:fs');
const { contributes } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const menus = contributes.menus;
const submenus = new Set(contributes.submenus.map(item => item.id));
const commands = new Set(contributes.commands.map(item => item.command));
function collect(id, visited = new Set()) {
    assert(!visited.has(id), `Menu cycle: ${id}`);
    const next = new Set([...visited, id]);
    return (menus[id] || []).flatMap(item => {
        if (item.submenu) {
            assert(submenus.has(item.submenu));
            return collect(item.submenu, next);
        }
        assert(commands.has(item.command), `Unknown command: ${item.command}`);
        return [item.command];
    });
}
for (const location of ['editor/context', 'explorer/context']) {
    assert.equal(menus[location].length, 1, 'Only Digital-IDE is exposed at root');
    assert(menus[location][0].group.startsWith('z_'));
    const reachable = collect(location);
    for (const suffix of ['simulate.cli', 'simulate.gui', 'simulate.vcd', 'refresh', 'build', 'build.synth', 'build.impl', 'build.bitstream', 'program', 'gui', 'exit']) {
        assert(reachable.includes(`digital-ide.hard.${suffix}`), `${location}: missing ${suffix}`);
    }
    assert(!reachable.includes('digital-ide.hard.launch'));
    assert(!reachable.includes('digital-ide.hard.simulate'), 'default simulation is an alias of CLI');
    assert(reachable.includes('digital-ide.tool.instance'));
}
const explorer = collect('explorer/context');
for (const command of ['digital-ide.pl.setSrcTop', 'digital-ide.pl.setSimTop', 'digital-ide.property-json.generate', 'digital-ide.waveviewer.show']) {
    assert(explorer.includes(command));
}
assert.equal(menus['editor/context'][0].submenu, menus['explorer/context'][0].submenu);
assert(!submenus.has('digital-ide.context.hardware'));
const shared = menus['digital-ide.context'];
assert(shared.find(item => item.command === 'digital-ide.property-json.generate').when === 'explorerResourceIsFolder');
for (const command of ['digital-ide.pickLibrary', 'digital-ide.tool.icarus.simulateFile', 'digital-ide.hard.refresh']) {
    assert(shared.some(item => item.command === command), `${command} must be directly under Digital-IDE`);
}
assert(new Set(shared.map(item => item.group.split('@')[0])).size >= 4, 'separate functional groups provide separators');
console.log('PASS: bottom Digital-IDE submenus, all hardware actions reachable, file/folder commands preserved, no cycles or unknown commands');