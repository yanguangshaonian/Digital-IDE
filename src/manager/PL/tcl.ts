/** Quote one Tcl argument without allowing command or variable substitution. */
export function quoteTcl(value: string): string {
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        .replace(/\$/g, '\\$').replace(/\[/g, '\\[')
        .replace(/\r/g, '\\r').replace(/\n/g, '\\n') + '"';
}

/** ASCII-only loader for UTF-8 Tcl, including Vivado versions using CP936. */
export function encodeTclScript(script: string): string {
    const hex = Buffer.from(script, 'utf8').toString('hex');
    return `eval [encoding convertfrom utf-8 [binary format H* {${hex}}]]\n`;
}

/** Load generated ASCII wrappers without Vivado's source path reparsing.
 * Reader variables stay local; the script executes in the caller's scope.
 */
export function loadTclScript(filePath: string): string {
    return 'eval [apply {{scriptPath} {\n' +
        'set channel [open $scriptPath r]\n' +
        'set status [catch {read $channel} contents options]\n' +
        'set closeStatus [catch {close $channel} closeResult closeOptions]\n' +
        'if {$status} {return -options $options $contents}\n' +
        'if {$closeStatus} {return -options $closeOptions $closeResult}\n' +
        'return $contents\n' +
        `}} ${quoteTcl(filePath)}]`;
}