const assert = require('node:assert/strict');
const iconv = require('iconv-lite');
const { createOutputDecoder, terminateProcess, getProcessOutputEncoding } = require('../out/global/processTermination');

(async () => {
    for (const encoding of ['cp936', 'utf8']) {
        const text = '中文路径：用户/工程；错误：拒绝访问\n';
        const bytes = iconv.encode(text, encoding);
        for (let split = 0; split <= bytes.length; split++) {
            const decoder = createOutputDecoder(encoding);
            assert.equal(decoder.write(bytes.subarray(0, split)) + decoder.write(bytes.subarray(split)) + (decoder.end() || ''), text);
        }
    }
    const absent = Object.assign(new Error('absent'), { code: 'ESRCH' });
    let executions = 0;
    const rt = { platform: 'win32', selfPid: 999, env: { SystemRoot: 'C:\\Windows', DIDE_PROCESS_OUTPUT_ENCODING: 'cp936' },
        kill: () => { throw absent; }, execFile: () => { executions++; } };
    assert.equal(await terminateProcess(123, rt), false);
    assert.equal(executions, 0);
    rt.kill = () => true;
    rt.execFile = (file, args, options, callback) => callback(Object.assign(new Error('corrupted'), { code: 5 }), Buffer.alloc(0), iconv.encode('拒绝访问', 'cp936'));
    await assert.rejects(terminateProcess(123, rt), /拒绝访问/);
    await assert.rejects(terminateProcess(999, rt), /protected/);
    console.log('Output encoding:', await getProcessOutputEncoding());
    console.log('PASS: split characters, absent process, permission error, protected PID');
})().catch(error => { console.error(error); process.exitCode = 1; });