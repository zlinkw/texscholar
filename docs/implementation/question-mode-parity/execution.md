# 问题审核能力对照执行记录

现任 local/01a208d4-2ab9-7a93-9994-56e2c5dfc6c7，Terra 6.1/high 实核 match/continue，tier default；M 返修 0。起点 02f0c688b4f069aa447cbfd1e8d20ebd04b286a0 与 origin/master 相同、clean。真实论文、P、默认管道、MCP及用户窗口受保护；不构建或发行。

| 对照入口母集 | 状态与证据 |
| --- | --- |
| 问题身份、导航、未绑定、同名跨文件、目录筛选、前后与返回 | 正常：questionTable 按 id/file/quote 定位，questionEntries 含未绑定；目录与前后项保留。Q 总控 controller1 曾核同 ID 不同 file/quote 不串，M-open-ui-green 核精确项及返回入口。 |
| 原文 ABC、全文片段、TeX、插入删除、差异导航及方案对照 | 已修：卡片原文和方案可按真实片段精确选区；Q 的安全片段边界和数学测试复用。合理模式差异：差异前后定位及两方案对照通过“打开本项（段落审核）”使用原控件，M-open-ui-green 核可达。 |
| 推荐、summary/reason、fact_changes、范围、迁移意图、问题核对 | 已修：问题卡直接呈现推荐、取舍、事实依据与范围，草稿期间不误用旧信息；迁移意图仍是候选，核对不等于解决。M-evidence-impact、M-evidence2-ui。fulfillment 在打开本项后查看。 |
| 原文、候选、问题、中文精确划词；片段偏移；整项和方案批注；保存、编辑、取消、定位、历史、暂留、fulfillment；所选与全部交接和重试 | 已修：原文/方案/问题及中文跨卡精确绑定，暂存和保存并切换保留目标，变版本拒绝恢复；M-ui-green2、M-stash-final、M-switch-green，中文复用 Q/controller1。合理模式差异：历史、暂留、编辑/定位与 fulfillment 在打开本项后使用既有入口；共同返修、批注管理及交接/重试保留原入口与既有测试。 |
| 候选和原文编辑、预览、保存、接收；三稿和用途跨模式、问题、项、隐藏重开 | 已修：卡片编辑/预览经精确握手打开本项；跨问题/模式未保存批注可见且不换绑，M-open-ui-green、M-draft-ui-green3。Q controller1 实测候选草稿跨模式保留且不外发；原文稿、暂存和用途沿既有保护，M-stash-final、workbench 46 项。 |
| 单项预览、接收、拒绝、暂缓、恢复；当前问题和全部批选、隐含选择、共享项去重、过期及草稿禁用 | 已修：暂缓/冲突不能批接，暂缓不能单项接收，未保存稿禁批接，保留取消旧选择及打开后恢复；M-batch-green2、M-batch-ui2、M-deferred-unit、M-deferred-ui。批选按项 ID 存储、当前问题与全部分开；拒绝及恢复经明确打开本项，版本变更需重核。 |
| 0.9.62 自动/手动翻译、单卡、片段、全文、收起、缓存、错误、迟到和批注身份 | 正常：复用 Q 90/10、返修 45 和 controller1 跨模式/跨卡缓存、迟到与草稿；M-translate-ui 对本代最终共享渲染补测自动可见卡、隐藏卡不预翻译和手动收起后切全文仍关闭。未测实网质量。 |
| 全局 PDF、源定位、状态、错误、忙态、阅读位置、焦点键盘、窄窗口、配置及资料入口 | 合理模式差异：顶部 PDF/源定位指当前审核项，相关 title 明示；设置、资料、错误及忙态沿原全局入口，未访问真实 PDF 或稿件。普通尺寸截图已看；刷新后精确滚动位置、键盘完整路径及窄窗口未做本代独立实测，不能称已通过。 |

M1/M2 首批：正常 Development 私有桌面 M-ui-red1 实际 observer/外层 exit 1，问题卡原文和候选缺少精确选区入口；宿主 0，Default 输入桌面及前中后前台 HWND 25630512 不变、私有桌面关闭，截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-2d48a23585bf4754876e47c88ad1a538.png 已看。改为问题卡原文、方案及问题文本使用共享 math 选区模型；后端按 session/问题/项/版本/侧/方案/视图和实际片段重新核对，片段范围映射原始 Unicode 坐标，未保存草稿不允许绑定；问题选区保留完整问题上下文。M-workbench-second 45 项 exit 0；M-ui-green2 宿主/观察器/外层均 0，隔离样本当前项 3 上为卡 1 方案 A 片段及问题原文实际划词保存，状态分别读回方案 A 精确 [16,20) 的 Midd 和原问题选区 Please；Default 及 HWND 未变，私有桌面关闭，截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-f9bf63dc47ec463ab791668bd4280ff0.png 已查看保留。M-ui-green1 为前一实现的候选选区 exit 0，不替代 green2。日志 D:/latex-writing-checks/review-efficiency-20261122/M-*，完整命令和相关环境按 runner 保留。其余母集仍继续检查，尚未完成。

第二批：M-open-ui-red2 独立 Development 宿主实测点击问题卡“打开本项”后当前项已切换但仍停问题模式，段落深度审核和暂缓恢复未显现，observer/外层 exit 1；截图 ui-83a12396f11149948ba502067b4feed1.png 已看。原 M-open-setup-red 因临时脚本字符串边界写错 SyntaxError exit 1，未启动宿主；修正后 red2 才复现行为。现在按钮明确标为“打开本项（段落审核）”，沿既有精确 cardAction 握手核 session/问题/项/版本并受原切换草稿保护，成功进入该项段落审核，提示可切回问题模式；未绑定分支亦核确实未关联。M-open-unit 45 项 exit 0，M-open-ui-green 宿主/观察器/外层 exit 0，截图 ui-5062521929504b83bf18903810ff67d4.png 已看；私有桌面、专属 pipe，Default 输入桌面和前中后 HWND 保持，桌面关闭。截图在 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures，日志在既有 M-open-*。母集其余检查继续。

第三批：新增跨卡原文选区后，原暂存核对只拿当前项全文比较，导致目标卡无变化时片段批注草稿也被标为不能恢复。现暂存核对按原 session、精确问题、目标项/版本、侧/方案和实际片段重算，成功恢复后仍由原保存边界再次核对；目标版本变化则保留草稿并拒绝直接恢复。M-stash-final 执行 node --test src/review_workbench.test.js，46 项 exit 0，覆盖跨卡暂存、恢复、准确保存和目标版本变更拒绝；不改 UI 或后端文件，沿用相应已验覆盖。

第四批：检查保存并切换时发现原跨卡译文及新原文选区共用的 savePendingInputs 把目标包装当选区写给当前项，可能拒绝或错误绑定；已向总控提前报真实数据完整性风险，未触真实论文。M-switch-red 初次夹具缺 services.saved 报错，不作为产品缺陷；补齐后 M-switch-red2 exit 1，准确观察目标卡 2 被送到项 1。修复为使用已核 selected.target 与 selected.selection，原当前项处理不变；M-switch-green 46 项 exit 0，包括跨卡暂存恢复后“保存并切换”正确写卡 2 的精确选区，完整日志保留。

第五批：问题卡原先不展示段落模式已有的推荐、摘要/详细取舍、事实变化依据及范围；虽然可进入单项查看，直接做卡片决定时缺少关键信息。问题卡复用段落模式同一范围和事实格式，逐卡传该项证据，保留“科学结论未验证”与 unsupported 状态；该项有草稿时不展示旧事实或范围，迁移意图仍为候选意图。M-evidence-impact 对 workbench/math/inline 相关链 exit 0；M-evidence-ui 正常隔离宿主显示推荐、取舍、范围 exit 0；M-evidence2-ui 在同宿主对合成卡数据注入摘要、详细依据和数字变化/证据，实际 DOM 显示并注明未验证 exit 0，不称真实论文证据。截图 ui-f6ed63142a0b4d959cc48e4cc60c4868.png、ui-0e97cd8bee504621a85037c8b2996d42.png 已看；专属 profile/pipe、私有桌面及 Default/前台保护按对应 run-result 记录。

第六批：M-draft-ui-red 隔离宿主真实选中卡 1 片段并输入未保存批注，切换到另一问题后输入框仍有值但被移到隐藏段落区，observer/外层 exit 1；截图 ui-eed8dcaaea5044128b2210c370f6d756.png 已看。现保留唯一 composer 并在问题区设置可见停靠位，切换问题或模式仍显示原范围和草稿；问题变化时明确要求返回原问题或重新选择，未自动换绑；问题模式无选区时标明当前项。M-draft-ui-green 首次夹具在 CDP 全局重复声明 q，SyntaxError exit 1，不是产品缺陷；green3 exit 0，验证跨段落/问题与不同问题切换均可见、文字及原目标保留，回原问题后准确保存；截图 ui-33b9fd03eb1a45658b5ca57e9a022e67.png 已看。M-draft-final workbench 46 项 exit 0；私有桌面、专属管道和 Default/前台保护按 run-result 记录。

第七批：已选条目随后暂缓或定位冲突时旧批选只检查版本/方案，仍可能进入批量接收；M-batch-red 对真实选择判定 exit 1，已向总控提前披露风险。修复为选择判定与宿主接收前均拒绝暂缓/冲突，保留已选供明确取消，取消后禁重选；恢复或修复后可重新选择。M-batch-green 初次因既有最小夹具无可选 workspaceState 导致失败，按真实可选契约处理后 M-batch-green2 workbench 46 项 exit 0。M-batch-ui 首次观察器 JS 引号错误崩溃，宿主等待 done；经写入该隔离夹具明确失败结果使宿主正常退出，未杀进程，exit 1 保留。M-batch-ui2 正常私有桌面真实操作先选卡 1、打开、暂缓、返回问题模式：批接禁用、原勾选可清除、清除后禁重选，宿主/观察器/外层 exit 0；截图 ui-39a6529c00bd4b2b94e9af9c0087cda3.png 已看，Default/前台不变、桌面关闭。

第八批：补齐同一暂缓语义的单卡接收与未保存稿反馈：暂缓卡的接收按钮不可用并提示先打开恢复，宿主再次拒绝伪造或过期点击；有候选、原文或返修草稿时问题批接按钮禁用并注明先保存或暂存。M-deferred-unit 46 项 exit 0，M-deferred-ui 正常私有宿主 exit 0，实操未保存批注时批接禁用、暂缓卡单项及批接禁用且旧勾选可取消；截图 ui-866a3f1c58fc48ea824dbc14e2705827.png 已查看，Default/前台及隔离记录见 run-result。

最终影响链：M-translate-ui 使用合成供应商及最终源码，宿主、观察器和外层均 exit 0；问题与可见卡自动显示中文、隐藏卡不预翻译，手动收起后切换全文仍关闭。截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-d2d94f523cec4cafab1bcbfde40cfde8.png 已看；独立 profile/专属 pipe 和私有未切桌面，Default 输入桌面及前中后前台 HWND 25630512 一致，桌面关闭。未访问实网翻译、真实论文、默认管道、MCP或用户窗口；不构建、安装或发行。普通尺寸 UI 不替代母集中明确列出的未测项。

窄窗口尝试 M-access-ui 宿主 exit 0、观察器/外层 exit 1：调整外层 viewport 至 560 后，VS Code 审核 iframe 实际仍为 787，未达到测试前提；该结果是测试宿主尺寸限制，不能当作产品通过或缺陷。该次按钮可聚焦，未完成键盘路径；Default 输入桌面和前中后前台仍为 25630512，私有桌面关闭。原始日志保留，不存在截图或删除操作。

M-access2-ui 尝试在隔离宿主调整缩放后 iframe 仍为 787，观察器/外层 exit 1；仍未达到窄窗口测试前提，不当作产品缺陷或通过。
