# 双模式快审与 SKILL 反馈执行记录

2026-11-22：现任执行者 `local/01a20284-4ad8-70b1-87ff-61225eaec6aa`，实核 gpt-6.1-terra/high/default，match/continue；旧执行者 `local/01a1fd60-2da5-74e0-8e68-e266cf679881` 达到接续条件并明确释放租约，无在途操作。基线 e33e8c88d5928527e66e23cf6f4d952e348ddb67 与 origin/master 一致、clean。产品、测试、UI 和隔离配置租约已交本角色，计划及最终验收由总控负责。E1–E6 尚在执行；同一问题返修计数为 0。真实论文及现有状态、草稿和范围外暂存只读保护；E7 通过前不发行。原检查没有整轮 UI 全绿，case4/5 失效选择与内部写忙反例和其他失败保留原报告。

进行中（未冻结）：已实现目录全量选择的失效标记与定位、自动正文同步时的页面写忙提示；成功批量接收仅清已提交的精确选择。已开始共用批注的单次持锁状态写入和返修 SKILL 协议，仍需覆盖完整调用链、双模式与真实界面，不称阶段完成。反馈入口盘点：工作台和旧编辑器保存调用 inline_review 的 saveNote；本项、全部和所选交接汇入 addRequests；MCP 分别以 read_context 和 read_feedback 提供当前返修；共同批注新入口须沿同一反馈状态模型。协议放在 collaboration-guide 的单一章节，附件和两种 MCP 读取按实际存在批注引用，不启动 AI。

首次 `e1-first` 因新夹具根未创建，30 项 ENOENT，exit1，原日志误落旧证据根 `D:/latex-writing-checks/choice-settings-20261122/e1-first.*`；后已创建本代根，`e1-fourth` 原工作台/inline 68 项 exit0。新增 SKILL 指南后 `e1-s-first` 4 项 exit1：Windows CRLF 导致章节定位失败；规范化换行后 `e1-s-second` 68 项 exit0，MCP 定向 `s-mcp-first` 2 项 exit0。`batch-first` exit1，测试错误地比较内嵌状态文件全部字节；明确比较正文并保留索引、失败前状态字节后 `batch-second` exit0。各完整 argv/cwd/env/stdout/stderr/退出在本代证据根同名前缀文件。以上均为局部验证，不代表全组或正常 Development UI 通过。

按最新明确授权纳入 S 分层与 U/P：SKILL 仅公共方法，用户跨论文个性化增量和论文专属背景分开；真实用户数据、全局规则未改。正在实现插件稳定数据目录内 SQLite 权威数据及 CAS，MCP 和本地任务/返修附件共同读取；两类真实入口及同名不同根隔离、过期写保护仍须完整验证。`up-mcp-first` 3 项 exit0；此前 `p-js-first` 1 项因缺 `LOCAL_LATEX_GIT` 测试环境而 exit1，补真实 Git 路径后 `p-js-second` 75 项 exit0。一次 PowerShell 临时单行插入界面按钮因引号产生 Python SyntaxError，未写入，后以 UTF8 外置脚本成功；原工具输出保留。当前草稿及新增模式仍在开发，未提交或签通过，必须验证实际 UI 和所有受影响调用链。

隔离正常 Development 局部 UI：`ui-local-first` exit1，观察脚本数字属性选择器语法错误；`ui-local-second` exit1，夹具文件监听重复触发造成并发写锁冲突。保留原日志与样例，新样例修正选择器及一次性触发后 `ui-local-third` exit0：完整问题身份区分同名不同摘录，正文/回复同屏；筛选隐藏的旧版选择保留、标需重核且整批接收禁用。真实 host/observer 均 exit0，私有桌面未切换，前台 HWND 前中后一致；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-7442b0cbd15d48019c8f837b07c19ce4.png` 已查看。仅覆盖上述局部，不代表完整 UI 验收。完整证据在本代根 `ui-local-{first,second,third}.*` 及各样例目录。

随后补齐托盘所选项的文件、问题来源、方案与有效状态，问题范围写按钮遵守不可写状态，当前候选草稿用于片段显示；原文草稿尚未保存时明确提示片段不可用。`ui-local-fourth` exit0、真实截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-e795cb3b8bde4c0888c403a6ef71f9b1.png` 已查看，验证旧版标识仍生效；随后补充托盘完整问题身份，需覆盖该最终改动。`editor-second` 167 项 exit0，之后上述问题身份显示改动需定向核验。真实 MCP 子进程 `mcp-transport-first` exit1，夹具对未初始化状态显式传 state 导致上下文读取错误；新样例修正为正常 read_context 后 `mcp-transport-second` exit0，验证个人资料跨两个同名论文目录共享、论文背景隔离、旧 revision 拒绝及实际上下文读取。未证明 GUI 与反馈附件完整链。

`ui-local-fifth` exit0，在隔离正常 Development 宿主确认未保存候选草稿出现在问题片段、托盘显示完整问题身份且旧版阻断；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-2e970da2c7a4469ca6047d6064f6b403.png` 已查看。`ui-context-first` exit0，真实用户 Quick Pick 和输入框各保存一条个人习惯和论文背景，再经实际 Python 入口读回；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-85fd37ad8eea47cd925626c14ef146b8.png` 已查看。两次私有桌面前台保持不变。取消、失败草稿、附件/反馈及跨进程偏好等余项仍待核实。

`ui-batch-first` exit1：观察器成功保存共同要求，但宿主检查未选条目时把不存在的 requests 当数组；截图暴露托盘长问题文字横向溢出。修正夹具并让托盘文字换行后，新隔离 `ui-batch-second` exit0，真实状态核对仅所选 1/3 各有独立整项批注，未选 4 仍待审；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-b08b17b6fabb4a3f8d2a4b90db3ac86a.png` 已查看。`ui-target-second` 受影响 JS 测试 exit0，之后的托盘样式改动由上述界面检查覆盖。仍需其余阶段及最终 editor 组。

`ui-context-second` exit0：实际个人入口输入后由隔离进程先保存新 revision，旧写被拒绝且未保存输入留在未命名编辑器；论文背景输入后取消，未写入背景。观察器第一次 Escape 早于下一选择器出现，使用同一私有桌面 CDP 待选择器出现后补发一次 Escape；未重放写入。真实宿主和观察器 exit0，前台不变；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-04981fccde04458ca0a9ca18f6ebc367.png` 已查看。

用户追加批准 R，六种用途已接入原批注与共用批注、作者草稿、附件及 MCP 读取，并更新分层协议；尚未完成全部兼容与跨进程验证。`r-js-first` exit1 为原精确断言未包含新字段，更新预期后 `r-js-second` 75 项 exit0；`r-python-first` exit1 为未设置 SOURCE_REVIEW_FIXTURES，隔离环境补全后 `r-python-second` 4 项 exit0，包含六用途持久化、默认和非法值。`ui-purpose-first` exit0，正常 Development 中共用意见六选项可达，所选两项持久化 personal 用途；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-4a185bbf89f8412a9d2baa13e49d1afc.png` 已查看。R 的单项、旧格式读取、所选附件、迟到回调和草稿恢复仍须定向验证；未冻结或发布。

`ui-purpose-single-first` exit0，隔离宿主保存 discussion 批注，并用捕获接口核实际交接文件包含用途、原文及讨论协议；不称联网发送。截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-e8654a026dba4db38409b53e04380bd6.png` 已查看。`r-js-fourth` 76 项、`r-python-fourth` 4 项 exit0，覆盖旧格式默认和迟到用途更改保护。`editor-r-final` exit0，但运行中补了用途并发写保护，不能作为最终候选完整证据；`backend-r-first` exit1，148 项中一项夹具 Git 对象路径过长，亦跨上述源码修改；保留原结果，改用本代证据根内较短夹具路径并对最终输入重跑。共同意见草稿现记录用途、范围与所选身份，仍须最终回归和交包。

最终输入的 `editor-r-second` 168 项 exit0、`backend-r-second` 148 项 exit0，后者使用本代根内短夹具路径；完整日志和真实环境见同名前缀及其 stdout 所列组日志。`ui-purpose-second` 在当前输入 exit0，复核共同意见 personal 用途实际保存，截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-1ea1998cc779468aad323ee7119eed48.png` 已查看。局部历史、公式片段及其余交接边界尚需核验，未作 E6 交包。

T 只读调查已单独交总控待用户审核：`t-payload-first`、`t-workbench-first` exit0，分别使用注入式合成供应商及合成工作台宿主捕获真实函数的请求边界；行间公式本体未进入供应商请求，候选正文内前缀可进入，独立方案标签未进入。脚本在 `translation-readonly`，进程记录位于证据根同名前缀；无实网或真实资料操作。标题及旧入口仅静态核链，真实案例归因未知，T 修复未授权。随后 A2 片段使用现有数学分段器保留完整公式，新增 Unicode、公式和插入的局部测试，`node --test src/review_workbench.test.js` 33 项 exit0；这次代码修改使此前 editor 组不再覆盖最终输入，仍须重跑、界面核验并完成其余未尽事项。

`editor-r-third` 当前输入 169 项 exit0。`prepare-ui-local-6` exit1，夹具错误将自然段和独立公式放入同一审核单元；`prepare-ui-local-7` exit1，夹具使用审核单元尚不支持的 alignat*；`ui-local-eighth` exit1，观察器通过公式片段检查并截图后，夹具错误地在公式外追加正文导致版本更新被拒绝。保留全部证据，新样例 `ui-local-ninth` exit0：真实 Development 宿主中 align* 公式变更片段保留完整环境，失效选择仍阻断整批；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-773886ab4f69418b8b850f0230171338.png` 已查看，前台不变。该检查不代表历史、全部交接和 E6 完成。

`ui-history-first` exit0：隔离真实宿主对本项新旧版本默认预选最近历史，读取后切换当前 B 方案，实际显示旧 A → 新 B 的公式差异；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-9a4bd6dbbdca4b108faa9027fcef0ba9.png` 已查看，私有桌面前台不变。返修说明定位及其余交接边界仍需核验。

`ui-fulfillment-first` exit1，夹具误以为仍开放的旧版批注位于 previousNotes，实际位于 notes；保留首败，新样例 `ui-fulfillment-second` exit0：真实保存的作者要求与返修映射显示说明，点击后准确高亮 A 方案对应文字，有未保存草稿时拒绝猜测定位。截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-b63045b603b24595bc31af7eaf62ce78.png` 已查看，前台不变；尚需其余交接和分层边界检查。

`ui-selected-first` exit0：隔离真实宿主选择 1/3、保存共同 personal 意见后，经实际所选交接捕获附件；两项用途与原文完整、未包含未选 4，并带三层协议。捕获接口只证明加入输入区内容，不称联网发送；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-cb8a9ee295fc48e4bf30b9674d1dd533.png` 已查看、前台不变。

`ui-selected-second` exit0：新隔离资料经实际 Python 入口各写一条 U/P 后，下一次所选附件同时包含最新个人要求、本论文背景、精确子集与用途。截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-2ca151c10aec4577abdf3a18330f208c.png` 已查看、前台不变；未触及真实资料，不宣称 AI 语义判定通过。

发现 U/P 编辑在输入或下一选择步骤取消时会丢稿，改为保留输入至未命名编辑器，失败同样保留；成功后不留多余草稿。`ui-context-third` exit0：真实隔离宿主覆盖个人要求冲突、论文背景后续步骤取消、U/P 输入中取消，均读回保留草稿且未覆盖资料；`ui-context-fourth` exit0 验证两个入口实际保存和读回。截图分别为 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-822d4ad11a144e11afe51107ac8efd70.png`、`C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-f6a11005e427498f9f111107a996494b.png`，均已查看且前台不变。修改后的 `editor-r-fourth` 169 项 exit0；Python 未变，backend-r-second 仍适用。

`ui-selected-third` exit0，实际任务请求及后续所选返修附件均捕获最新隔离 U/P；任务附件已生成后，测试夹具没有注册扩展完整激活时的 `localLatex.checkAIConfiguration`，界面出现命令不存在提示，故这里只证明生成附件内容，不称任务命令完整成功；所选返修附件完成且真实内容已核。截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-456f199f4dea48d7993a0a327cd2a3ff.png` 已查看。无联网发送。

用户批准 T 后已实施：行内和行间数学保护、纯行间无需翻译、受支持文本列表内部正文、结构化候选前缀及标题文件名保护；翻译失败及占位还原告警可见。`t-translation-first` 9 项、`t-workbench-second`、`t-approved-payload-first`、`translation-t-final` 均 exit0，合成供应商捕获在本代根同名前缀；真实供应商质量未测。`ui-translation-first` exit1 为观察器无条件切换中文导致已展开状态反被收起；新样例 `ui-translation-second` exit0，纯公式提示与含行内英文混合文本实际渲染，截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-54f96356e23e417ea3007fb8a475d5e7.png` 和 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-c6ce01532fb13e3c08f41a248d095123.png` 已查看。`ui-translation-third` exit0，正常隔离宿主自动标题路径实测自然语言送受控供应商、R2-Q1 占位保护且 main.tex 不发送；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-765c177c34c54d0ca91824174dfe9004.png` 已查看。真实桌面前台不变，无网络；该轮最后仅增强标题告警/文件名识别，需受影响 editor 回归。

`skill-boundary-first` exit0：隔离 SKILL 副本中，实际批注与 MCP 反馈包含 skill 意图及确认协议；模拟作者对具体方案确认前副本及论文不变，夹具明确批准事件后写副本并重新读取，论文仍未变。这验证数据与隔离文件流程，不证明 AI 语义执行或授权修改真实 SKILL。

最终输入 `editor-t-final2` 171 项 exit0，`translation-t-final` 9 项 exit0；`backend-r-second` 148 项覆盖未变的审核事务及 MCP Python。`ui-translation-fourth` exit0，在自动模式验证纯公式无需翻译及标题/文件名保护；截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-b858f598ed8d4b4c8a7266cf25f45acb.png` 已查看、前台不变。测试使用独立正常 Development 宿主和受控本地翻译供应商，不声称实网结果。

`translation-t-final2` 9 项 exit0，补充“明确方案标签加纯公式”的无需翻译边界。`ui-busy-first` exit0：新隔离正常宿主实际进入保存后同步事务并由夹具受控暂停，真实写按钮禁用、切模式仍可用；释放后成功保存一条独立批注且落盘。截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-c7c714cdf7d44d1483e04919c1f5dae6.png` 已查看，私有桌面前台不变。此局部成功不替代总控跨文件 E7 大验收。
