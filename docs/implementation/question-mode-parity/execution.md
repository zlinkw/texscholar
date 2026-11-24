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

M-R1：总控 M-controller2 以真实 295px 审核 iframe 及截图 ui-bc8d895e3f804ac58ada62e88c1f5bee.png 复现问题卡三列过窄、批注文字逐字换行及保存按钮裁切；原外层无溢出断言不足以判断可用。修复仅将已有 600px 媒体查询内的问题方案布局改为单列，宽窗维持三列，不改变段落模式或批注协议。

M-r2-ui 正常 Development 独立 profile、专属 pipe、私有未切桌面：实际 iframe 295px，ABC 同列纵向排列，composer/文本框/用途/保存/取消边界及内容宽度可容纳；截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-60c3f581503944c99623370269414890.png 实看，英文和按钮可读。实际键盘从输入框 Tab 到保存并 Enter 后，M-r2-verify 读隔离项目真实状态 exit 0，卡 1、精确版本 270a51ea1ed096c2607921a56381e90cea722445992ad72b20cf29074faced7a、方案 A、candidate [0,9) 的 Paragraph 及用途 revision 均匹配；当前项仍为 3。同一宿主安全调整自有窗口后 iframe 1035px、ABC 恢复并列，截图 ui-2f9a91efcb11127eaeb90dae3c0d96a5.png 已看。宿主/观察器/外层 exit 0，Default 输入及前中后前台 HWND 25630512 一致，桌面关闭；M-r2-workbench 46 项 exit 0。复用总控 controller2 的键盘方向/Tab 及 host refresh 后草稿、精确范围、滚动保护结果，和此前未受影响链。

失败保留：M-r1-setup 内置准备已成功，随后误重复执行 M-r1-prepare exit 1，已存在隔离状态导致 begin 冲突，没有删除或覆盖；M-r1-ui 的合成键盘 Enter 缺少字符事件，等待保存超时 exit 1，host 无 feedback 写入；修正键盘事件后使用全新 r2。M-controller1 不支持的 Electron API、两次旧 access 尺寸前提失败均仍保留。所有 M-r1/M-r2 完整日志及隔离数据在 D:/latex-writing-checks/review-efficiency-20261122；不触真实论文、默认管道或用户窗口，不构建、安装、发行、重载或删除。

M4 交付：总控审核通过 M-R1 后按既有发布安装授权准备 0.9.63。起点 24e21bc630af51921506860a665866b1f56c9c39 与 origin/master 一致、clean；本地及远端 v0.9.63 tag 和输出目录未发现，Release API 明确 HTTP 404；闭包检查 M-delivery-closure exit 0。复用 M92/46、M-R1 46 与实际隔离 UI/总控组合覆盖，不重跑未受影响功能组。CLI 安装登记不代表活动宿主已加载；不重载用户窗口或 MCP、不访问真实论文、不删除。

M-delivery-mcp 和 M-delivery-publisher-test 隔离检查 exit 0；版本核对首个 M-delivery-version 因外置脚本缺项目 PYTHONPATH 报 ModuleNotFoundError exit 1，补显式路径后 M-delivery-version2 exit 0，package 和 MCP 都为 0.9.63，首败保留。完整记录在 D:/latex-writing-checks/review-efficiency-20261122/M-delivery-*。

0.9.63 唯一构建 M-delivery-build exit 0，构建输入 77cf48704e85f1e750443498ce596e1bc9b7f25b；dist/v0.9.63/texscholar-0.9.63.vsix SHA256 7153c48e18a40fc71ed2fc843f37e08138b69758d239cbdef580c104d3a83645，texscholar-0.9.63-source.zip 为 1da3fab8244c1ed14cc4346f6f6e08df37b6dfd7fe8222ae972b9153c41014f5，SHA256SUMS.txt 为 c7f4b0e28b649c66a30b6b5f7ea7cceccbe74800870b3a65ca5af6ed349c4d0c。附注 tag v0.9.63 对象 792c122b3d668d9da4b9bfb105239da72f04be92，目标为构建输入，附注列 SOURCE-COMMIT 和双包摘要；普通推送 exit 0，远端对象和目标一致。手动以未引用的 PowerShell `v0.9.63^{}` 查询时命令解析失败；随后以 git cat-file 与远端 ls-remote 分别核对成功，未变更 tag。

M-delivery-publish exit 0，正式 Release https://github.com/zlinkw/texscholar/releases/tag/v0.9.63 非 draft、非 prerelease，API 三附件摘要与本地一致，M-delivery-verify exit 0。真实命令 `code.cmd --install-extension D:/GitRepo/texscholar/dist/v0.9.63/texscholar-0.9.63.vsix` exit 0；CLI 及实际 manifest 显示 local-research.latex-writing-tools 0.9.63，登记 source=vsix、pinned=true。同包身份由摘要核对；未重载活动宿主，安装登记不表示当前窗口已生效。桌面 MCP 曾有 0.9.60 版本拒绝的旧观察，本轮未探测其当前状态或重启；实网翻译质量未测。未触真实论文、默认 pipe、用户窗口，无删除或 cleanup。

S 首批：真实 CPU 采样指出 questionRows 中同一审核源位置被反复全文扫描，具体证据见计划。合成 246 条记录、68 活跃项、147020 Unicode 字符、两个问题的 S-location-baseline 两次独立表计算分别 617.75/578.83ms。现按当前审核源快照复用每项及旧锚点对应的位置结果，源刷新或保存更新时清空；不同问题旧锚点仍独立比较。S-location-reuse 同规模第一次 327.01ms、同快照第二次 2.67ms；这只是位置表测量，不是批接端到端 5 秒验证。S-location-tests 位置与问题身份定向测试 exit 0，覆盖 Unicode、不同旧锚点和新源重算。原事务/真实论文仍未触。

用户新增要求：问题及段落模式不展示候选下 AI 取舍、详细理由、事实变化核对与修改范围等解释文字；保留原文对照、方案身份、作者批注和操作状态，不改变底层元数据或审核语义。此项随 S 实现和验证。

界面精简：两个模式均不再渲染上述解释，保留原文、候选、方案标识、批注和必要状态；README 相应更新。S-simplify-workbench 46 项及 syntax exit 0；S-simplify-ui 在正常隔离 Development 注入合成取舍/事实数据，核两模式不显示解释且操作入口存在，host/observer/外层 exit 0；截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-5ec3ccdf86754911bb2a088bcef80011.png 已查看。所有证据与隔离保护保存在 S-simplify-* 和 s-simplify 目录。

批量合并方向：实际 acceptBatch 已一次调用 decide-batch 和返回卡片，后端一次 persist；未改为逐项接收。当前先复用同一快照的位置工作，逐项版本、方案、CAS、宿主和恢复保护不变。

接收导航与事务反馈：当前问题仍有可审核项时保留，否则进入后续有可审核项的问题；无可达项时明确已保存及筛选、暂缓/冲突入口。批接已保存但刷新或后续导航失败时明确勿重复接收。保存返回 false 时保留错误并提示先核对编辑器与事务，不认定磁盘未变。S-transaction-tests2 对 workbench/host edit/transaction exit 0；隔离测试模拟目标字节已写入而编辑器保存返回 false，确认事务保留且报错；还核当前问题剩余/下一问题、已保存但刷新失败。该模拟不证明真实现场具体拒绝原因或其事务已恢复；现场仍由总控在合格宿主上按现有协议单独核对。

翻译片段共享：同一审核卡原文/方案未变时复用定位差异，前端一次渲染复用相同结果；原文或候选改变即重算，保留原选区和版本核对。S-translate-final-test、S-translate2-ui exit 0；合成翻译验证片段、跨卡中文批注和 429 可见，截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-b541bb17d76b438494c3c90ed66521e4.png 已看，私有桌面、Default 前中后 HWND 66058 不变。网络耗时与实网质量未测，未改变服务排队或超时。

六项隔离测量：S-speed8 在 246 总记录/68 活跃项、合成长正文、两个编辑器组中，从点击到选择清除及当前问题剩余项可见为 633ms，六项状态均 accepted/A、事务已清；host/observer/外层 exit 0，截图 ui-a1b7610ddcf84cc0b18f1172232a4126.png 已看。专属 pipe/profile 和私有桌面均核实，Default 输入桌面不变，但前中后前台 HWND 不同，不能声称前台恒定或把此轮签成完整 UI 保护验收；无证据将其归因于隔离窗口。单组源码显示时 S-speed4 观察器 CDP 会话断开并提前结束隔离宿主，隔离事务保留，不能当作成功或真实现场根因；S-speed5 同类双组业务 669ms、前台亦变化。S-speed6 业务观察 515ms，但外层对空桌面枚举返回 false/last-error=0 断言失败；S-speed7 修正该夹具判定后业务 563ms、外层 0，前台仍变化。S-speed/2 准备夹具状态写入及计数器分别出错，S-speed3 观察器引号语法错误，全部首败保留，未对任何未知结果重放或清理。以上不替代受保护前台恒定条件下的最终复核，也不能说明真实事务已恢复。
