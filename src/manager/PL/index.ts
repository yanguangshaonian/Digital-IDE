/**
 * PL: program logic
 * Hardware Programming
 */
import * as vscode from 'vscode';
import * as fs from 'fs';

import { PLContext, XilinxOperation } from './xilinx';
import { BaseManage } from '../common';
import { opeParam } from '../../global';
import { ToolChainType } from '../../global/enum';
import { hdlFile, hdlPath } from '../../hdlFs';
import { moduleTreeProvider, ModuleDataItem } from '../../function/treeView/tree';
import { HdlFileProjectType } from '../../hdlParser/common';
import { PropertySchema } from '../../global/propertySchema';
import { HardwareOutput, MainOutput, ReportType } from '../../global/outputChannel';
import { AbsPath } from '../../global';
import { t } from '../../i18n';
import { EfinityOperation } from './efinity';

class PlManage extends BaseManage {
    context: PLContext;

    constructor() {
        super();

        this.context = { 
            tool: opeParam.prjInfo.toolChain, 
            path: '',
            ope: new XilinxOperation(),
            terminal: undefined,
            process: undefined
        };

        const curToolChain = this.context.tool;
        if (curToolChain === ToolChainType.Xilinx) {
            this.context.path = this.context.ope.updateVivadoPath();
        } else if (curToolChain === ToolChainType.Efinity) {
            this.context.ope = new EfinityOperation();
            this.context.path = this.context.ope.updateEfinixPath();
        }
        this.reportSession('初始化');
        if (curToolChain !== ToolChainType.Xilinx && curToolChain !== ToolChainType.Efinity) {
            HardwareOutput.report('[工具链选择] 当前工具链没有专用硬件分支, 保留原有 Xilinx 操作实现; 请检查项目工具链配置.', {
                level: ReportType.Warn
            });
        }
    }

    private reportSession(action: string) {
        const { tool, path, process, terminal, ope } = this.context;
        const toolName = Object.values(ToolChainType).find(value => value === tool) ?? '未设置或未知';
        const implementation = ope instanceof EfinityOperation ? 'Efinity' :
            ope instanceof XilinxOperation ? 'Xilinx' : '其他';
        // 仅报告状态，不输出路径、命令参数、环境变量或错误原文。
        HardwareOutput.report(`[硬件会话] 操作=${action}; 工具链=${toolName}; 操作实现=${implementation}; 工具路径=${path ? '已设置' : '未设置'}; 进程句柄=${process ? '存在' : '不存在'}; 退出码=${process?.exitCode ?? '未记录'}; 已发送终止信号=${process?.killed ? '是' : '否'}; 终端引用=${terminal ? '存在' : '不存在'}(引用存在不代表会话就绪)`);
    }

    private dispatch(action: string, ...args: unknown[]) {
        this.reportSession(action);
        const reportFailure = (error: unknown) => HardwareOutput.report(`[硬件分发失败] 操作=${action}; 错误=${error instanceof Error ? error.stack || error.message : String(error)}; 错误继续向上传播.`, {
            level: ReportType.Error
        });
        try {
            const result = this.context.ope[action](...args, this.context);
            if (result instanceof Promise) {
                // 保持调用方原有的等待/不等待行为，拒绝仍继续传播。
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
    }

    private reportMissingSession(action: string) {
        this.reportSession(action);
        HardwareOutput.report(`【硬件分发跳过】操作=${action}；当前没有进程句柄，按原有逻辑不执行。请先启动硬件工具并检查启动日志。`, {
            level: ReportType.Warn
        });
    }

    public launch() {
        this.dispatch('launch');
    }

    public simulate() {
        if (this.context.process === undefined) {
            this.reportMissingSession('simulate');
            return;
        }
        this.dispatch('simulate');
    }

    public simulateCli() {
        this.dispatch('simulateCli');
    }

    public simulateGui() {
        this.dispatch('simulateGui');
    }

    public refresh() {
        if (this.context.process === undefined) {
            this.reportMissingSession('refresh');
            return;
        }
        this.dispatch('refresh');
    }

    public build() {
        this.dispatch('build');
    }

    public synth() {
        this.dispatch('synth');
    }

    public impl() {
        if (this.context.process === undefined) {
            this.reportMissingSession('impl');
            return null;
        }
        this.dispatch('impl');
    }

    public bitstream() {
        this.dispatch('generateBit');
    }

    public program() {
        this.dispatch('program');
    }

    public gui() {
        this.dispatch('gui');
    }

    public async exit() {
        if (this.context.process === undefined) {
            this.reportMissingSession('exit');
            return;
        }
        HardwareOutput.show();        
        this.dispatch('exit');
    }

    public setSrcTop(item: ModuleDataItem) {        
        this.dispatch('setSrcTop', item.name);
        const type = moduleTreeProvider.getItemType(item);
        
        if (type === HdlFileProjectType.Src) {
            moduleTreeProvider.setFirstTop(HdlFileProjectType.Src, item.name, item.path);
            moduleTreeProvider.refreshSrc();
        }
    }

    public setSimTop(item: ModuleDataItem) {
        this.dispatch('setSimTop', item.name);
        const type = moduleTreeProvider.getItemType(item);
        if (type === HdlFileProjectType.Sim) {
            moduleTreeProvider.setFirstTop(HdlFileProjectType.Sim, item.name, item.path);
            moduleTreeProvider.refreshSim();
        }
    }
    
    /**
     * @description 因发生文件布局变动而进行更新
     * @param addFiles 
     * @param delFiles 
     */
    public async updateByMonitor(addFiles: AbsPath[], delFiles: AbsPath[]) {
        // 目前只支持 Xilinx
        const addfileActionTag = '（添加文件）';
        const delfileActionTag = '（删除文件）';
        if (addFiles.length > 0) {
            const reportMsg = ['', ...addFiles].join('\n\t');
            MainOutput.report(addfileActionTag + t('info.pl.xilinx.update-addfiles') + reportMsg, {
                level: ReportType.Run
            });
            await this.addFiles(addFiles);
        } else {
            MainOutput.report(addfileActionTag + t('info.pl.xilinx.no-need-add-files'));
        }

        if (delFiles.length > 0) {
            const reportMsg = ['', ...delFiles].join('\n\t');
            MainOutput.report(delfileActionTag + t('info.pl.xilinx.update-delfiles') + reportMsg, {
                level: ReportType.Run
            });
            await this.delFiles(delFiles);
        } else {
            MainOutput.report(delfileActionTag + t('info.pl.xilinx.no-need-del-files'));
        }
    }

    async addFiles(files: string[]) {
        this.dispatch('addFiles', files);
    }

    async delFiles(files: string[]) {
        this.dispatch('delFiles', files);
    }

    /**
     * @description 添加自定义 device 字符串
     * @returns 
     */
    async addDevice() {
        const propertySchema = opeParam.propertySchemaPath;
        let propertyParam = hdlFile.readJSON(propertySchema) as PropertySchema;
        const device = await vscode.window.showInputBox({
            password: false,
            ignoreFocusOut: true,
            placeHolder: t('info.addDevice.placeholder')
        });

        if (!device) {
            return;    
        }

        // 同步到缓存中
        const dideHome = opeParam.dideHome;
        const cachePPy = hdlPath.join(dideHome, 'property-schema.json');

        if (!propertyParam.properties.device.enum.includes(device)) {
            propertyParam.properties.device.enum.push(device);
            hdlFile.writeJSON(propertySchema, propertyParam);
            hdlFile.writeJSON(cachePPy, propertyParam);
            vscode.window.showInformationMessage(t('info.addDevice.add-success', device));
        } else {
            vscode.window.showWarningMessage(t('warning.addDevice.name-taken', device));
        }
    }

    /**
     * @description 删除用户创建的 device
     * @returns 
     */
    async delDevice() {
        const propertySchema = opeParam.propertySchemaPath;
        const propertyParam = hdlFile.readJSON(propertySchema) as PropertySchema;
        const cachePPy = hdlPath.join(opeParam.dideHome, 'property-schema.json');

        const device = await vscode.window.showQuickPick(
            propertyParam.properties.device.enum.filter(device => device !== 'none'),
            {
                placeHolder: t('info.delDevice.placeholder'),
                ignoreFocusOut: true
            }
        );
        if (!device) {
            return;
        }

        const index = propertyParam.properties.device.enum.indexOf(device);
        propertyParam.properties.device.enum.splice(index, 1);
        hdlFile.writeJSON(propertySchema, propertyParam);
        hdlFile.writeJSON(cachePPy, propertyParam);
        vscode.window.showInformationMessage(t('info.delDevice.del-success', device));
    }
}

export {
    PlManage,
};
