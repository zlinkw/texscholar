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

S-speed9 以相同合成规模在最新修改下测得点击到完成显示 546ms；六项均 accepted、事务为空，host/observer/外层 exit 0，Default 输入桌面和前中后 HWND 132560 不变，GUI 在私有桌面且桌面关闭。截图 ui-7fa71f8142064cf981129ed6e7b8dc43.png 已查看。该结果不代表真实论文事务已恢复或网络翻译耗时。

保存失败补充保护：隔离宿主注入实际保存后返回 false，验证正文可能已写而事务仍保留；界面显示恢复提示，禁止当前及其他卡再次接收，保留选择供核对。S-savefail3-test 49 项及 S-savefail3-ui、S-savefail3-verify exit 0，前中后 HWND 132560 不变，截图 ui-467d7bcc5f554b39b55a727caafa4d96.png 已查看。S-savefail 首次外层因空桌面枚举夹具判定 exit 1；S-savefail2-test 首次实现过宽禁用其他卡而有一项失败，收窄事务标志后通过；两者原日志保留。此人工注入无法确定真实保存失败原因。另一次只读验证脚本路径猜错和一次 PowerShell 引号错误均 exit 1，随后只读状态成功，无文件被删除。

总控现场恢复更新：真实事务 f2d0537322d016a432837f39fe5174cc634aceefbf1952cd7aa3452a0bdf57df 已由总控通过合格宿主和既有 writer/版本/脏稿检查执行 recover exit 0；读回 transaction=null，其他状态与原状态去掉 transaction 后相等，正文、论文 Git index 和 HEAD 不变。证据见 D:/latex-writing-checks/question-mode-latency-20261124/controller-recover-once.py 和 recover1.*。原 doc.save false 具体原因仍未知；本执行者未触真实项目或管道。

S 返修1后端：按用户要求将一批待译内容用独立编号合并到所选服务请求，严格校验分段及每段 TeX 标识后才写成功结果；缺失、重复或错位均报错，纯公式保持本地，429 不暗重试或换源。原单项协议保留。S-r1-translate-test2 合成供应商与原协议测试 exit 0；README 删去已撤展示的句数范围承诺。客户端合批和隔离界面验证随下一批完成。

S 返修1客户端：当前可见问题、原文和方案通过同一批次请求，精确身份独立路由；同文同类型/方案成功结果复用。旧视图在途请求不阻挡新视图，迟到结果依身份与源版本丢弃，同一在途项不重复发出；未保存稿、收起、手动重试与现有服务选择仍受原约束。S-r1-workbench-test6（设置专用 LOCAL_LATEX_TEST_ROOT）、test7 和 S-r1-translate-test2 exit 0，含慢旧批次、新视图、精确批注、错误编号、公式串段和429。S-r1-ui4 正常私有 Development 实测合成问题、三个卡片原文与方案合并请求并分别显示，译文划词保存后只读状态核 item/version/A/原始范围及问题身份；host/observer/外层 exit 0，输入桌面 Default、前中后 HWND 197346 不变，私有桌面关闭，截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-d34e45836e1840489315ec1b041b09c2.png 已看。该实验为让多卡同时进入可见区临时缩小私有页面，截图前恢复正常倍率；只用合成文字，实网供应商对编号的保留和翻译质量未测，损坏编号会明确报错。

原失败均保留：S-r1-workbench-test 首次 Node 路径引用错误未启动；test2 因测试使用 setImmediate 假定旧调度而未等请求开始，改为等待实际供应商启动后 test3/test4 通过；test5 未设置隔离测试根导致 hostFixture 报错，补设置后 test6 通过。S-r1-ui 首个夹具将“请”误认作含“中文”而超时；ui3 内容和保存观察通过但外层对空桌面枚举 last-error=0 判错，沿已核实夹具修正后 ui4 全部通过。相关 stdout/stderr/process 与独立夹具保留于 D:/latex-writing-checks/review-efficiency-20261122，无删除。

S4 交付：版本和 MCP 一致性、隔离 MCP 及发行工具检查通过；新增 uuid 使用 Python 标准库，原打包清单已含受影响运行文件。S-delivery-version、mcp2、publisher2 均 exit 0；首次 mcp/publisher 误复用已有 M 夹具目录而拒绝运行，改用全新 S 根后通过，原错误保留。一次 PowerShell CLI 列表路径引用错误未启动，后续显式引用 list-before exit 0 显示 0.9.63。

唯一构建 S-delivery-build exit 0，输入 ba62764f843c0fef91343c0a09ade8bb5ac20488。dist/v0.9.64/texscholar-0.9.64.vsix SHA256 db12dc9566f971b1a856b26a2f1edfb52ab71aed5ec1891846db1940ea1c0122；texscholar-0.9.64-source.zip b5950b4527993d2869cb7cb62ae47a8897f3584bc6e85ce19dd904594aa4bd52；SHA256SUMS.txt 3cc583bc27d6e56f4cd03bfd55b5d52286631b8c6e10cfbd3ed5fb18193e8681。远端附注 v0.9.64 对象 100e0cee71dfd9c20e679c2c8778bd162b833188，目标为构建输入，附注含 SOURCE-COMMIT 及双包摘要；普通推送 exit 0。

S-delivery-publish exit 0，正式 Release https://github.com/zlinkw/texscholar/releases/tag/v0.9.64 非 draft、非 prerelease，API 三附件摘要与本地一致，S-delivery-verify exit 0。实际 `code.cmd --install-extension D:/GitRepo/texscholar/dist/v0.9.64/texscholar-0.9.64.vsix` exit 0；CLI 与 manifest 显示 local-research.latex-writing-tools 0.9.64，登记 source=vsix、pinned=true。未重载用户窗口，安装不代表活动宿主已加载；未探测旧桌面 MCP。总控 Bing 合成三段实网接口兼容通过，其他供应商编号保留及实网质量未测。真实稿原事务已由总控恢复，原 doc.save false 原因仍未知；未新接收、未删除清理。日志见 D:/latex-writing-checks/review-efficiency-20261122/S-delivery-*。

T 定位：总控只读现场 exthost.log 发现 ep、eq 两个解析失败，与业务日志中接收后移除的旧当前项身份和顺序一致；业务日志无绝对时间，不声称逐毫秒关联。本机 VSCode 实现按 TreeItem.id 生成 handle，同 id 换对象本身不足以证明错误。T-accept-red 在正常隔离 Development 使用旧代码，门控旧项 reveal 入口，在门控期间对合成项目实际接收该项并刷新移除，释放后真实 VSCode 返回 `Cannot resolve tree item for element 1/[... ,1]`；宿主/观察器/外层 exit 0（错误由夹具记录），截图 ui-af182a7b991c4111aa192a8976008a03.png 已看，非真实论文。T-id-red2 按 id 模拟父子解析并在移除/session 变化时给同类红灯；T-id-red 首次缺少隔离 package.json 未运行到断言，保留原失败。

修复在 reveal 进行中合并延后树刷新，结束后应用最新记录；同一 session 的文件、审核项及批注对象保持稳定，切换 session 或文件不复用旧身份，旧 session 队列不再选中新项。快速切项仍合并为最新目标，真正 reveal 错误仍向原调用方报告；不加等待延时或重试。T-tests-final 执行 inline_review/workbench 测试 exit 0，涵盖 id 解析、同卡刷新、批注父子、快速切项、移除及 session 换代。T-accept-ui 修复版同一隔离条件下在 reveal 门控期间实际接收合成项1，释放后选中下一项2、事务完成；host/observer/外层 exit 0，输入 Default 前中后 HWND 264506 不变、GUI 在私有桌面且关闭，截图 ui-38b71429ea65438393205f667c3e4a41.png 已看。正常刷新交叠 T-ui-run 另行 exit 0，截图 ui-baca384a4c9d4f099ff1df99836d9f1d.png 已看。

保留边界：旧代码同 id 刷新或合成 session 切换的 T-real-red、red2 未重现真实拒绝；red4 在 getChildren 门控下模拟移除但未拒绝，red5 等待第二次 provider 调用未观察到该调用、未拒绝；这些不是通过修复的证据。T-red 初期按对象引用模拟过严，不单独作为真实故障证明。所有原日志、完整 argv、隔离资料与截图保留于 D:/latex-writing-checks/review-efficiency-20261122/T-*；未触真实论文、用户窗口或默认管道。

T3 交付：预核 v0.9.65 本地及远端 tag 不存在、Release API 404、输出目录不存在；版本/MCP一致性、专用隔离 host/pipe 的 MCP 检查、发行工具测试均 exit 0，受影响运行文件已在原打包清单，无新增依赖。日志为 D:/latex-writing-checks/review-efficiency-20261122/T-delivery-*。版本与总控支持计划同批提交并普通 push/fetch；唯一构建 T-delivery-build exit 0，输入 23690cc69572933be3967c9c74a61ea1d00ed615。

dist/v0.9.65/texscholar-0.9.65.vsix SHA256 38d307664fd84f0850c74a7b6e6b291ee5c267d8343889123f172e8347ea592c；texscholar-0.9.65-source.zip bad16c4379378cc4031ee3ab887611a7b73b3f598123fc4c7e6c6eb654174fe8；SHA256SUMS.txt b8ebe7e4be9a40f2d12f49c41ac8e15b2cfc476b8ef2764ce1d7742671eac79a。远端附注 tag v0.9.65 对象 fe3a854862e1ff2e5dea8418414668b2008f54db 指向构建输入，SOURCE-COMMIT 和双包摘要精确，普通推送 exit 0。

T-delivery-publish exit 0，正式 Release https://github.com/zlinkw/texscholar/releases/tag/v0.9.65 非 draft、非 prerelease，API 三附件摘要与本地一致，T-delivery-verify exit 0。实际 `C:/Software/apps/Microsoft VS Code/bin/code.cmd --install-extension D:/GitRepo/texscholar/dist/v0.9.65/texscholar-0.9.65.vsix` 于仓库目录执行 exit 0，无 force；CLI 与实际 manifest 为 local-research.latex-writing-tools 0.9.65，登记 source=vsix、pinned=true。未重载用户窗口，安装不代表活动宿主已加载；未探测默认管道/MCP、未操作真实论文或删除清理。原首败和 T2 总控补充错误传播检查保留。

U1 附件：根据用户要求只输出所选范围的批注正文、状态、版本和必要选区身份，移除全文、候选、背景、习惯、协议和不真实的 known_feedback 收据；给出精确按需读取入口且明确作者约定仍须遵守。U-attachment-tests 在独立合成根运行 inline_review 测试 exit 0，覆盖本项/所选/全部范围及版本校验；MCP 按需链和其他用户新增目标仍待后续功能批验证，未宣称整阶段完成。

### U1 按需读取（本批）
- MCP 默认不注入未决项、资料、习惯或协议；精确编号及显式文件读取保留，文件角色和返修协议分别按需读取。同步初始化指引，旧完整附件收据仍受原契约约束。
- 隔离测试 U-mcp-tests 首次 exit 1：原断言要求隐式全局规则；改为验证显式文件读取后 U-mcp-tests2 exit 0（12 项）。原日志保留于 D:/latex-writing-checks/review-efficiency-20261122/。

### U2 后台接收
- 通过已打开文档的 WorkspaceEdit 应用受版本约束的编辑并保存；事务、旧状态和迁移路径共用，保留资格、原文、脏缓冲及保存失败检查。
- U-host-tests1 exit 0；私有 Development U-host-ui-run2 exit 0，未打开源文件时单项及跨文件批量接收后审核标签始终活动，源文件没有出现为标签，两个文件内容已读回；Default 前中后前台一致。截图 ui-2da80ea9a7f44ccfaab62fe136eeeb79.png 已查看。
- U-host-ui-run 首次 exit 1：夹具未导出 acceptBatch，并非产品结论；保留原日志。U-host-ui-prepare 首次 sitecustomize 导入警告，prepare exit 0；第二次修正 PYTHONPATH 后 exit 0。

### U2b 底部问题目录
- 同一树随模式切换：按完整问题身份分组，未绑定单列，共享项在各关联问题中出现；点击在问题界面定位对应卡片，并核批次与版本。原段落文件树及明确深审入口保留。
- U-directory-tests4 exit 0（93 项）；私有 Development U-directory-ui-run5 exit 0，实际切换问题、同名不同文件问题、跨文件卡及刷新，未保存批注及 [0,9) 原目标版本不变，前台/Default 不变；截图 ui-fa5958b783c34c25ab482008d16677ac.png 已看。
- U-directory-ui-run、run2 exit 1 为 UI 夹具使用无效无障碍名称，run2 实见问题分组；改用树实际文本后 run3/4/5 exit 0。U-directory-tests2 exit 1 为夹具缺少第二文件源码，补充后 tests3/4 exit 0。原日志保留。
- 最终身份复核提示加入后，U-directory-tests5 及 U-directory-ui-run6 均 exit 0；截图 ui-f63d990bacb043a0b235cbe16d09bf9a.png 已看。

- U-handoff-ui-run 与 U-handoff-mcp 均 exit 0：隔离真实后端导出选中批注，按附件参数实调 MCP 窄读、原文及资料按需取回；截图 ui-e48aa7b6e8864eb1a2328a6ecac0919d.png 已看。
- U-host-ui-run4 暴露关联卡移除后刷新保持绝对滚动值但批注位置漂移；同步刷新时保留可见批注或卡片的相对位置。run5 因子像素差 0.0625 严格相等失败，run6 按小于一像素验证 exit 0；内容、身份、版本及选区不变，单项/跨文件接收后目录已刷新。截图 ui-645291a85dbf44ff815a9c4ab0978c19.png 已看，原日志均保留。
- 总控按新授权已普通推送真实仓库既有格式化提交 323f78c，远端已核相同；未触真实暂存或正文。后台重试及旧提示状态未核。

### U2c 自动备份范围
- 自动备份包含已跟踪修改、暂存及未忽略的新项目文件；已有本地提交经私有目标、祖先和历史隐私核验后普通推送。排除审核目录、临时写入和凭据，保留原互斥、恢复及失败可见机制。工作文件与暂存均变化时取已保存工作文件；仅暂存变化时记录暂存并保留工作文件。
- 隔离 bare 仓库 U-backup-tests5（7 项）与 U-backup-tests6（10 项）exit 0，覆盖本地领先、暂存、新文件、隐私/忽略、真实远端推进及分叉、离线续传、hook、并发和作者批注保护；未连接真实论文。
- U-backup-tests3 首次 10/11：旧测试在存在未决批注时错误期待新批次成功；现依现有 source_review 的保护契约断言拒绝，其余保护和覆盖保留。后续 tests5/6 均通过，原日志保留。

### U2d 方案框批选

问题模式可通过方案框非交互区域选择对应项、版本和方案；复选框可取消，键盘选择、目录选择、计数和高亮同步。拖选文字及操作控件不触发批选。

验证：U-choice-tests3 94/94，exit 0；独立 Development 的 U-choice-ui-run4 exit 0，覆盖 B/C 切换、共享项、目录更新、取消、键盘、拖选和编辑按钮，隔离源文件及状态字节不变，默认桌面与前台保持。截图 ui-1a0f65bc918c41788ea8f455eb7a63f8.png 已查看。U-choice-ui-run2 因观察脚本引号错误 exit 1，原日志保留；修正后 run3、run4 exit 0。
