# TeXScholar 当前任务协作协议：一次提交排序后的三个方案

这是插件提供的任务级协议，不要求修改、覆盖或安装任何全局 SKILL，也不向论文项目添加 AGENTS.md／Markdown 跟踪文件。现有科研技能、作者要求与安全边界继续生效。Codex 已连接插件内置 MCP 时，初始化指引从新会话起可用；论文任务先调用 read_context 读取当前项目和本协议。每次从插件加入写作上下文或返修批注时也读取本协议；工具升级后读取同目录 source_review.py 的 --help 和 collaboration-contract，不依赖聊天记忆。

## 候选生成

### 先确认文件角色

每次论文任务先读 read_context 返回的 file_roles。插件按实际 TeX 内容、documentclass、input/include/subfile/import 和 !TeX root 提供建议，不要求特定文件名。只有 status=confirmed 才能据此写候选；unconfirmed 或 changed 时请作者在 VS Code 执行“TeXScholar：识别／确认论文文件角色”。不要自行伪造确认、猜测用途或绕过 MCP 检查。首次新项目可在作者授权下先创建必要模板骨架，但不能将草稿直接冒充已接收正文。

确认后项目只保留一个顶部 CODEX-FILE-ROLES-BEGIN/END 注释块，其中 JSON schema=1 的 files 数组逐项记录 file、roles、root，structure 保存用于检测变更的编译关系。file/root 均为项目相对路径，root=null 表示未指定编译入口。manuscript 是论文主文档，chapter 是正文子文件，response 是回复信，review 是原始审稿意见，template 是仅供参考的模板，other 是其他 TeX；一个文件可同时为 response 和 review。不要把结构快照当正文、批注或候选，也不另建 Markdown／JSON 登记副本。该稳定配置不同于唯一审核状态，不初始化审核、不改变编号或审核决定。

增删改名、documentclass、包含关系或 !TeX root 改变才需重新确认；普通正文润色、保存、接收和批注不重做首次确认。动态宏和共享子文件可能无法唯一解析，按作者实际指定入口，不做模糊自动配对。template 不作为论文改写目标；确实需改模板，先请作者在文件角色中调整用途。confirmed 映射也是插件选择审核 PDF 主文档的依据。

- 先读取真实正文、作者顶部 CODEX-RULES、相关局部逻辑注释、唯一审核状态、当前候选与返修要求。不要修改无关区域。
- 同一原文位置只有一个审核编号；一次请求提交 A/B/C 三个有实质区别的方案，按作者要求、科学准确性、逻辑和简洁程度排序。A 是优先推荐，不是已经接收。每个方案附简短 reason，指出取舍，不给伪造置信度。
- 三方案共享事实、数据和约束，不凑同义词版本，不编造实验或引文。确实不足三个合理方案时，提供一或两个并明确 fewer_options_reason。工具只能核对结构和文字是否重复，科学合理性仍需核验。
- A/B/C 是同一轮备选，v1/v2 是重新生成的轮次，不能混用。普通审核按位置组织，最多一个自然段；公式、图注、表注等特殊结构单独审核。新写或实质重写正文一句一行，不机械重排旧段落。
- 新建用 propose-options；返修用 rework-options --id <实际编号> --version <刚读取的版本>。JSON 通过 UTF-8 stdin 传入，不放进 shell 拼接字符串。工具 --apply --expect <状态拥有文件当前 SHA256> 才持久化；预览验证不会保存。使用共享写入锁，不手改 DATA 或对象。
- 保留编号和正式原文。AI 生成的备选在作者明确接收具体方案前不能写入正文。接收、备份与科学问题闭合分开。旧单方案 propose/rework 命令已移除，不能绕过多方案约定；作者手动编辑某个方案仍由 edit-option 完成。

新候选 JSON 示例（文件名和内容必须来自当前项目，不照抄）：

```json
{
  "file": "actual-paper.tex",
  "kind": "manuscript",
  "before": "Exact original sentence.",
  "left": "Exact left anchor. ",
  "right": " Exact right anchor.",
  "location": "实际章节与位置",
  "options": [
    {"label":"A","reason":"优先保持限定条件，措辞最直接","after":"First supported candidate."},
    {"label":"B","reason":"突出机制，篇幅稍长","after":"Second supported candidate."},
    {"label":"C","reason":"突出适用边界","after":"Third supported candidate."}
  ],
  "questions": []
}
```

返修时保留该编号，按已读批注重排新一轮 A/B/C。可显式 discard_annotations=true 清除旧返修批注；不要求作者先逐条拒绝。手动编辑单个方案由 edit-option 保存，保留其他方案，不用于要求 AI 只交一个新方案。元数据补关联使用 link-questions，不改其他审核字段。

## 关联、批注和交付

问题关联必须提供实际 id、项目内 file 和唯一精确 quote。多个问题涉及同一原文位置时合并为同一修改项，在 questions 中分别关联，不自动猜配。完整接口见同目录 question-linking-guide.md。返修上下文包含编号、选项、版本、原文、候选与选区；批注只加入 Codex 输入区，不自动发送或调用 AI。

候选 PDF 由插件处理：一份完整论文，仅修改句上下对照，未改内容一次；A/B/C 只决定显示哪个待审方案，不自动接收。不要向正式源码加审核颜色宏，也不要为普通 AI 改稿自行编译。插件允许用户配置保存当前预览方案／选择方案后的 PDF 更新，以及接收后的自动更新。

科研要求放顶部 CODEX-RULES，段落计划放对应段前。交接记录、运行状态必须进入插件识别的既有 CODEX-REVIEW-STATE-BEGIN/END 注释块，所有行保持 LaTeX 注释，不能混入正文修订或作者候选。具体块格式以 writing-guide.md 为准，不另造状态拥有文件。

只有作者说本批审完或执行结束审核操作，才按已有工具提交新接收成果并推送已授权、核实为私有的 GitHub。保留手动编辑与暂存选择；不上传候选、批注和运行 DATA。推送成功后才按已有工具锁与精确引用核验精简已完结状态、清理获准无引用对象；失败不清理。没有新接收成果不空提交。不自动更改远端、强推、接收其他候选或宣称科学问题解决。

插件不能向任意 AI 聊天静默注入规则，也不能保证 AI 语义上遵守。常规入口是 VSIX 内置 MCP（read_context、propose_options、rework_options、read_feedback、link_questions）及同一审核核心的保存校验；也可从插件附带协议的写作上下文／返修交接继续。MCP 不提供作者接收或自动提交推送接口。上下文丢失后重新读取本协议与真实状态，不修改全局 SKILL。
