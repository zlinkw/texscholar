'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const preset = require('./writing-presets.json');
const metadata = require('../package.json');
const {bindings, RECOMMENDED} = require('./setup');
const EXCLUDE = '**/{.git,.codex-review,.latex-build,node_modules,clean_dir}/**';

async function buildPrompt() {
    const guide = await fs.readFile(path.join(__dirname, 'writing-guide.md'), 'utf8');
    const questions = await fs.readFile(path.join(__dirname, 'question-linking-guide.md'), 'utf8');
    const settings = [...preset.settings, ...bindings({})];
    const pluginSettings = Object.fromEntries(Object.entries(metadata.contributes.configuration.properties)
        .filter(([key]) => key === 'localLatex.configurationProfile' || key.startsWith('localLatex.review') || key.startsWith('localLatex.translation'))
        .map(([key, value]) => [key, value.default]));
    return [
        '# 请配置 TeXScholar 本地科研写作，并合并到你的全局 SKILL',
        '',
        '这是一项实际配置请求，不是让我反复手动安装技能的教程。请先读取当前电脑、已安装插件、全局 AGENTS 和相关 SKILL，再执行必要且获准的配置。不得仅口头承诺“已经记住”。',
        '适用于论文撰写、修改、回复信与作者审核。先把下方协作规则去重合并到你实际使用的全局科研写作 SKILL，按需拆到其已有引用模块，保持自动识别自然语言任务；不要要求作者记住技能名。不得覆盖现有科学规则、安全规则或其他任务的技能。若当前助手没有全局 SKILL 写入能力，请明确限制，不假称已保存，也不擅自在论文项目新建一套 Markdown 管理文件。',
        '合并后重新读取实际修改位置，报告全局 SKILL 的真实位置与改动；只有实际完成后，作者才应在插件中选择“已配置，不再提示”。复制本提示词不等于已经配置。',
        '',
        '## 新电脑迁移与配置范围（1～40）',
        '以下为可迁移行为，不含任何旧电脑绝对路径、完整 PATH、代理、凭据、账号、论文路径或 Git 远端。不得凭插件公开仓库地址创建或连接论文备份仓库。',
        '1. 使用本地 TinyTeX／TeX Live；原基线为 TeX Live 2026。核实新电脑可用版本和论文模板需求，不保证不同发行版或包版本的 PDF 完全一致。macOS 可复用 TinyTeX 或 MacTeX，不重复安装已有发行版。',
        '2. 安装／核对官方 LaTeX Workshop 与 TeXScholar。使用公开插件接口，不修改第三方扩展、VS Code 程序或内部数据库。',
        '3. 检测 latexmk、pdfLaTeX、BibTeX；由 latexmk 安排必要轮次和文献处理。确有 biblatex/Biber 或其他引擎项目时按真实源码配置，不强改成 BibTeX。',
        '4. 识别实际主文档、子文件和多个独立文档，不硬编码 main.tex；必要时设置真实的 TeX root 声明。',
        '5. Ctrl+S（Mac Cmd+S）保存并编译；Workshop 自身自动编译关闭，避免重复触发。普通 AI 改稿、保存批注不是编译授权或作者接收。',
        '6. 通用配方使用 latexmk -pdf -synctex=1 -interaction=nonstopmode -file-line-error，并传入实际主文件与输出目录。',
        '7. 每个主文件独立输出至 %DIR%/.latex-build/%DOCFILE%。',
        '8. 保留增量缓存，关闭自动清理和自动清理后重试；不能为排错擅自删除缓存。',
        '9. 正式 PDF 使用 Workshop 右侧预览，按页宽、纵向连续、单页显示。',
        '10. PDF 双击反向定位；源码右键或快捷键正向定位；启用 SyncTeX。',
        '11. 首次手动生成完整审核 PDF，使用 VS Code 官方浮动编辑器窗口双屏查看，与源码共享工作区和 Workshop 实例，不另启独立工作区；后续更新同一文件。接收候选后默认后台更新已有审核 PDF，用户可在插件设置关闭；打开卡片、保存候选和添加批注不触发编译。',
        '12. TeX 子进程设置 LC_ALL=C、LC_CTYPE=C、LANG=C；中文源码、JSON、日志和工具通信显式 UTF-8，不用 Windows ANSI/GBK 读写论文。',
        '13. LaTeX 编辑区约 110 列视觉换行，不把视觉折行写成源码换行。',
        '14. LaTeX 专用字号 16、行高 26、关闭缩略图、开启顶部固定章节提示；不覆盖其他语言或 Typst 的显示偏好。',
        '15. 手动 tex-fmt 整理缩进，使用 --stdin --nowrap --noconfig --tabsize 2；仅借用缩进，不改正文或句子行结构，不提交 Git。',
        '16. 关闭保存、输入和粘贴时的自动格式化。',
        '17. 新写或实质重写正文一句一行、段内不插空行；这是 AI 撰写规则，不能让格式化器机械拆句或全文件重排旧文本。',
        '18. 章节树跟随光标，显示章节／图表编号及图注，开启面包屑。章节树移动等原生布局由用户通过官方 UI 操作，不伪称能全部写入设置。',
        '19. 公式、引用和文献悬浮预览；引文补全支持标题、作者、年份、期刊与会议字段。',
        '20. 书签跨文件跳转，不往项目写书签文件；Todo Tree 只定位 TeX 写作规则、段落计划、TODO 等。',
        '21. LaTeX Suite 提供分数、根号、求和、矩阵与括号跳出；关闭自动分数转换和自动括号放大。',
        '22. 使用内置图、子图、三线表、公式、回复信及贡献条目片段；不生成虚假的实验数值。',
        '23. 可选可视化编辑与源码切换，默认源码编辑，不依赖任何在线 Overleaf 服务。',
        '24. 文件树隐藏 .latex-build，搜索、补全与主文件识别排除生成物，辅助文件折叠归组。',
        '25. 保留 ChkTeX 正常正文检查；只通过插件适配器排除规范的机器状态注释块，不关闭项目检查、不修改第三方插件。',
        '26. 悬浮处理保留接受建议、接受全文此类建议、忽略本行警告、忽略全文此类警告；只接受有可靠修复的建议，不盲改模板宏。',
        '27. LTeX+ 使用 en-US、中文母语、保存时检查并合并科研词典；不静默设置远程语言服务器。',
        '28. Error Lens 展示 error/warning，600 ms 延迟、160 字符上限，避免重复显示 LTeX 行内信息。',
        '29. 保存时更新 TeX 字数，保留手动字数统计及未引用文献检查。',
        '30. 可选英文转简体中文悬浮翻译，多行合并、最长 1000 字符；明确外部供应商可能接收文字，不自动上传论文。',
        '31. 使用官方简体中文语言包；语言切换或原生布局需用户重载／操作时明确告知。',
        '32. .tex 项目自动显示行侧审核入口和底部评论；无唯一审核状态时不擅自初始化论文；代码项目和纯 Typst 项目不触发。',
        '33. 候选与正文分离，支持手动编辑候选、精确批注、一键接收／拒绝，接收后自动打开下一待审项；原生卡片选区不能被扩展自动获取，精准候选选区走专用面板。',
        '34. 完整论文审核 PDF 仅重复实际修改句，原文在上、灰线、候选在下，仅变化词标记；真实段落边界有类型和 ¶，公式、图注、表注独立处理。',
        '35. AI 科研要求、段落逻辑和交接状态进入规范源码注释块；机器记录不得进入正文候选或 ChkTeX 正文检查。',
        '36. 返修上下文含编号、文件、原文、候选和精确选区；批注加入 Codex 输入框但不自动发送，保存批注不自动启动 AI。',
        '37. Git 仅作成果备份；整理缩进不操作 Git；作者明确本批审完后只提交新接收成果，保护手动编辑和暂存选择。',
        '38. 论文远端须经项目授权并核实为私有 GitHub，正常推送、不强推、不改远端、不连带上传无关提交；推送成功才按工具引用核验清理完结缓存，失败不清理。未决候选、批注和运行 DATA 不上传。',
        '39. 通过 TeXScholar 配置白名单合并导入，保留明确用户选择。支持完整／仅 LaTeX／关闭自动导入及恢复；重复配方按语义去重，不删用户自定义配方和快捷键，不复制旧配置文件整体覆盖。',
        '40. 使用插件内置 Windows／Mac 快捷键，先核对现有冲突；不要再把同样绑定写入用户 keybindings.json。Mac Cmd／Option 适配不等于已有实机通过证据。',
        '',
        '## 实际迁移顺序与边界',
        '先检测系统、CPU 架构、VS Code、插件版本、已有 TeX、Python 3.12+、tex-fmt、Git、GitHub CLI、latexdiff、SyncTeX、ChkTeX、texcount、checkcites、ripgrep 及所需 Perl／语言服务器依赖。复用已有安装；缺失部分从官方来源按当前机器安装。GUI 启动的 PATH 也须核对。不要让用户为每项重复手配，但系统安装或账号授权仍遵守当前助手权限。',
        '先运行插件的“检查本地写作环境与跨平台工具”，再按需“安装缺少的配套扩展”和“导入／重新应用论文写作配置”。机器可执行文件路径只保存在新电脑设置，不写入全局共享规则或论文源码。不同 TeX 版本、包和字体会影响版式，不能保证与旧机器逐像素一致。',
        '不为安装插件创建论文仓库、接收候选、迁移旧审核块或清理真实论文。新论文的本地／私有远端初始化另按项目授权：先识别源码、图表、模板、参考文献，再建立忽略规则，排除 .codex-review、.latex-build、运行缓存和临时审核预览。已跟踪的生成文件不能仅靠 .gitignore 修复，也不能擅自撤销暂存。',
        '只有需要验证新机器工具链时使用隔离最小样例核验正文、文献及 SyncTeX；不拿真实论文做安装测试。报告真实通过／失败和需要用户登录、重载或手动布局的部分。缺少权限、网络或 Mac 实机时如实说明，不假称已完成。',
        '审核颜色和布局只是插件的显示偏好，不能变成 AI 向正式 .tex 插入颜色宏、删除线或改写候选的指令。最终投稿标记遵循作者和期刊规则，与审核显示样式分开。',
        '卡片中文翻译默认开启，默认来源 Bing，可在 localLatex.translation.autoTranslate 关闭、在 localLatex.translation.provider 换源。仅对当前编辑区可见的待审卡片，后台逐项翻译原文、候选和关联问题，不预翻译整个项目、不自动重试或换源。关闭自动翻译后保留手动入口；译文可随时收起。数学和引用标记尽量还原。译文不写入正文、候选、审核状态或 Git，也不代表科学核验。关联原始问题默认展开，标题行使用纯文本图例且不重复显示编号。',
        '',
        '## 配套扩展（按功能选择，缺失才安装）',
        ...RECOMMENDED.map(([id, purpose]) => '- ' + id + '：' + purpose),
        '',
        '## 通用配置白名单（按语言合并，含可选显示项）',
        '下方工具命令为可移植名称；实际执行时由插件检测本机位置。optional 为配套显示／辅助项，缺少扩展时不写未注册设置。已有用户选择优先，不能盲目覆盖。',
        JSON.stringify(settings, null, 2),
        '',
        '## 插件审核与显示默认值（可由用户修改）',
        JSON.stringify(pluginSettings, null, 2),
        '',
        '## 插件贡献的快捷键（勿重复写入用户配置）',
        JSON.stringify(metadata.contributes.keybindings, null, 2),
        '',
        '## 需合并到全局科研写作 SKILL 的协作规则',
        '将以下规则与现有技能去重，保留作者规则优先级。相对指南链接应改为按需读取当前实际安装的 TeXScholar 资源，不复制成本机绝对路径或旧版本固定目录；工具参数先读取当前 --help，不凭聊天记忆。',
        guide,
        '',
        '## 原始审稿问题关联的精确接口与示例',
        questions
    ].join('\n');
}

function activate(context, vscode) {
    let announced = false;
    const copy = async () => {
        await vscode.env.clipboard.writeText(await buildPrompt());
        vscode.window.showInformationMessage('已复制本地配置与全局 SKILL 协作提示词。交给 AI 实际完成后，再标记“已配置，不再提示”。');
    };
    const show = async explicit => {
        if (!explicit && (announced || context.globalState.get('aiSetupConfigured', false) || !vscode.workspace.isTrusted)) return;
        if (!explicit && !(await vscode.workspace.findFiles('**/*.tex', EXCLUDE, 1)).length) return;
        if (!explicit && (announced || context.globalState.get('aiSetupConfigured', false))) return;
        announced = true;
        // Do not wait for the user to dismiss a notification during activation.
        vscode.window.showInformationMessage('TeXScholar：让 AI 配合审核并配置本地 LaTeX。可复制包含 1～40 项配置与全局 SKILL 合并规则的提示词；不含个人路径、代理或凭据。',
            '一键复制提示词', '已配置，不再提示', '查看完整提示词').then(async choice => {
            if (choice === '一键复制提示词') await copy();
            else if (choice === '已配置，不再提示') await context.globalState.update('aiSetupConfigured', true);
            else if (choice === '查看完整提示词') {
                const document = await vscode.workspace.openTextDocument({language: 'markdown', content: await buildPrompt()});
                await vscode.window.showTextDocument(document, {preview: true});
            }
        }).catch(error => vscode.window.showErrorMessage(error.message));
    };
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.copyAISetupPrompt', () => copy().catch(error => vscode.window.showErrorMessage(error.message))));
    context.subscriptions.push(vscode.commands.registerCommand('localLatex.aiSetupGuide', async () => {
        if (context.globalState.get('aiSetupConfigured', false)) {
            const choice = await vscode.window.showInformationMessage('AI 协作已标记为配置完成。', '复制提示词', '重新启用项目提示');
            if (choice === '复制提示词') return copy();
            if (choice !== '重新启用项目提示') return;
            await context.globalState.update('aiSetupConfigured', false);
        }
        return show(true);
    }));
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.tex');
    context.subscriptions.push(watcher, watcher.onDidCreate(() => show(false).catch(error => vscode.window.showErrorMessage(error.message))),
        vscode.workspace.onDidChangeWorkspaceFolders(() => {announced = false; show(false).catch(error => vscode.window.showErrorMessage(error.message));}));
    return {ready: show(false).catch(error => vscode.window.showErrorMessage(error.message))};
}
module.exports = {activate, buildPrompt};
