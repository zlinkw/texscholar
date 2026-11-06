# TeXScholar 当前任务协作协议：一次提交排序后的三个方案

这是插件提供的任务级协议，不要求修改、覆盖或安装任何全局 SKILL，也不向论文项目添加 AGENTS.md／Markdown 跟踪文件。现有科研技能、作者要求与安全边界继续生效。Codex 已连接插件内置 MCP 时，初始化指引从新会话起可用；论文任务先调用 read_context 读取当前项目和本协议。每次从插件加入写作上下文或返修批注时也读取本协议；工具升级后读取同目录 source_review.py 的 --help 和 collaboration-contract，不依赖聊天记忆。

## 候选生成

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
