import * as vscode from 'vscode';
import * as assert from 'assert'; 

import { prjManage } from './prj';
import { pickLibrary } from './libPick';
import { HardwareOutput, ReportType } from '../global/outputChannel';

// 不输出入口参数或环境变量；保留异常堆栈以便定位分发失败。
function registerHardwareCommand(command: string, callback: (...args: any[]) => any) {
    vscode.commands.registerCommand(command, (...args: any[]) => {
        HardwareOutput.report(`【VS Code 硬件命令入口】收到命令：${command}`);
        const reportFailure = (error: unknown) => HardwareOutput.report(`【硬件命令失败】命令=${command}；错误=${error instanceof Error ? error.stack || error.message : String(error)}；错误继续向上传播。`, {
            level: ReportType.Error
        });
        try {
            const result = callback(...args);
            if (result instanceof Promise) {
                return result.catch((error: unknown) => {
                    reportFailure(error);
                    throw error;
                });
            }
            return result;
        } catch (error) {
            reportFailure(error);
            throw error;
        }
    });
}

export function registerManagerCommands(context: vscode.ExtensionContext) {
    // make ps and ps have been prepared
    HardwareOutput.report(`【硬件命令注册】硬件管理器=${prjManage.pl ? '已就绪' : '未就绪'}；软件管理器=${prjManage.ps ? '已就绪' : '未就绪'}`);
    if (!prjManage.pl || !prjManage.ps) {
        HardwareOutput.report('【硬件命令注册失败】管理器尚未初始化，无法继续注册命令。', { level: ReportType.Error });
    }
    assert(prjManage.pl, '硬件管理器未初始化');
    assert(prjManage.ps, '软件管理器未初始化');

    const plManage = prjManage.pl;
    const psManage = prjManage.ps;

    // libpick 
    vscode.commands.registerCommand('digital-ide.pickLibrary', pickLibrary);

    // ps toolbox commands (soft tool in treeView)
    // TODO : finish digital-ide.soft.download
    vscode.commands.registerCommand('digital-ide.soft.launch', () => psManage.launch());
    vscode.commands.registerCommand('digital-ide.soft.build', () => psManage.build());
    vscode.commands.registerCommand('digital-ide.soft.download', () => psManage.program());

    // pl functional commands
    registerHardwareCommand('digital-ide.pl.setSrcTop', (item) => plManage.setSrcTop(item));
    registerHardwareCommand('digital-ide.pl.setSimTop', (item) => plManage.setSimTop(item));
    registerHardwareCommand('digital-ide.pl.addDevice', () => plManage.addDevice());
    registerHardwareCommand('digital-ide.pl.delDevice', () => plManage.delDevice());
    registerHardwareCommand('digital-ide.pl.addFile', files => plManage.addFiles(files));
    registerHardwareCommand('digital-ide.pl.delFile', files => plManage.delFiles(files));

    // pl toolbox commands (hard tool in treeView)
    registerHardwareCommand('digital-ide.hard.launch', () => plManage.launch());
    registerHardwareCommand('digital-ide.hard.simulate', () => plManage.simulate());
    registerHardwareCommand('digital-ide.hard.simulate.cli', () => plManage.simulateCli());
    registerHardwareCommand('digital-ide.hard.simulate.gui', () => plManage.simulateGui());
    registerHardwareCommand('digital-ide.hard.refresh', () => plManage.refresh());
    registerHardwareCommand('digital-ide.hard.build', () => plManage.build());
    registerHardwareCommand('digital-ide.hard.build.synth', () => plManage.synth());
    registerHardwareCommand('digital-ide.hard.build.impl', () => plManage.impl());
    registerHardwareCommand('digital-ide.hard.build.bitstream', () => plManage.bitstream());
    registerHardwareCommand('digital-ide.hard.program', () => plManage.program());
    registerHardwareCommand('digital-ide.hard.gui', () => plManage.gui());
    registerHardwareCommand('digital-ide.hard.exit', () => plManage.exit());
    HardwareOutput.report('【硬件命令注册】已完成硬件功能及工具箱命令注册。');
}

export {
    prjManage
};