# 问题审核翻译修复

## 目标与当前事实

2026-11-24本代完成，Q返修1已闭合，0.9.62正式发布并同包CLI安装。功能最终源码e180098f6bf008da94aa0b86db5ff42da0020e44，版本/唯一构建输入f7ab6dc7f0df11bc0da30e7beaee0cc56b61a3a5，execution尾1f97eba42a93a53e02175732af8a0af936a487f9普通push/fetch同步clean。总控已审完整8文件实现及R1四文件差异，独占跨模式/跨卡组合及交付元数据通过；未接管产品实现。按用户既有流程完成必要版本/发行检查、唯一构建、正式tag/Release及同VSIX安装，未重载/重启用户窗口或MCP，无包后冒烟。

总控实核https://github.com/zlinkw/texscholar/releases/tag/v0.9.62为正式版（API draft=false、prerelease=false）；远端附注tag对象f7ea2bdf29980fc3d3f2f31d2e796f3e5394dd16及解引用目标f7ab6dc7与构建输入相符，SOURCE-COMMIT/双包摘要正确。API三附件digest等于已构建和安装包：VSIX 17e4c46755457c01745818c256fefe68c59d7b3b8d7d60f4f46c6b6c47dc0cc5，source.zip 93690cb8ba25485ff340a13ce4c9a902ca6b0f30a652f3ee65444d359dde13b2，SHA256SUMS.txt 629be5b2d7b479a43dc597c445eb1843a5007ea23ee55c3c970f1dbc10072557；实际安装manifest及登记同为0.9.62、source=vsix/pinned=true。唯一build/publish/install各exit0，安装Node DEP0169警告及预检预期404/其他原失败完整见execution。安装不表示活动宿主已加载，用户重载目标窗口后启用修复；旧MCP连接后续状态未探测，不冒称刷新。所有租约已交回、无在途。

用户2026-11-23报告：问题审核模式默认自动翻译及手动翻译均无效，原每张卡片的独立翻译按钮缺失，“变更片段”视图也无翻译。按既有总控兼最终验收＋唯一Terra执行流程直接复现、修复并验证，不重做已完成论文迁移。

普通Windows仓库D:/GitRepo/texscholar，master跟踪origin/master，初始HEAD均9cfc2a0bc24102018a09a11f23b189b71917708d、clean，已发行/安装0.9.61。总控local/01a20811-7c1e-7a50-908c-c59a658531a0维护本计划/index及最终审核；唯一现任Terra local/01a208d4-2ab9-7a93-9994-56e2c5dfc6c7负责复现/实现/小验收/execution及获派交付，无新增代理。沿用原模型身份与caveman接替，不因新缺陷另建聊天。

初查真实源码：review_workbench.js的translationItems只由loaded当前项原文/ABC/关联问题产生；client的renderTranslation仅寻找originalZh/zh-标签/zh-question编号。renderQuestionMode另建整组问题及各卡原文/方案节点，却没有中文区域或翻译入口；顶部translateStatus也处于段落review区域。此为静态可达缺口，尚未冒充运行复现。优先验证三类原因：问题模式结果节点/身份未接通；当前可见多卡调度和片段映射未接通；手动入口与错误反馈隐藏。网络来源失败须与渲染/调度错误分开，不将旧桌面MCP连接版本失配当成本地翻译根因。

## 范围、保护与验收

复用现有翻译服务、来源/代理、精确缓存、TeX保护和webview协议，修复问题模式的完整问题/原文/ABC译文、自动和手动入口及每卡可达按钮；段落模式原有独立入口也核对恢复。全文对照与变更片段均应在对应内容旁显示可辨识中文，片段与原始身份/版本/方案准确关联，不混卡/串译或用全文译文伪称片段映射。若片段切割涉及公式/引用结构，复用既有合法文本准备边界，不将截断TeX发给服务；必要取舍先按真实契约核定。未保存草稿不外发，旧版/过期结果、切换模式/问题/来源及迟到返回不能污染当前显示；用户手动收起不能被刷新反复展开。

自动翻译仅处理当前可见内容，不整篇预翻译；关闭自动后手动单卡不触发其他卡片请求。请求失败/429/纯公式需在所处模式/卡片可见，保留已成功部分，不自动换源或无依据重试。翻译不接收、不保存论文/候选/批注，不编译/Git。划词批注若落在新增译文区域，须保持原精确ID/version/side/option/问题身份及现有译文上下文约定；不能用移除旧批注能力规避。

真实论文D:/Overleaf/TMI-DA-Marked-up Copy和真实P/全部26批注/561对象/候选/三类草稿/模板/范围外stage保护，不操作真实窗口、默认pipe、连接或迁移。当前桌面TeXScholar MCP仍0.9.60版本拒绝事实保留，本修复不依赖它。不得重新reload/restart用户窗口、安装/发布、清理文件/对象/截图或运行cleanup。本阶段只产品实现、隔离验收和普通源码同步；最终审核后再确定具体同包交付，不提前构建或发行。

## 连续步骤与租约

- [x] Q1 Terra在现有workbench真实协议/DOM入口建立失败信号，Q-ui-red/Q-host-red保留，e4b4773实现当前修复；总控审实际8文件diff及负责调用链。
- [x] Q2 局部Q-editor-final5 90项、Q-feedback-final 10项及正常Development Q-ui-green4/5/6/7均exit0；单卡手动/全文片段/429/跨卡译文批注保存定位/可见自动/收起及全局按钮通过，合成供应商不称实网质量。各原失败和独立profile/pipe/私有桌面证据见execution。
- [x] Q3 Terra两次完整冻结交包，总控审真实diff/调用链及原日志，Q-R1修复后完成独占正常Development跨模式/跨卡组合，结果及边界如下；全部测试/UI租约已停止使用，无在途。
- [x] Q4 必要版本/MCP/运行依赖闭包、隔离MCP2项及发行工具13项0；唯一构建0.9.62、正式tag/Release和同包CLI安装完成，总控仅核上述元数据通过。实网供应商质量未测，未自动重载/重启。

每个内聚批最多2至3个相关问题、8个源码/测试/文档文件，优先负责边界而非新增框架。普通精确stage/commit/push origin master/fetch核一致，远端前移等停止不reset/rebase/merge/force。UTF8、pwsh7、Python -B -X utf8；完整日志和首败保存新证据根，不覆盖/删除。总控计划/index与Terra执行源码写入必须按租约串行；派单成功后总控无独立工作则角色空闲，按必要消息续接。

## 已知边界

2026-11-24总控最终审核发现Q-R1：问题模式questionTranslations按卡片身份缓存，未接上原(provider,text,kind,option)成功结果复用；README同时移除了原有跨有效卡片相同内容及问题复用说明，不能仅为新实现改变已有支持契约。外置controller-cache-check2.cjs实际调用当前createWorkbench，同一问题下两张有效卡的同文同方案A，消息各自精确路由2条但供应商调用2次，期望1次，真实exit1。证据D:/latex-writing-checks/question-translation-20261123/controller-cache-check2.cjs及.result.json/.stdout.log/.stderr.log。首个check夹具漏workspaceState，questionTable为空，断言0条exit1，不当作产品缺陷；新check2按实际协议补齐才证明重复调用。此为既有请求复用契约的正确性核对，无新增性能测试/阈值。

Q-R1现已闭合，Q返修1。e180098f在既有translations/translationKey复用provider/text/kind/option成功内容，逐卡questionTranslations保留精确批注身份，失败不进入共享成功；README恢复原契约。Q1-cache-red及unit-red真实1，修复后cache-green/unit-green2和workbench-final45项0，未改client/后端/TeX，相应Q局部GUI/后端覆盖复用，无新增性能检查。

总控独占最终组合D:/latex-writing-checks/review-efficiency-20261122/qtranslation-controller1，准备/运行脚本和外层日志位于D:/latex-writing-checks/question-translation-20261123/controller-ui-*。新独立profile/专属管道/私有未切CreateDesktopW，正常Development真实inline/workbench/后端及合成供应商：先段落3/A真实按钮取得译文，再问题模式1/A和3/A共用该成功结果而各自显示；切至同ID不同file/quote的问题不套用旧译文；问题1/B在途时切段落，释放后其旧结果不显示，再段落3/B正确显示；切全文后原同文A继续复用；真实输入未保存B草稿再回问题模式，该卡译文入口暂停、草稿保持且未外发。全部合成请求3次符合明确操作序列，无重放/预翻译；source/state逐字保持，未接受/保存批注/编译/Git。

controller-ui1外层、host、observer均exit0；Default输入桌面及前中后HWND25630512相同，GUI不在Default、私有桌面已关闭。截图C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-4d7f5a6fd20a487a93b1fbff3e004292.png已实看保留，可见独立翻译/收起入口、正确原卡译文及另一卡未保存草稿提示。合成供应商只证明调度/渲染/身份，不声称实网质量；旧桌面MCP连接限制、真实论文/P/旧批注/对象/草稿/stage保护及其他原未测继续保留。此后不重复功能组或增加包后检查；仅交Terra Q4版本/构建/发行/安装/Git租约，总控等待正式交付后只核元数据结案。

初次rg向Windows传字面通配src/review_workbench*.js报路径语法错误；后用rg -g实际枚举定位。猜测独立translation/questions模块路径不存在，已纠正为review_workbench.js/client及review_translate.py实际链，不以失败读取当证据。全局规则不另新增AGENTS/issue tracker/triage或领域框架；本轮只修当前功能。旧代全部失败/默认管道拒绝/隔离对象误删事实仍在原execution保留，本轮不重放相关组。
