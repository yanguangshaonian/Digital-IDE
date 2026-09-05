import * as vscode from 'vscode';

import { MainOutput, opeParam } from '../../global';
import { hdlPath, hdlFile} from '../../hdlFs';
import { HdlModule, hdlParam } from '../../hdlParser/core';
import { instanceByLangID, getSelectItem } from './instance';
import { HdlLangID } from '../../global/enum';

function overwrite() {
    const options = {
        preview: false,
        viewColumn: vscode.ViewColumn.Active
    };
    const tbSrcPath = hdlPath.join(opeParam.extensionPath, 'lib', 'testbench.v');
    const uri = vscode.Uri.file(tbSrcPath);
    vscode.window.showTextDocument(uri, options);
}

function generateTestbenchFile(langID: HdlLangID, module: HdlModule) {
    const tbSrcPath = hdlPath.join(opeParam.extensionPath, 'lib', 'testbench.v');
    const tbDisPath = hdlPath.join(opeParam.prjInfo.arch.hardware.sim, 'testbench.v');

    if (!hdlFile.isFile(tbDisPath)) {
        var temp = hdlFile.readFile(tbSrcPath);
    } else {
        var temp = hdlFile.readFile(tbDisPath);
    }

    if (!temp) {
        return null;
    }

    let content = '';
    const lines = temp.split('\n');
    const len = lines.length;
    for (let index = 0; index < len; index++) {
        const line = lines[index];
        content += line + '\n';
        if (line.indexOf("//Instance ") !== -1) {
            content += instanceByLangID(langID, module) + '\n';
        }
    }
    try {
        hdlFile.writeFile(tbDisPath, content);
        MainOutput.report("已生成测试平台：" + tbDisPath);
    } catch (err) {
        vscode.window.showErrorMessage("生成测试平台失败：" + err);
    }
}

async function testbench() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('请选择一个编辑器！');
        return;
    }
    const uri = editor.document.uri;
    const option = {
        placeHolder: '选择要生成测试平台的模块'
    };
    const path = hdlPath.toSlash(uri.fsPath);
    const langID = hdlFile.getLanguageId(path);

    if (!hdlFile.isHDLFile(path)) {
        return;
    }
    // console.log(path);
    
    const currentHdlFile = hdlParam.getHdlFile(path);
    // console.log(currentHdlFile);
    
    if (!currentHdlFile) {
        vscode.window.showErrorMessage('找不到对应的 HDL 文件：' + path);
        return;
    }
    const currentHdlModules = currentHdlFile.getAllHdlModules();
    const items = getSelectItem(currentHdlModules);
    const select = await vscode.window.showQuickPick(items, option);
    if (select) {
        generateTestbenchFile(langID, items[0].module);
    }
}


export {
    testbench
};