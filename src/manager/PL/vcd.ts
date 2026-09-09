import { quoteTcl } from './tcl';

export function makeVivadoVcdName(top: string): string {
    return (top || 'simulation').replace(/[^a-zA-Z0-9_-]/g, '_') || 'simulation';
}

/** Finite capture; restart before logging so initialization is recorded. */
export function makeVivadoVcdScript(path: string, durationNs: number, token: string): string {
    if (!Number.isSafeInteger(durationNs) || durationNs <= 0 || !/^[a-zA-Z0-9_]+$/.test(token)) {
        throw new Error('Invalid VCD capture arguments');
    }
    return `set dide_vcd_open 0
if {[catch {
    if {[current_sim] == ""} {
        set_property xsim.simulate.runtime 0ns [get_filesets sim_1]
        launch_simulation -mode behavioral
    }
    restart
    open_vcd ${quoteTcl(path)}
    set dide_vcd_open 1
    log_vcd [get_objects -r /*]
    run ${durationNs} ns
    close_vcd
    set dide_vcd_open 0
} dide_vcd_error]} {
    if {$dide_vcd_open} {catch {close_vcd}}
    puts "DIDE_VCD_ERROR_${token}"
    puts stderr $dide_vcd_error
} else {
    puts "DIDE_VCD_DONE_${token}"
}
`;
}