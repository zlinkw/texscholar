# 问题审核与段落审核能力对照及优化

## AH阶段：外置审核状态与候选迁移读取兼容

AH1–AH2最终审核通过，返修1，冻结ab1b97948ddd4fdacbce5a36afa7cbba78615ef9，HEAD==origin/master且clean。总控审初包9文件和R1实际diff及ai_context/payload/option_effect/历史批注消费者：无proof且已决定的隐式旧依赖仅保留身份/决定和明确不可用说明，先核不可变span及已选方案，不先投影；合法已迁移单方案从原span投影一次，完整proof多方案保持。显式历史、活动、暂留及坏manifest仍拒绝，不合成proof/迁移真稿。复用AH-check8有效17项，R1-check4实际MCP stdio/Server.call两项exit0覆盖accepted_option A/B/C、无效D、同编号返修回读、合法单方案/选B三方案；child正向FakeHost/根/私有endpoint及registrations证明已核。总控accepted依赖红例、R1-check1/2双投影首败保留，纯后端无UI变更不截图，不重复功能组。下一步AH3一次构建正式发行同包安装，暂不重载/重启，不进行真实科研返修。

AH最终审核返修1：初包9d397d9a42ec037fa2ae766a8c9351efdb84f254已同步clean。总控审9文件实际diff及AH-check8定向17项有效证据，发现ai_context在旧依赖分类前调用review.payload；accepted_option存在时payload先调用option_effect，仍触发原缺proof错误。真实只读109/110均accepted_option=A，原测试仅直接设status=accepted遗漏该字段。总控独占隔离controller-ah-accepted-dependency给同一实际MCP场景补accepted_option=A，exit1精确复现上述链，原argv/cwd/env/stdout/stderr保留；FakeHost/根/专属endpoint在实际进程正向断言。交原Terra修分类前读取及相关消费者，只补该缺口与必要保护，未通过不发行，不改真稿/旧proof。

2026-11-26用户明确要求先修插件：read_context报“候选的旧注释没有当前版本的精确迁移资料”，迁移预览又报“需要现有内嵌审核状态”，项目已用外置状态，尚未保存R2-Q2/R4-Q1返修。仅修插件及必要交付，本轮不继续科学返修或同步正文/表注/结论，不修改真实论文、批注、候选、依赖及登记。基线0e212f98dba130045e71423bce80d39b7379f77e，HEAD==origin/master、clean，0.9.77已安装。沿既有总控与唯一Terra角色，AH返修0；验证后原流程发行安装，暂不重载/重启。

已只读核：review_migration.preview明确拒绝sidecar，它是内嵌→外置状态迁移；source_review.option_effect按候选精确迁移资料校验并受全局option_migration_complete影响，两种迁移用途不能混淆。真实state schema3、option_migration_complete=true、manifest12项，无transaction；R2-Q2/R4-Q1相关活跃107/108/112/113/114/115/bg/bh当前版本均有对应proof/manifest版本键，历史accepted/rejected项多无当前proof。尚未运行真实MCP/后端，不据这些元数据宣称唯一根因。需在隔离夹具还原真实读取条件，区分缺失/损坏证明、历史或已处理项、正常新候选及误入迁移入口。

- [x] AH1 原Terra一个完整功能批：在隔离外置项目通过实际read_context消费者复现原错误及迁移预览冲突，确定产生不兼容状态的实际读写链；最小完整修复合法现有状态/精确候选迁移资料及受影响读取、返修与保存调用方。复用已支持的精确proof/manifest/原对象，不全局跳过校验、自动去注释、猜新版本证明或把外置状态退回内嵌。若现有合法资料足够则兼容读取；真实损坏/来源不明明确定位冲突并给适用恢复路径，不能静默丢批注/依赖或返回空候选冒充成功。迁移接口/错误指引须与当前外置状态相符；只有确需显式修复时准备可核预览和原CAS/宿主事务，不自动迁移真稿。补齐必要消费者、源码说明及资源闭包，不新增通用兼容平台/无依据回退。
- [x] AH2 Terra必要定向验证：schema3既有迁移完备/携带映射、合法新候选与历史已处理项、旧批注/previous_feedback/依赖按需读取、当前与历史精确proof及manifest不符/缺失拒绝、跨版本及换行语义；实际MCP read_context读取R2-Q2/R4-Q1形态相关项成功，并在隔离项目保存同编号返修后回读、正文/表注/结论关联及未决/暂留/范围外数据保持，原科学内容不重写。原内嵌迁移合法路径与外置入口行为按受影响消费者回归。复用有效旧证据，不跑全仓/性能/删除cleanup/完整备份；每业务Python实际child正向FakeHost/AH根/显式私有endpoint。若修改可见UI/入口则按silent-ui-screenshot必要真实Development私有未切桌面实点；纯后端兼容不机械截图。总控冻结后审实际diff/必要链及有效证据，仅补影响结论的缺口。
- [ ] AH3 总控明确通过后原Terra必要发行检查、一次构建、正式Release及同一VSIX安装；总控独立交付meta并plan/index/execution集中结案，暂不重载/重启，不包后冒烟，不触真实迁移或论文返修。

总控plan/index支持增量随成功完整批提交，随后转Terra产品/测试/UI/隔离配置/execution/Git租约；证据沿D:/latex-writing-checks/review-efficiency-20261122/AH-*保留argv/cwd/env/stdout/stderr/真实exit及首败，唯一execution登记。普通Windows/pwsh7/显式UTF8/Python -B -X utf8、精确stage/commit/push master:master/fetch，远端前移/权限Hook拒绝停止相关动作，不reset/rebase/merge/force/改remote。真实D:/Overleaf/TMI-DA-Marked-up Copy、P/个人资料/state/候选/批注/三稿/依赖/stage及全局host-lifecycle只读；不恢复真实登记或事务、不接收/返修真实项、不触用户窗口/默认pipe/MCP/实网AI、不删除文件对象截图或cleanup、不改全局技能/config/TeX，不新增代理/性能测试或改超时退役。无待用户选择，完整AH1–AH2冻结交包后再派AH3。

## AG阶段：旧批注适配入口可发现

AG已完成，返修0：[0.9.77正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.77)并安装同一VSIX，唯一构建源码88503d18d19934d9e6df5e79418fd2c9c334b40f，build/安装exit0。总控独立核本地/远端附注tag对象9fd00fe48de22ced8703dce4a65d640b579cf2fd、目标及SOURCE-COMMIT/双包摘要；controller-ag-release-meta.py实际读取正式Release API，三附件digest与同一本地产物一致，manifest及source=vsix/pinned登记0.9.77，exit0。原记录D:/latex-writing-checks/review-efficiency-20261122/controller-ag-release*及AG-delivery-*，预期404与Node DEP0169警告保留。用户指定的首屏顶部按钮、命令面板搜索及选择具体旧批注准备适配均已在AG-ui12实际键鼠通过并逐张实看截图；未发送真实AI或操作真实稿件/登记，未重复功能/UI或包后冒烟。暂不重载/重启，活动宿主加载未知，三docs集中结案，无在途。

AG1–AG2最终审核通过，返修0，实际冻结ac58e6a3319a8d0fd0cf65295502cc3d12ccdf70，HEAD==origin/master且clean；以实际Git为准，交包消息中不同提交号不作基线。总控审10文件真实diff、顶部/命令贡献及注册、冷打开/同项草稿/导航次序、精确选择与交接链；复用AG-check7十项exit0、AF状态及R1有效覆盖。总控核AG-ui12原始run/host/done、实际键鼠观察器、后端root/FakeHost/专属endpoint证明及附件；当前三份界面实现与被测副本逐一一致。正常Development实际package/main激活，长候选首屏按钮可见可点、命令面板可搜“TeXScholar: 适配旧批注”并选择审核项、勾选一条此前要求生成仅该要求的适配附件，未发送AI；同项命令保持未保存草稿，state/正文保持。host/observer/outer exit0，Default/前中后HWND855866不变。三张ui-dfb09d9b7fa74dd0b6ee0e83b38834dc.png、ui-aae4dfe90e094dbca9ae232b18e42450.png、ui-1e92eb3d302248f68ae53bfc84e08f97.png逐张实看。AG-ui9仅构造HostSession时核根的证明不足由ui12每实际child实核补齐，原失败/限制保留。下一步AG3一次构建正式发行同包安装，暂不重载/重启，不重复功能/UI组。

2026-11-26用户在146长表格审核页截图报告“还是没按钮，也没有对应的命令”。基线1d718df494c29e14d56d09e081b6d0f620e9af49，HEAD==origin/master、clean，0.9.76已安装。只读核源码：AF单条按钮仅在长原文/方案下方的批注区且按状态显示，package没有适配独立命令，用户在顶部找不到。最新Code日志20261126T113428含0.9.76 chktex_filter路径及扩展激活，不能未经核实归咎未重载；不操作用户窗口补证。沿既有总控与唯一Terra角色，AG返修0，验证后发布同包安装，暂不重载/重启。

- [x] AG1 原Terra一个完整功能批：审核页顶部直接可见“适配旧批注”入口，段落/问题模式均可发现，长表格或候选不需滚到底；注册同名可搜索的命令面板命令，可沿现有常用侧栏复用。入口打开明确的批注选择/适配管理界面，保留当前内容状态、原要求、适配结果待审与单条入口；没有需要适配的要求时给明确结果而不是无反应。顶部从当前精确审核项进入；命令从实际项目及审核状态选择，不能误绑当前非论文编辑器、另一仓库/owner/批次或隐式交接全部。复用原精确选择与按现稿提示链，只有用户明确选中并确认准备时加入Codex输入区，不自动发送AI、接收、关闭或改登记。AF原底部入口、已关联状态和内部来源/草稿/写入保护保留，补必要说明及调用方，不新增重复批注状态或恢复机制。
- [x] AG2 Terra先复现长内容首屏无入口/命令缺失，再集中定向核顶部与命令声明/真实注册路由、已有页和冷打开、当前项目选择、无旧要求提示、取消/范围与版本批次变化保护；复用AF状态语义与R1有效证据，不重跑同组。正常Development专属profile/pipe、私有未切桌面实际鼠标验证长内容顶部点击和命令面板键盘搜索选择，核精确批注选择及附件准备，源码/state/草稿保持；截图实看，Default及前中后前台不变，真实host/observer/outer退出保留。命令验证须来自实际贡献声明和真实注册链，不能只在最小夹具另造命令后宣称产品可搜索。总控冻结后审真实diff/调用链和有效证据，只补影响结论的缺口。
- [x] AG3 总控明确通过后原Terra必要发行检查、一次构建、正式Release及同一VSIX安装；总控独立交付meta并三docs集中结案，不包后冒烟，暂不重载/重启。

总控维护plan/index，先支持增量后交Terra产品/测试/UI/隔离配置/execution/Git租约，支持docs随成功完整批提交；普通精确stage/commit/push master:master/fetch，远端前移或权限/Hook拒绝停止相关动作，不reset/rebase/merge/force/改remote。证据D:/latex-writing-checks/review-efficiency-20261122/AG-*，argv/cwd/env/stdout/stderr/真实exit和首败保留。Python业务每实际child正向FakeHost/AG根/非默认endpoint；真实协议测试child明确专属pipe及根。不新增性能或改超时/退役，不含删除cleanup/完整备份组，不重复AF功能/UI。实际AI添加/翻译/备份用隔离桩须说明，不冒称AI已执行。

真实D:/Overleaf/TMI-DA-Marked-up Copy及P/个人资料/state/候选/批注/三稿/stage、全局host-lifecycle只读；不恢复真实登记、不操作146/147、不触用户窗口/默认pipe/MCP、不外发AI、不删除文件对象截图或cleanup、不改全局技能/config/TeX，不新增代理。普通Windows/pwsh7/UTF8/Python -B -X utf8，无待用户选择。先完整AG1–AG2交总控，不提前发行。

## AF阶段：旧批注适配状态与界面直接入口

AF已完成，返修1：[0.9.76正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.76)并安装同一VSIX，唯一构建源码33ded3f15048c5ed4688660029f53bf5f7da611d，build/安装exit0。总控独立核本地/远端附注tag对象b7f368c44ccbeb085c35bbac10ac22fb7bc50859、目标及SOURCE-COMMIT/双包摘要；controller-af-release-meta.py实际读正式Release API，三附件digest与同一本地产物一致，manifest及source=vsix/pinned登记0.9.76，exit0。原记录在D:/latex-writing-checks/review-efficiency-20261122/controller-af-release*与AF-delivery-*，发行资格夹具首败及修正、Node DEP0169警告保留。复用有效功能/界面验证，未重复构建/安装/包后冒烟。未操作真实登记/论文/批注，不自动发送AI或接收/关闭要求；暂不重载/重启，活动宿主加载未知。三docs集中结案，无在途。

AF1–AF2最终审核通过，返修1，冻结6970c9569bd66ce918d0606fc130b947aa6ef732，HEAD==origin/master且clean。总控审初包11文件及R1完整diff、来源/映射/精确交接和刷新调用链，无新增依赖或自动写入。复用AF定向检查与正常Development AF-ui5实点，逐张实看ui-57d764eecd3a4556a163f29397e1f17d.png、ui-4cb8b2d9b71e4e6397d5467a3d496a0e.png；宿主/观察器/外层exit0，Default及前中后HWND4130936不变，隔离源码/state保持，Codex添加/翻译/备份为声明的桩，不代表真实AI执行。

R1保留原来源陈旧及旧选区关联限制，按当前已保存候选与当前源验证新fulfillment。总控核AF-R1-check3真实后端/客户端数据及child隔离证明、check4最终客户端/两项工作台记录：原文选区变化并同步、旧标记保留、当前及previous-only有效新映射显示待审核和部分处理说明，候选再变/源冲突/再次同步失效，正文草稿不显示旧说明，均exit0。原AF-check5夹具无内容变化失败、R1重叠变更首败及旧客户端红例保留，不改签，不重复有效UI组。无产品阻断，下一步原Terra执行AF3一次构建正式发布同包安装，暂不重载/重启。下文返修说明为已解决的历史事实。

AF最终审核返修1：初包f50b9e62b5c4b66276d538db1ee1e3f9ad113bbf已推送且clean。总控读实际diff及AF-ui5原始结果、观察器实点链和两张截图，单条交接/两模式及现有映射展示有效；但源码显示mark_original_stale会持久保留原批注source_stale，validFulfillments无条件据此丢弃当前候选中的新映射，导致真实原文变化后重新适配成功仍无法显示待审核。原来源陈旧与当前返修映射有效性需分开；保留旧来源标记和关联限制，按当前已保存候选/当前源/有效映射判定新结果，再变化仍失效。交原Terra定向补完整路径及必要消费者，不重复既有UI组或发行，修复后再交最终审核。

2026-11-26用户提出旧批注在界面自动显示适配新版本的登记状态，并明确“那你改吧”。基线2208b6dd207b851414fcaa6a0140fb59dc867dc4，HEAD==origin/master、clean，0.9.75已发布安装。沿已授权两角色及发行流程：总控local/01a212c7-d736-7503-ab7a-9717a426fefb维护计划/索引与最终审核；唯一Terra local/01a21288-5815-7312-b496-006ade07bede连续实现、小验收及获签后的发行安装。AF返修0，不新建角色，不重载或重启。

目标是让用户在批注所在界面直接理解和处理旧要求，不必管理版本号或先进入多步管理列表。能据当前内容可靠关联的显示关联状态；需要语义适配的显示“需要重新适配”及“按现稿适配”入口；当前候选确有针对该要求的有效适配说明与定位时显示“适配结果待审核”。自动呈现状态不等于自动调用AI、接收正文或关闭批注。只准备所选单条要求的现稿适配上下文供用户发送；不把加入输入区当作已适配，不改旧来源版本冒充完成。

- [x] AF1 原Terra一个完整功能批，复用已有批注、source_match/source_stale、候选fulfillment及精确交接链，实现当前/旧批注的明确适配状态和单条直接入口，兼顾段落/问题两种工作台与已有批注管理显示的一致语义。可靠关联必须有当前范围或有效映射依据，不凭版本不同一概失效，也不凭同文片段猜配重复位置；无法可靠对应仍保留要求，准备按现稿重新理解的提示。已保存候选的映射须对应精确request id/version/text、当前方案和范围，源已变或映射失效不能继续显示已适配。保留原批注文本/用途/暂留/历史，内部version/session/owner/CAS、草稿及原写入保护；不增加平行持久状态或全篇重扫/上下文快照。补齐刷新/切项/批次变化、必要调用方及文档。
- [x] AF2 Terra集中定向验证有效关联、需适配、有效结果待审、源/候选再次变化后的状态刷新；重复文字/无法定位、旧选区、此前批注及当前批注、翻译或问题来源按实际支持路径正确处理。单条入口仅交接本条和所需当前内容，交接中批次/候选/要求变化拒绝，范围外批注与正文/草稿不变；暂留及非普通返修用途保持原约束。按silent-ui-screenshot在正常Development专属profile/pipe、私有未切桌面，实际鼠标验证旧批注状态、直接入口及有效结果待审显示，截图实看并记录真实退出和前台保护。AI添加上下文可用声明的隔离桩，不外发、不冒称真实AI完成。总控冻结后审真实diff、消费者和有效证据，只补影响结论的未覆盖组合。
- [x] AF3 总控明确通过后另派原Terra必要发行检查、一次构建、正式Release及同VSIX安装；总控独立核交付meta并三docs集中结案，不重复功能组或包后冒烟，暂不重载/重启。

总控先写plan/index支持增量，随后交产品/测试/UI/隔离配置/execution/Git租约给原Terra，支持docs随成功功能批精确普通commit/push/fetch；不为元数据微提交。证据沿D:/latex-writing-checks/review-efficiency-20261122/AF-*，保留完整argv/cwd/env/stdout/stderr/exit和首败。业务Python每实际子进程正向断言FakeHostSession及AF隔离根/有效endpoint；真实协议测试须显式非默认pipe并在child断言根及端点，LOCAL_LATEX_PIPE不是隔离证明。不新增性能测试，不机械运行含旧性能、删除cleanup或完整备份清理的全套，不改超时或既有退役。

真实D:/Overleaf/TMI-DA-Marked-up Copy/P/个人资料/state/候选/批注/三稿/stage及全局host-lifecycle只读保护；不恢复真实登记、不处理真实146/147、不自动迁移真稿、不外发AI、不触用户窗口/默认pipe/MCP、不删除文件/对象/截图、不cleanup、不改全局技能/config/TeX。pwsh7/显式UTF8/Python -B -X utf8；普通Windows仓库，远端前移/权限Hook拒绝停止相关动作，不reset/rebase/merge/force/改remote。AF1–AF2完整冻结交包后才由总控审核派AF3，无待用户选择。

## AE阶段：恢复入口可见与旧批注按现稿适配

AE已完成，返修0：[0.9.75正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.75)并安装同一VSIX，唯一构建源码3503fdd2d822aae3f8c83df55ab9498beabaafe5，build/安装exit0。总控独立核本地/远端附注tag对象72cd154dd307a2d1cfc8b91694e216fba1d173a0、构建目标及SOURCE-COMMIT/双包摘要；controller-ae-release-meta.py实际读正式Release API，三附件digest与同一本地产物一致，manifest及source=vsix/pinned登记0.9.75，exit0。原始API/argv/cwd/退出/结果在D:/latex-writing-checks/review-efficiency-20261122/controller-ae-release*，原发行安装记录AE-delivery-*，Node DEP0169警告保留。未重复构建/功能组/包后冒烟，未操作真实登记、稿件或批注；未重载/重启，活动宿主加载未知。用户方便时重载目标窗口后可直接搜索恢复命令，旧true仍需首次核对；旧批注交接只准备按现稿适配的提示，不代表AI已实际执行或作者已接收。三份支持记录集中结案，无在途。

2026-11-26用户截图显示命令面板搜不到恢复功能，并提出批注无需让用户携带版本号，正文更新后提供提示词由AI重新适配。基线014d5c396f70b4b2396e08fa4bbbd564a469e78b，HEAD==origin/master、clean，0.9.74已发布安装。总控local/01a212c7-d736-7503-ab7a-9717a426fefb维护计划/索引及最终审核；唯一Terra local/01a21288-5815-7312-b496-006ade07bede实现与小验收，AE返修0。沿原已授权流程验证通过后发布安装，暂不重载/重启。

已核仓库与实际0.9.74安装package：localLatex.resolveReviewHost标题“核对并恢复审核宿主登记”、category“ LaTeX 审核”，commandPalette.when=false，故用户搜不到；已有编辑器右键原文审核与批注→审核高级操作入口。此前总控错误指引用户从命令面板搜索，已向用户更正。真实host-lifecycle仍该项目旧true，未操作登记或真实稿件。宿主资格检查与批注版本检查互相独立，不得把所贴宿主报错误归因于批注版本或为消错误删保护。

采用用户不必管理版本的流程：批注意见可持续用于后续返修，交接旧批注时提供明确提示，让AI按当前保存正文/当前候选重新理解与精确定位。内部来源版本用于解释旧选区和防错覆盖，保留身份/session/version/source CAS、作者接收与正文冲突检查，不删除schema或改写旧批注版本来冒充已适配。适配只重新形成待审候选，不自动接受、关闭批注或覆盖现稿；需要语义判断且不能唯一定位时保留要求，说明具体冲突。

- [x] AE1 原Terra一个完整功能批：让现有恢复命令可在命令面板发现，保留右键与原确认语义；复用已有注册命令，不增加与当前缺口无关的管理平台。批注常用显示/选择不默认堆哈希版本号，改用可理解的当前/此前内容状态，必要原始来源身份留内部。沿既有明确选中批注→Codex交接入口，在当前内容已变化时准备按现稿适配的提示词，强调先按需读取现稿/当前审核状态与相关稳定块、保留原意见、旧选区不得直接套新偏移、同ID返修及原范围/接受约束；不得默认载入全论文/全部批注或自动发送AI。补齐必要调用方/说明与收包资源，不另造重复上下文快照或缓存。
- [x] AE2 Terra定向验证恢复入口实际声明/注册与现有确认保护、跨版本批注明确选中后交接的提示与精确身份、当前批注正常路径、交接期间版本/批次变化拒绝、范围外批注/草稿保持；不放松原写入保护。按silent-ui-screenshot在正常Development专属profile/pipe、私有未切桌面实搜命令并核可见入口，以及旧批注交接/提示呈现；不确认真实恢复、不启动真实AI，观察器不能用API调用冒充鼠标/键盘入口。总控冻结后审diff和有效证据，仅补影响结论的未覆盖组合。
- [x] AE3 总控明确通过后原Terra按既有流程必要发行检查、一次构建、正式Release及同VSIX安装；总控独立核交付meta并三docs集中结案，不包后冒烟、不重载/重启。

总控先写plan/index支持增量，随后将产品/测试/UI/隔离配置/execution/Git租约交原Terra，支持docs随成功完整功能批精确普通commit/push/fetch；不另起微提交。证据D:/latex-writing-checks/review-efficiency-20261122/AE-*保留完整argv/cwd/env/stdout/stderr/exit及首败，复用有效已有验证，不机械重跑AD/性能/全套或含删除cleanup的用例，不改超时/退役。Python业务夹具每实际子进程正向核FakeHost/AE根；专门真实协议测试仅显式非默认pipe且child正向核根和端点。UI专属环境、Default/前中后前台不变、截图实看保留。

真实D:/Overleaf/TMI-DA-Marked-up Copy/P/个人资料/state/候选/批注/三稿/stage及全局host-lifecycle只读保护；不恢复真实登记、不接收146/147、不外发AI、不触用户窗口/默认pipe/MCP、不删除对象/文件/截图或cleanup、不改全局技能/config/TeX。普通Windows仓库，pwsh7/UTF8/Python -B -X utf8；远端前移/权限Hook拒绝停止相关动作，不reset/rebase/merge/force/改remote，不新增代理。无待用户选择，先完整AE1–AE2冻结交总控，不提前发行。

AE1–AE2最终审核通过，冻结5587cf80a369ef61f3ab3819fc014fd28caf5769，HEAD==origin/master且clean，返修0。总控审9文件真实diff及恢复命令原注册/确认、批注显示与交接链，内部来源身份/旧偏移/最新session-version-state检查保持，未新增依赖或绕过写入保护。复用AE-check1/2/4定向通过，AE-check3漏隔离根初始化失败exit1与补验保留，不重跑已有效组。

总控读AE-ui3/5原run/host/done及实际观察器键鼠链、交接附件：ui3真实命令面板搜索并Enter到原作者确认且Escape取消，搜索/弹窗两张截图ui-a32bdac2162946169c73e48484c67b07.png、ui-9abc044413fe4212b537b696ae2fe1db.png已实看；随后隐藏菜单夹具失败导致该次观察器/外层exit1，不能称ui3整体通过，ui1/2/4失败亦保留。ui5展开更多、选择一条此前内容批注并交接，列表及附件两图ui-f83f176c497d482895f46b5ed1b2fce6.png、ui-a136d8ad2dde47c6aec107dff005c464.png逐张实看；宿主/观察器/外层exit0，源码/state前后字节相同，Default/前中后HWND2100482不变。附件只含所选旧要求，保留来源身份、现稿重定位/不套偏移/冲突说明指引；Codex添加上下文/版本检查为隔离桩，测试profile包版本0.9.62不代表实际安装版本，未发送真实AI或确认真实恢复。无新增产品阻断，不做重复界面组合，下一步原Terra执行AE3一次构建正式发布安装，暂不重载/重启。

## AD阶段：单窗口重启后自动恢复旧宿主登记

AD已完成，返修1：[0.9.74正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.74)并安装同一VSIX，唯一构建源码fbaf318bc6d576632fec7c1d850e2bc0c64215f2，build/安装exit0。总控独立核本地/远端附注tag对象ccb1717f00a0f1cd0c6ba61549bc791023fc78df、构建目标及SOURCE-COMMIT/双包摘要；controller-ad-release-meta.py实际读正式Release API，三附件digest与同一本地产物一致，manifest及source=vsix/pinned登记0.9.74，exit0。原始API/argv/cwd/退出/结果在D:/latex-writing-checks/review-efficiency-20261122/controller-ad-release*，实际发行安装日志AD-delivery-*；Node DEP0169警告保留。未重复构建/功能组/包后冒烟；未恢复或修改真实旧登记、未接收146/147、不重载/重启，活动宿主加载未知。旧true仍需首次执行原“核对并恢复审核宿主登记”，建立新身份后才适用自动恢复；真实多宿主/不明连接/未完成事务保护保留。三份支持记录集中结案，无在途。

2026-11-26用户明确要求自动识别并恢复旧宿主登记，避免只有一个窗口却每次重启都需手动恢复。基线0eaf845792e4d35b1b654ff5161b96fdb8851638，HEAD==origin/master、clean，0.9.73已发布安装。总控local/01a212c7-d736-7503-ab7a-9717a426fefb维护计划/索引及最终审核，唯一Terra local/01a21288-5815-7312-b496-006ade07bede实现与小验收，AD返修1。沿已授权原流程验证通过后发布安装，不自动重载/重启用户窗口或MCP。

真实只读证据：用户贴出“审核宿主事务失败；请核对是否存在待恢复意图：宿主资格已失效或存在多个宿主；未提交正文”，并确认只开一个窗口。真实state当前无transaction、146/147仍rework；本机C:/Users/ZLK/AppData/Local/TeXScholar/host-lifecycle.json仅该项目true、mtime2026-11-25T13:09:19Z，当前Code日志20261126T093813。未连接默认pipe、未恢复登记或真实接收。持久标记不能单独证明当前实时成员数；不得把“失效或多宿主”合并错误当成多个窗口的确证。源码registry将persisted[root]直接变为uncertain，断线亦置uncertain，只有resolve-stale人工清除；bridge已有人工确认入口，main deactivate会close，但异常退出/更新可留下登记。应实证重启路径及必要边界，不能仅删除登记、绕过校验或假定PID消失即安全。

- [x] AD1 原Terra一个完整功能批：在专属pipe/journal/隔离论文以真实进程生命周期复现单宿主正常重启与非正常旧登记阻断，设计最小自动识别恢复，使可确认只剩当前有效宿主、旧生命周期已结束时无需手动操作恢复登记并可继续精确接收。复用现有registry/bridge/事务契约，不引入无依据超时、重试轮询、TTL或通用恢复平台；必要身份机制须对应已证缺口。保留旧人工入口，不自动接受任何候选/回放未完成事务，不清理真实登记或稿件。
- [x] AD2 Terra必要定向回归与正常Development私有未切桌面验证：隔离重启/旧登记后自动恢复、实际鼠标接收所选版本；真实同时多宿主、另一有效宿主仍在线/迟到登记、资格generation变化、未登记连接、未完成事务/损坏记录保持必要阻断或显式恢复路径，不丢正文/草稿/意图。按当前契约覆盖受影响原生及已有旧格式消费者，不猜角色文件。已有安全用例如确需改变预期须说明用户新语义及等价边界覆盖，不自动退役/放宽其他断言或超时。总控冻结后审实际diff/消费者/证据，只补未覆盖且影响结论的组合，不重复同组。
- [x] AD3 总控明确通过后另派原Terra预核下一无冲突版本、必要发行检查、一次构建、正式Release及同VSIX安装；总控只核交付元数据并三docs集中结案，不包后冒烟，不重载/重启。

总控plan/index支持增量先写，随后移交产品/测试/UI/隔离配置/execution/Git租约给原Terra，支持docs随完整成功功能批精确普通commit/push/fetch，不为元数据另起微提交。检查每个实际Python子进程正向断言FakeHostSession及AD隔离根/正确endpoint；禁止默认pipe/MCP探测，不用LOCAL_LATEX_PIPE冒充隔离。UI按silent-ui-screenshot正常Development专属profile/pipe、CreateDesktopW私有未切桌面，核Default/前中后前台不变、截图逐张实看。证据D:/latex-writing-checks/review-efficiency-20261122/AD-*，完整argv/cwd/env/stdout/stderr/exit及首败；不机械重跑AC/全套/性能或含删除cleanup的测试。

真实论文D:/Overleaf/TMI-DA-Marked-up Copy、P/个人资料/state/候选/批注/三稿/stage及真实全局host-lifecycle登记仅只读保护；不实际接收146/147、不恢复或修改真实登记/事务、不外网AI、不操作用户窗口、不删除文件/对象/截图、不cleanup、不改全局配置/技能/TeX。程序必要登记原子替换及锁生命周期按既有安全契约审查，不扩清理。pwsh7、UTF8、Python -B -X utf8；普通Windows仓库，远端前移/权限Hook拒绝停止相关动作，不reset/rebase/merge/force/改remote，不新建代理。完成AD1–AD2全部条件才冻结交总控，未通过不发行；无待用户决定。

AD1–AD2最终审核通过，冻结1655dad469b291355e94746d53454ac6b2fac8d9，HEAD==origin/master且clean，返修1。总控审初包8文件及R1完整diff、运行资源和真实协议调用链；寿命由PID与进程持有端口共同保守判断，publish/persist/join顺序及pending/generation保护保留，旧true仅首次人工核对后迁移。业务FakeHost子进程须正向断言；专门协议集成保留真实HostSession并在实际child核AD隔离root和显式非默认pipe，不能用FakeHost替代其覆盖。

总控controller-ad-reserve-recovery真实专属pipe组合首败exit1：多宿主下合法reserve拒绝关闭被误记unknown，第二宿主结束后仍阻断。R1限定单条完整有效且未获写权的已识别请求、已发布寿命身份的连接分类，真正未知/损坏/半帧仍阻断。AD-R1-check4十项exit0含真实Python reserve拒绝、源码/state保持、冲突解除后真实HostSession完整事务、发布未join寿命结束恢复、存活旧宿主及unknown/generation/finalize保护；复用原局部与AD-transaction1/资源闭包，不重复原红例或全组。AD-check2的19过1夹具失败及AD-check4定向补验、dev4意外纳入未做child断言和dev6补验均保留。

总控核AD-ui3-seed及AD-ui3两次正常Development私有未切桌面原run/host/done、专属共用journal及Python委托真实专属pipe证明，宿主/观察器/外层均exit0，Default与前中后HWND6424344一致；逐张实看ui-e427c19e9707452fa419f626d348233b.png、ui-d2eae2c20a9d4244999a1f236524434b.png、ui-23527a7298224749908930cb62a3c385.png。旧格式核对迁移后异常连接结束，新Development自动恢复，真实鼠标脏稿拒绝可见、保存后精确版本A接收。R1未改变该有效正常路径，复用UI；macOS未实机测，不操作真实146/147或全局登记。证据根AD-*及controller-ad-reserve-recovery。无未解产品阻断，下一步原Terra执行AD3必要发行检查、一次构建及同包发行安装，仍不自动重载/重启。

## AC阶段：146与147接收无响应

AC已完成，返修0：[0.9.73正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.73)并安装同一VSIX，唯一构建源码f03c5442ef66389be17efa5313f5a53bb7c03df6，build/安装exit0。总控独立核本地/远端附注tag对象61741e5a4f88ec8198d8fc6eeaf4611a082cf9ac及构建目标、SOURCE-COMMIT/双包摘要；controller-ac-release-meta.py实际读正式Release API，三附件digest等于本地文件，manifest及source=vsix/pinned登记0.9.73，exit0。原始API/进程/结果在D:/latex-writing-checks/review-efficiency-20261122/controller-ac-release*，原发行安装记录AC-delivery-*，保留Node DEP0169警告。未重复构建/功能组/包后冒烟；未接收或改动真实146/147，现场具体拒绝原因仍未知，已修并验证长卡错误不可见这一可达缺陷。未自动重载/重启，当前活动宿主加载未知；用户方便时自行重载目标窗口后启用新版。三份支持记录集中结案，无在途。

2026-11-26用户报告“146 147两个批注点击接收无反应”。基线8fc2a5604430a0f1fa4afa22f81b8a6c0815bbcc，master==origin/master、clean，0.9.72已安装但活动宿主加载版本未知。总控local/01a212c7-d736-7503-ab7a-9717a426fefb维护计划/索引及最终审核；唯一Terra local/01a21288-5815-7312-b496-006ade07bede连续复现、实现、小验收，AC返修0，不新增角色。

只读现场：真实state session e74dbc117a5f4cf4991bfb17187ca9c9，146/147均rework、无待提交事务；146最新版本81218ab73af0d899391cf20bf053a6102f0cff79b0f6f716ea968bb4649201af、generation3，147最新bb20a18b7de37e5083dc243eb6e7b54b5c4e3051d1d42e50b31b399215d82570、generation2。Code日志20261125T224400/window1/exthost/output_logging_20261125T224403/6-TeXScholar 接收与备份.log第21/28/32/36/40行有匹配显示id/version的webview_request，所读40行未见decide；该trace未含消息type，不能据此确定后端原因或宣称接收已完成。源码当前可达检查包括工作台dirty/noteDirty、inline currentFromRecords/cleanBuffers、状态/源码一致性及正文定位；需区分真实拒绝、请求未入写入与提示不可见，不能先放松保护。

- [x] AC1 原Terra在隔离数据及真实客户端/宿主seam建立同症状确定性复现，区分接收前检查、消息/卡片路由及反馈呈现；保留首败和可证伪根因，完成最小完整修复与受影响调用方。合法点击最终接收所选精确版本并反馈；未保存正文/候选/批注、旧版本或真实冲突明确提示并保留内容，不自动保存、接收或猜配146/147。仅按需读取真稿相关元数据/对应块，禁止对真实146/147执行接收、重试或任何写入。
- [x] AC2 Terra集中必要定向回归及真实隔离UI实点，覆盖实际复现路径的成功和当前拒绝原因可见性；按silent-ui-screenshot使用正常Development专属profile/pipe、私有未切桌面，实看截图并核Default/前台不变。测试每个实际Python子进程先正向断言FakeHostSession及隔离根/有效endpoint，不能把LOCAL_LATEX_PIPE当隔离证明；不无选择运行含旧性能/删除/cleanup的整组套件，不新增或改性能测试。总控冻结后审核真实diff/证据，仅补具体未覆盖且影响结论的组合，不重复相同验证。
- [x] AC3 总控明确通过后另派原Terra按既有授权预核下一无冲突版本、必要发行检查、一次构建、正式Release和同VSIX安装；总控核交付元数据并集中结案，不自动重载/重启，不包后冒烟。

总控先集中写本plan/index支持增量，随后通过受支持消息移交产品/测试/UI/隔离配置/execution/Git租约，停止重叠写测；支持docs随成功完整功能批精确提交推送。沿既有权限保护真实论文D:/Overleaf/TMI-DA-Marked-up Copy、个人资料、state/候选/批注/三稿及范围外stage；不操作用户窗口、默认pipe/MCP、不外发AI、不改全局配置/技能/TeX，不删除文件/对象/截图、不cleanup。普通精确Git，远端前移/权限或Hook拒绝停止相关动作，不reset/rebase/merge/force/改remote。pwsh7、显式UTF8、Python -B -X utf8；完整argv/cwd/env/stdout/stderr/exit与失败记在既有execution及D:/latex-writing-checks/review-efficiency-20261122/AC-*。无待用户决定；修复完整交包后总控审核，未通过不发行。

AC当前阻断：长候选被接收保护拒绝时，原错误附加在卡片末尾、落在视口外；AC-client-probe9真实Chromium/工作台消息链复现top4574、exit1，候选修复将消息放在当前可见操作旁，否则回顶部sticky状态区。AC-client-green1同场景top379、exit0，问题卡路径green2亦返回错误；AC-check1局部与check2未保存正文拒绝/保存后精确id/version/B通过。真实146/147方案长度约6000字符，具备长卡条件，但日志不足以认定现场具体拒绝原因。总控已审3源码/测试diff及关键调用链、读原始红绿日志并实看green3截图；仅界面反馈位置改变，未放松接收保护，尚未签AC完成。

正常Development私有桌面red1–4均未host ready，red4明确因vscode-updating互斥等待后拒启动；不能用CLI exit0或headless截图代替规定真实鼠标验收。总控接回租约后只读核CodeSetup进程32332/6052仍存在，无在途；当前6文件dirty未提交，原基线不变。未结束更新、绕过互斥或重载用户窗口。待更新自然完成的实际事件或用户明确调整约束后，续接原Terra补所缺真实UI成功/拒绝路径，再冻结交包审核及原发行流程；不重跑已有效局部组、不新增轮询或监控。

2026-11-26用户明确告知“VSCode 更新已经完成了，继续验证，没问题就按原流程发布安装，暂不重载或重启。”据此恢复原Terra的AC2所缺真实界面检查，复用有效局部覆盖及总控初审；通过后仍先完整冻结交总控最终审核，再另派AC3发行安装。恢复前HEAD及6个dirty文件未变，无在途；只读仍见旧CodeSetup进程，进程存在不单独证明更新互斥仍被占用，以本次正常隔离宿主启动的实际结果判定，不操作或绕过更新进程。总控此支持增量随完整成功批集中提交，移交后停止重叠写测。

本次恢复实际仍阻断：AC-ui-resume1正常启动日志107/112/115行明确vscode-updating被持有，等待31430ms后拒启动；未host ready、未点击/有效截图，观察器/外层exit1，CLI exit0不代表成功。总控回读原日志与run-result，Default及前后HWND526756相同；无在途，全部租约交回总控，6dirty和基线未变，未提交/发行。现需更新锁真实释放后才能补规定UI；不因用户说已完成而改签结果，不重复启动/轮询，不操作更新进程或绕过锁，不重载/重启。

用户随后明确回复“好了”，作为新的更新结束事件恢复同一AC2缺项。复用已有效局部验证及初审，原Terra再次正常启动隔离Development，以真实结果判断更新锁是否释放；不额外轮询，不操作更新进程。通过后完整交总控审核，再按已授权原流程发行安装，仍暂不重载/重启。当前支持记录与6dirty随成功完整批集中提交，租约交还原Terra后总控停止重叠写测。

AC1–AC2最终审核通过，冻结8171f61bd7e36321526fa7c5a5d4f20fa367d69f、HEAD==origin/master且clean，AC返修0。总控核完整6文件diff及必要调用链，客户端只改反馈放置，未改接收guard；复用局部回归及原红绿记录，不重复测试。AC-ui-resume3正常Development真实鼠标点击长卡A，脏正文拒绝提示位于视口内且state/磁盘不变，保存后精确ID1/版本466c42e4…/方案A接收，后端decide及evidence核完整A、无B/C、无关批注不变；宿主/观察器/外层exit0，Default/前中后HWND526756不变、私有桌面已闭。总控读run-result/host-result/done/evidence及dirty/save结果，核观察器真实鼠标事件，逐张实看ui-95ae1953616e43b3b7a058771b2e5264.png拒绝提示及ui-07ddc56af9e3497fad0da0e2b126f330.png成功toast。日志AC-ui-resume3；resume2结果文件尚在写入导致观察器解析失败exit1已修夹具并保留，早期更新锁及red3前台差异不改签。真实146/147具体拒绝原因仍未知、未实操真稿；问题卡路径仅客户端green2覆盖，不宣称完整真实UI组合。无未解产品阻断，下一步原Terra执行AC3必要发行检查、一次构建及同包发布安装；不包后冒烟、不重载或重启。

## AB阶段：保存与后台备份交叠恢复

2026-11-25用户报告后台Git备份经常失败，提示类似后台正在修改。基线0524a584746041c68a0d95aece71a63990a1983e、master==origin/master、开工clean，0.9.71已正式安装。总控local/01a212c7-d736-7503-ab7a-9717a426fefb维护计划/索引和最终审核，唯一Terra local/01a21288-5815-7312-b496-006ade07bede负责复现、修复及局部验证，AB返修0，不新增代理。

只读现场证据：Code日志20261125T193440/window1/exthost/output_logging_20261125T193443/6-TeXScholar Git 备份.log第33、35、40行记录“备份期间源码发生变化：main.tex”，第59行同错误涉及GMAP补充实验Markdown。最新20261125T210917同类日志仅见排队/已保存项目无变化，不能称当前正在失败。真实论文automatic-backup.json的saved_status为idle、saved_done存在；另有旧status记录未归属本地提交/远端推进失败，不得混为同一根因或为消提示绕过其保护。只读未改真稿、ledger或Git。

目标是在自动备份与正常保存/接收/后台写入交叠时，保留待备份意图，在可恢复条件满足后以一致版本继续，避免正常竞态反复终止或遗留失败；不得降低源码一致性、未归属提交/远端历史、暂存区、writer锁及真实错误可见性。先按diagnose用真实隔离Git/宿主/队列复现同一错误，再决定最小修法；不预设重试次数、轮询、超时、吞错或直接跳过校验。检查当前saved_commit、saved_job恢复、事件合并及reviewWriter协作，已有保存发生于hook期间的用例和writer等待用例按有效覆盖复用。

- [x] AB1 原Terra一个完整功能批复现并修复当前可达的源码变化/写入交叠恢复，补齐负责调用方、状态呈现和必要回归。用隔离本地bare仓库及真实Git验证连续保存/接收后最新保存字节最终进入正确提交并推送，工作树新编辑和原index/stage不被覆盖；真实不可恢复冲突仍可见且不误报成功。不要运行含cleanup/完整文件删除的整组backup或finishReview用例，不新增/修改性能测试；新增恢复机制须有本次实际错误和事件依据。
- [x] AB2 总控冻结后审实际diff/调用链和局部证据，仅补未覆盖且影响结论的具体组合。若需审核页状态视觉验收，由Terra按silent-ui-screenshot使用私有未切桌面及专属profile/pipe实测，不操作真实窗口或将API冒充点击。
- [x] AB3 审核通过后按原已授权流程由原Terra预核下一无冲突版本、必要发行检查、一次构建、正式Release和同一VSIX安装；总控仅核交付元数据并集中结案，不自动重载/重启，不包后冒烟。

总控先写plan/index支持增量，随后移交产品/测试/UI/隔离配置/execution/Git租约给原Terra，停止重叠写测，支持docs随成功完整功能批集中普通提交推送核一致。真实论文D:/Overleaf/TMI-DA-Marked-up Copy、个人资料、state/ledger/批注/候选/三稿和范围外stage只读保护，不实际重试/推送真稿，不删除对象/截图/其他文件、不cleanup、不实网AI、不改全局技能/配置/TeX。必要程序自有锁生命周期沿既有安全契约，涉及删除路径的设计/审查按safe-delete-paths，不扩为文件清理。远端前移或真实权限/Hook拒绝停止相应动作，不reset/rebase/merge/force/改remote。pwsh7、UTF8、Python -B -X utf8；证据D:/latex-writing-checks/review-efficiency-20261122/AB-*，保留完整argv/cwd/env/stdout/stderr/exit及首败。

AB最终审核通过，冻结8e1af4cb1cdca2e90de5f3afc193150489c4aae7，返修0。总控审7文件真实diff、SavedSourceChanged仅发生在创建提交前、一次重取的停止边界与原五分钟/保存事件继续机制、metadata链仅释放可恢复错误及所有Git/暂存/锁保护；未改变自有锁释放路径或引入清理。复用AB-check2八项及AB-host-proof1实际子进程隔离证明，AB-check1默认管道尝试被拒与AB-check2七项重复执行均保留，不重签首败。总控独占controller-ab-recovery.py exit0：先正向核FakeHost，在真实隔离bare/自动队列连续两次快照变化可见失败后停止注入，发起后续真实保存，最终保存字节已提交推送、HEAD==origin/master，工作树及范围外.env.local暂存保持。完整argv/cwd/env/stdout/stderr在D:/latex-writing-checks/review-efficiency-20261122/controller-ab-recovery；无真稿/默认管道/删除。只改状态文字、无布局变化，未新增UI操作。AB3正式同包交付和独立元数据核对已完成，结果如下。

AB完成，返修0，[0.9.72正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.72)并同一VSIX安装，唯一构建源码7e15b42feb336a6585630ab0fdc57db4725b81c4，build exit0。总控独立核本地/远端附注tag对象ecc935cdd5c53ad70204dfc46d5d276a8b16129a、target及SOURCE-COMMIT/双包摘要；controller-ab-release-meta.py实际读正式Release API，三附件digest与本地文件一致，manifest及source=vsix/pinned登记0.9.72，exit0。原始API/argv/cwd/exit及结果在D:/latex-writing-checks/review-efficiency-20261122/controller-ab-release*，实际发行安装日志AB-delivery-*。安装exit0伴Node DEP0169警告，未重复构建/功能组/包后冒烟。版本批已将索引中绝对“未操作默认pipe”改为首败曾尝试默认管道被拒，保留实际失败。未操作真实论文或执行真实备份/重试、删除或重载/重启；活动宿主加载未知，用户自行重载目标VSCode窗口后启用。本修复仅处理提交前源码变化，持续写入/真实历史、远端、Hook等冲突仍可见并按原规则处理。三份支持记录集中结案，无在途。

## AA阶段：左侧活动栏快捷入口

2026-11-25用户在Z执行期间明确要求在VSCode最左侧活动栏增加图标，方便快捷打开和管理常用功能。保留Z旧批注直接点击修复，先完成Z返修再执行本后续功能批，最终一起发布安装一次，不自动重载或重启。总控和唯一Terra沿用Z现任，AA返修0。当前09b01b80c526bd5f4f200b3c8b005f4d7fdf6fde为Z首次交包基线，HEAD==origin/master、clean，未发行安装；Z最终审核发现的R1详见下节，不当作已通过。

实现采用新增TeXScholar活动栏容器及轻量原生常用功能列表，复用实际注册命令和已有图标资源，不移动或删除底部论文评论、不复制审核状态、不覆盖用户视图布局。入口涵盖审核工作台、底部论文评论、批注管理、AI论文助手、当前论文背景、个人论文提示词、检查配置和检查更新；按实际语义清晰分组，只有存在且适用的命令才接入。快捷项仅打开对应原功能，保留项目选择、信任、脏稿及原有授权边界；不直接接收候选、自动发送消息或清理。采用VSCode原生拖移/隐藏管理，不新增自定义配置、偏好系统、依赖或管理平台。

- [x] AA1 原Terra一个完整功能批补齐package容器/view声明、现有激活链/命令消费者、最小必要运行资源及收包闭包。新入口在无TeX项目时仍可理解并可访问适用的配置/帮助，论文操作沿原上下文约束说明；不自动打开真稿或猜项目。不为入口文字写镜像测试，在现有合适边界验证实际命令路由、激活与旧panel保留。
- [x] AA2 Terra局部与真实UI：按silent-ui-screenshot在专属profile/pipe及私有未切桌面的正常Development真实点击活动栏图标、快捷项并核最终目标；验证旧底部列表/Z路径仍可用，以及无项目入口的当前适用行为。复用Z有效覆盖，不机械重跑同组；旧性能用例不得再无选择地纳入功能检查，不新增或改性能测试。截图实看，完整日志及失败保留于D:/latex-writing-checks/review-efficiency-20261122/AA-*。
- [x] AA3 总控冻结后审全量相关diff、激活/命令/打包消费者及有效UI和局部证据，仅补具体未覆盖风险。Z与AA均明确通过后，原Terra预核下一无冲突版本、必要发行检查、一次构建、附注tag、正式Release及同一VSIX安装；总控只核交付元数据并集中结案，不自动重载/重启或包后冒烟。

租约、真实论文/用户窗口/默认pipe保护、无删除/无实网AI、UTF8及普通精确Git规则沿Z。总控现在仅修改plan/index支持增量，随后整体移交原Terra，支持docs随下个成功完整批集中提交；不为本计划另起微提交。

Z与AA最终审核通过，冻结27300a520e690288a1516143c88dd0293bd8ce8f，Z返修1、AA返修0。总控审Z-R1与AA共13文件真实diff、最新导航意图/ready队列、原命令实际注册与激活链、activitybar声明、旧panel保留及build/check资源闭包；复用Z-R1-check1五项和AA-check1七项exit0，原controller-z-latest-navigation首败由相同宿主seam回归证明已修，不重复同组。总控实看AA-ui2侧栏及底部目标、AA-ui-empty2空项目提示截图，核两组宿主/观察器/外层exit0及Default/前中后HWND1706472不变。真实UI中无关自动服务用桩，未逐项实操会访问个人资料/外网/AI的快捷项，仅核真实路由；AA-ui-empty观察器首败保留。无新增产品阻断；共同发行安装及总控元数据核验已完成，结果如下。

AA与Z共同完成，[0.9.71正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.71)并同一VSIX安装，构建输入fe682e464f562f5a5a02281243de40fd5bc9489a，scripts/build.py恰一次exit0。总控独立核本地/远端附注tag对象35f96bdfb2da5ea4d13f5c025a756d59b279ef2b、构建目标和注释双包摘要；controller-aa-release-meta.py实际读取Release API，正式非draft/prerelease、三附件digest与同一本地产物一致，manifest及source=vsix/pinned登记0.9.71，exit0。原始API/argv/cwd/exit及结果在D:/latex-writing-checks/review-efficiency-20261122/controller-aa-release*，实际构建/发行/安装日志AA-delivery-*。安装exit0伴Node DEP0169警告；未自动重载/重启，活动宿主加载状态未知，用户自行重载目标VSCode窗口后启用新侧栏与修复。真实论文/批注/资料未改，无删除或包后冒烟；Z返修1、AA返修0，无在途，三份支持记录集中结案。

## Z阶段：底部旧批注直接打开审核页

2026-11-25用户报告从底部“论文评论”列表点击以前剩余批注，提示“审核模式或批次已变化，请重新选择问题”；补充右键进入工作台后底部列表又可正常切换。当前基线32e991577524f7736506c9f8ae7f236ffb3e5906、master跟踪origin/master、开工clean，0.9.70已安装但未重载状态不推断。总控local/01a212c7-d736-7503-ab7a-9717a426fefb维护完整计划/索引及最终审核；复用唯一Terra local/01a21288-5815-7312-b496-006ade07bede连续诊断、实现、局部验证和execution，不新增代理。Z返修0。

目标是底部问题组、审核项及其剩余批注在审核页尚未打开或已关闭后可直接打开正确问题/项，无需先右键进入工作台；已有审核页继续准确定位。必须复现用户错误后再确定根因，优先复用现有openWorkbench/show和定位链，保持repo/owner/session/问题身份/项版本、脏草稿、暂留和批注数据保护，不以去掉过期校验或猜配解决。相关静态入口为inline_review.js的updateList、reviewQuestionDirectory与review_workbench.js的focusQuestion；现有inline_review.test.js问题目录测试先手动打开工作台，可能漏冷打开路径，尚不当作运行复现。

- [x] Z1 一个完整修复批：Terra按diagnose建立实际调用链的失败信号，核冷打开/关闭再开及现有页路径，修复入口初始化与必要调用方；在现有宿主/工作台测试增加真实模式的必要回归，集中运行受影响检查。按silent-ui-screenshot在专属profile/pipe及私有未切桌面的正常Development核底部真实点击与最终定位，复用已有准备，不操作用户窗口。保留首败、完整argv/cwd/env/stdout/stderr/exit及截图，不新加性能组或删除测试。
- [x] Z2 总控冻结后审真实diff、调用链和有效局部/UI证据，仅补会改变交付判断且未覆盖的具体缺口，失败交原Terra返修。真实论文/批注不动，不用右键绕过当作修复通过。
- [x] Z3 通过后沿原已授权流程由原Terra预核下一无冲突版本，必要发行检查、恰一次构建、附注tag/正式Release与同一VSIX安装；总控仅核元数据并集中结案。不自动重载/重启，不重做功能全组或包后冒烟。

总控先写本计划和索引，随后交Terra独占产品/测试/UI/隔离配置/execution/Git租约，停止重叠写测；功能批成功纳入支持docs集中普通commit/push/fetch，远端前移停止，不reset/rebase/merge/force/改remote。真实论文D:/Overleaf/TMI-DA-Marked-up Copy、P/个人资料、原批注/候选/三类草稿/范围外stage、用户窗口及默认pipe/MCP无写权；不迁移真稿、不清理文件/对象/截图、不实网AI、不全局安装或改技能。pwsh7、显式UTF8、Python -B -X utf8。证据沿用D:/latex-writing-checks/review-efficiency-20261122/Z-*；无在途。相关通用技能不引入本次缺陷无关的issue tracker或通用配置初始化，遵循全局最小完整修改。

Z1首次交包09b01b80c526bd5f4f200b3c8b005f4d7fdf6fde，Z-red2真实宿主命令复现原报错，根因是目录要求已有active；冷打开复用openWorkbench并在webview ready后定位。Z-check1相关两套97项、Z-check2定向3项exit0；Z-check1意外运行旧100项刷新性能用例，未新增/修改，不作性能结论，完整事实保留。Z-ui1真实点击底部旧批注直接打开第5项，宿主/观察器/外层exit0、前台HWND1706472保持；总控已看ui-2f8d4790f51840b0a2372fd8431a72de.png并核日志。Z2真实diff审查发现新增pendingQuestion未随后续显式show失效，独占controller-z-latest-navigation.py通过实际hostFixture复现：先冷点R1/1，在ready前显式open R2/2，ready仍投递R1/1定位，exit1。原完整证据controller-z-latest-navigation/{probe.js,run.json,stdout.log,stderr.log}；只动隔离夹具、无真稿/删除。Z返修1，须原Terra保留最新导航意图并补真实回归，不能以移除ready等待或身份校验解决；通过后再做AA并合并一次发行。

## Y阶段：正文单一来源与回复动态摘录

2026-11-25用户先要求只检查并制定方案，随后确认修订方案并明确授权“按这个方案开始修改，完成验证后按原流程发布并安装最新版，暂不重载或重启”。核心行为：回复解释与摘录各自独立；回复中的逐字摘录只保存正文稳定块引用，编译和审核显示时直接从对应正文取得内容，正文改变后无需AI重新复制、逐字核对或作者额外审批摘录。解释文字仍由作者审核，科学论断仍需依据。新授权取代最初“更新摘录候选再审批”的方案，不恢复全量上下文注入。

基线ededb5e0c0be2b20ba4c8dc0dd7e51757754ad44，master==origin/master、开工clean、0.9.69已正式安装；普通本机Windows仓库，不是Pi/Herdr或容器管理。总控local/01a20811-7c1e-7a50-908c-c59a658531a0独占完整计划/索引、最终审核及未重叠组合；唯一现任Terra local/01a21288-5815-7312-b496-006ade07bede负责实现、局部检查、execution和获派交付，预期gpt-6.1-terra/high。旧执行者01a208d4第五次后峰值300415自然触发接替，Y源码未写、无在途并释放租约；新角色自身及总控实核resolved/observed均Terra/high、match/continue，priority仅记录保持，沿原派单接管并在旧turn结束后归档旧聊天。Y返修0。分为下面五个完整功能终点，不按文件/小helper拆测试或提交；每批连续补齐调用方、必要说明与规定检查，再集中普通commit/push/fetch。

已查明：ai_context只自动包含pending/rework的反向依赖，已接收回复可漏出；stale仅在返修和拒绝链触发，save_block_source、sync_block和正文接收未完整覆盖；freshness未在审核卡/目录明确呈现。内存夹具执行实际selected_ids/ai_context，已接收依赖不返回、改为pending则返回；首轮夹具缺assert_ready桩exit1，补齐后exit0，不冒称真实现场复现。真实只读当时有15条已接收回复needs-recheck，不表示15条都错。旧P中的装配说明只有历史来源/旧范围，没有当前可执行摘录关系；question blocks的response_dependencies是修改项ID，不能代替持久正文块引用。begin会重置edits但保留blocks；导出当前先移除MARKER，动态引用必须在此前展开。早期只读检索若干猜测路径不存在及一次PowerShell引号错误均无写入，后按实际review_archive.py/review_pdf.py/source_review.py定位。

现任总控local/01a212c7-d736-7503-ab7a-9717a426fefb负责交付元数据与结案。旧总控01a20811在7次压缩后峰值301878自然触发接替，已停写且无在途；新总控真实resolved/observed均gpt-6.1-sol/high、match/continue，priority仅记录，明确交权并核旧turn结束后已归档旧聊天。唯一Terra不变，Y5已冻结交回全部租约；没有新代理或重复实现/测试/构建/安装。

### 行为与存储契约

工作稿中的回复摘录采用明确的正文文件/块身份及顺序引用，正文内容仍只在原文件维护；不搬正文进碎片库、不把生成缓存或旧候选当第二权威。运行所需最小TeX支持文件/引用信息属于正常论文源码，可随源Git和导出处理，不依赖.codex-review对象、SQLite、AI会话或插件进程。普通latexmk/编辑器编译必须可工作，不要求shell-escape或自动安装全局依赖；优先已有标准TeX/宏包能力，具体负责实现以真实独立编译验证决定，不先造副本缓存冒充单一来源。

正式稿/审核默认展示当前实际已保存正文，未接收候选不混入；作者保存的手改同样是当前源码。预览某一正文方案时，摘录必须读取同一临时预览版本，不能正文B而摘录A。重复引用共享同一来源；每处摘录的颜色/展示配置独立且不回写正文，保持现有作者约定。公式、宏、引文、图表、跨段组合须经真实编译与现有模板验证；避免重复引入label、counter、bib/宏定义等副作用，不声称单一来源自动解决回复解释中的事实、编号及科学含义。来源缺失、重复、路径异常或结构损坏时明确指出引用身份，不能退回旧摘录、猜配或静默输出空白。

关系保存在可随论文源码运行的最小信息及既有稳定块结构中，持久身份不依赖可重置的修改编号；候选精简、恢复和新批次不能丢有效引用。用户修改解释时不扩大到引用槽；正文改动只影响其引用的显示，不修改解释或自动接收其他候选。旧独立复制摘录支持精确来源预览及受保护转换，只有已核定映射才能改为引用；无可判映射保留原文并指出具体位置，不以同问题或相似文段自动绑定。插件升级本身不自动迁移真实论文。

### 批次、租约与验收

- [x] Y1 单源TeX与引用解析：实现工作稿引用及最小支持资源、精确正文块定位、多处/多块组合和错误可见；普通独立编译不依赖审核状态或插件存活，正文仍留原文件。Terra做本批解析/TeX边界与真实最小编译检查，保留公式/引用/颜色和特殊路径的当前必要覆盖，不开展性能组或科学内容改写。
- [x] Y2 受控写入与按需AI：接入现有host/writer/CAS保护，提供AI可用的查询/建立/更新引用及旧复制摘录精确预览转换入口，不新增逐块审批；解释候选与引用槽分离。read_context按实际正文/问题/范围返回受影响引用的简短身份和状态，含已接收回复，细节按需读；批注附件仍只含明确所选request。保留人工编辑、旧批注、候选版本、三类草稿及范围外stage，不把资料读取等同授权。Terra做实际MCP/写入协议及失败保护的小验收。
- [x] Y3 审核显示与预览：段落/问题两模式显示解析后的真实摘录及来源，解释编辑不覆盖引用槽；单项/批量接收、方案切换、后台源编辑及刷新读取同一源版本。正文接收不要求额外批准纯摘录展开，解释仍是独立作者决定。只对概括性陈述等仍需人工/AI理解的关系显示需核对，不把动态逐字摘录继续当待办。Terra在私有未切桌面、独立profile/pipe的正常Development验证真实交互，核Default前台不变；具体截图/失败按silent-ui-screenshot保留。
- [x] Y4 导出及生命周期完整链：投稿副本先从同一源版本展开所有动态引用，再移除插件定位符/不再需要的引用支持；导出普通源码可独立编译，工作稿不变。Git/备份/PDF/恢复/新批次与历史精简的受影响消费者接通，引用无需保留已完成批注或候选对象。Terra验这些负责边界和当前必要回归，禁止运行cleanup apply或删除文件的完整组。完成后一次冻结交包；总控审全部真实diff并仅补未重叠组合：同一隔离论文两个回复引用正文，在候选精简/新批次后换进程脱离profile及插件，实际编译与展开导出仍同源、解释不变，核正式与预览版本边界及必要失败语义，复用Terra局部/UI有效结果。
- [x] Y5 审核通过后正式同包交付：原Terra预核下一版本无冲突，必要版本/MCP/发行与运行资源闭包检查，scripts/build.py恰一次构建，真实构建commit的附注tag及双包摘要、正式Release三个API digest、同一VSIX CLI安装登记。总控仅核交付元数据，执行尾与plan/index集中结案；不新增包后冒烟、额外全仓审计或重跑功能全组，不重载或重启任何用户窗口/MCP。

总控先写本计划/索引支持增量，随后整体移交产品/测试/UI/隔离配置/Git租约给原Terra并停止并行写测；每批成功纳入支持docs，不为小检查另起提交循环。Terra完成Y1–Y4后冻结交回全租约，总控最终通过才另派Y5；共享候选检查一个执行者，范围变化/真实首败/未知保留，必要返修原Terra处理，不新增代理。真实论文D:/Overleaf/TMI-DA-Marked-up Copy、真实P/个人习惯、state/批注/候选/草稿/stage、用户窗口和默认pipe/MCP均无本轮写入租约，授权是插件实现和隔离验证，不顺带迁移真稿；若必须核旧资料，只限必要只读。无全局SKILL/配置改写、外发真稿、文件/目录/截图/对象删除或cleanup执行。pwsh7、显式UTF8、Python -B -X utf8；只用local bare验证Git，普通精确stage/commit/push/fetch，远端前移停止，不reset/rebase/merge/force或改remote。

Y1–Y4总控最终审核通过，冻结1ccfe352621bea0fdac69c3560cd4021d05773b8，返修0。总控审22文件真实diff、TeX直接读取/唯一边界与解释引用槽保护、host资源创建与源/state检查、按需上下文、预览快照、导出先展开后移标记及备份资源链；实看段落/问题两截图。复用Y-final-check1 Python8/JS95、Y4-final1两项及Y1/Y2有效局部覆盖，不重复同组。Y3-ui6外层空桌面枚举exit1保留，不签完整通过；Y3-ui5真实私有桌面全链exit0有效，后台改源/批接的完整UI组合未实操，不冒充全覆盖。总控独占controller-y-combination1.py exit0：隔离FakeHost仅用于准备，真实本地bare提交推送后compact去候选引用、新批次清edits；两个回复同源选择B，独立复制只有main/reply/sty、无profile/审核缓存，另起真实latexmk进程编译并读PDF，两摘录一致且解释不变；手动保存正文后两处同步，导出展开后再次独立编译一致，缺源真实编译非零并显示块ID。17条真实子进程argv/cwd/env说明/stdout/stderr/exit和result在D:/latex-writing-checks/review-efficiency-20261122/controller-y-combination1；源码未改、没有文件删除。总控最初按平铺日志名检索失败，随后确认Y证据是同名目录下run.json/stdout/stderr，不丢原事实。Y5按已授权正式发布安装继续，不重载或重启用户环境。

Y阶段完成，返修0。[0.9.70正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.70)并同包安装，唯一构建输入f4e16532bdf751fffd49529227f0b6044138d331。总控独立核本地/远端附注tag对象c557c335e978a5e8ab1644cf89634975472e6c96及目标、SOURCE-COMMIT/双包摘要；controller-y-release-meta.py实读Release API，三附件digest与本地产物一致，实际manifest及source=vsix/pinned登记为0.9.70，exit0。原始API/进程/结果在D:/latex-writing-checks/review-efficiency-20261122/controller-y-release*，构建/安装完整原日志在Y-delivery-*；安装exit0伴Node DEP0169警告，未隐去。未自动重载/重启，活动宿主加载状态未知；真实旧复制摘录未迁移，需明确来源映射后受保护转换。执行尾、计划和索引集中收尾，无在途；未重构建/重装/包后冒烟、删除或操作真实论文。

## X阶段：固定块预览后自动继续

2026-11-25用户明确要求开始修改：普通已授权写作不应在每次调用prepare_block后再要求作者确认具体边界。基线23b3f67ff0acaf71547f5309c4f071823ce418df、master跟踪origin/master、开工clean，已交付0.9.68。原总控与唯一Terra身份保持；X返修0。此次为一个完整小功能批次，集中完成实现、受影响检查与提交，不沿用旧段落中按文件数或小步骤拆批的要求。

- [x] X1 Terra统一prepare_block工具说明、实际传给AI的写作指南及受影响用户说明：已获授权且位置明确时，AI自行预览、检查合法边界，再用返回block_id和未变源/state版本继续，无需逐块询问；边界不明确时向作者问最小具体位置。建立标记不等于接收候选。保留旧项目迁移、缺失/错位标记修复与重新关联的原确认要求；不新增确认字段、自动重试或定位猜测，不削弱宿主唯一性、writer锁、脏缓冲、精确版本及TeX边界保护。
- [x] X2 Terra核真实MCP工具描述和指南消费者，复用已有prepare_block预览→apply用例，定向验证明确位置无需额外人工确认参数即可走现有受控写入，缺少preview block_id、源/state变化和非法边界仍拒绝；只补当前受影响且尚未有效覆盖的必要检查，不写镜像文案测试、不做UI/性能/完整备份或删除组。总控冻结后审实际diff、描述与指南一致性及必要调用链，复用局部证据，不重跑同场景。
- [x] X3 总控通过后Terra按已有发行安装授权预核下一无冲突版本，必要版本/MCP/发行工具检查，scripts/build.py一次构建，附注tag及正式Release，同一VSIX安装；不重载或重启用户窗口/MCP、不包后冒烟。总控只核交付元数据及完成状态。支持plan/index/execution随实际功能或交付批集中同步，不另造元数据提交循环。

总控先维护本计划与索引增量，随后将全部产品/测试/隔离配置/Git租约给原Terra；Terra实现并冻结交回后总控才审核。真实论文、P/个人资料、候选、批注、草稿、范围外暂存和全局技能均不改，不调用真实默认pipe/MCP，不清理任何文件/对象。当前任务只改插件政策与必要说明；不能借此去掉旧迁移或修复确认。普通精确stage/commit/push/fetch，远端前移停止，不reset/rebase/merge/force或改变remote；保留真实失败/未知/未测和完整原日志。有效现行全局AGENTS优先于历史批次描述。

X1/X2总控最终审核通过，冻结b9ee4b76ba7a140ff78c3c476f590e6548a12ff3，返修0。实际运行改动仅工具描述与指南/README，后端安全逻辑未变；tools/list直接暴露TOOLS描述，MCP规则模块与写作入口读取同一writing-guide.md且构建清单已含。总控审真实diff、原prepare_block及MCP写边界、保留的reassociate/迁移确认，复用X-checks2真实三项exit0及完整stderr，不重复测试或新增UI。缺预览ID、源/state实际变化和非法边界拒绝，合法预览可直接应用；未测实网AI的提示遵循。总控只读检索曾带两个不存在的猜测JS路径报错，随后按实际src/writing.js和mcp_server.py补核；无业务写入或测试失败。X3按原授权继续，交付输入与结果随后记录。

X阶段完成，返修0。[0.9.69正式发布](https://github.com/zlinkw/texscholar/releases/tag/v0.9.69)并同包安装，唯一构建输入65f13c63a01c57ebae66bba5c73e7cdef2c35475。总控核本地/远端附注tag对象130bb46b3f535b142bd626976d8682fa060c0634及构建目标、SOURCE-COMMIT/双包摘要；controller-x-release-meta.py实读Release API、比较三附件digest与本地产物、核实际manifest和source=vsix/pinned登记0.9.69，exit0，完整原始结果在D:/latex-writing-checks/review-efficiency-20261122/controller-x-release*。必要版本/MCP/发行检查均通过，无发行安装失败。未操作真实论文/资料/用户窗口，未自动重载或重启、删除或包后冒烟；未测实网AI提示遵循。用户需重载目标VSCode窗口、重新连接现有MCP服务，才会加载新版说明；安装登记不等于活动宿主已更新。执行尾与本计划/索引集中交付收尾，全租约已交回，无在途。

## 目标与授权

2026-11-24用户要求“自行检查新的问题模式相比原来的段落模式还有什么问题存在，进一步优化”。按原两角色流程连续完成范围内检查、修复、验证及既有同包交付，不只交缺陷清单，不要求用户逐项批准常规修法。问题模式以审稿问题组织正文/回复关联卡，段落模式保留单项深度审核；对照已有操作能否准确完成、必要信息能否取得，合理的明确跳转也可保留，不机械复制全部控件或另建审核平台。

普通Windows D:/GitRepo/texscholar，master跟踪origin/master，初始HEAD均e006a30361c667708b3c5fe3e88ed6d3f7b11ee3、clean，已正式安装0.9.62，当前活动宿主是否重载未知。总控local/01a20811-7c1e-7a50-908c-c59a658531a0维护完整plan/index、审核及独占最终组合；唯一Terra local/01a208d4-2ab9-7a93-9994-56e2c5dfc6c7负责整份检查/实现/小验收/execution/获派交付。新代M返修0；不因新代新增代理或替换未触发caveman的角色。

## 完整对照范围与判断

Terra先在唯一execution中建立下表入口母集，按真实实现/现有测试和必要复现记录每项“正常、合理模式差异、已修缺陷、实际阻塞/未验证”，给出精确入口和证据。只修当前可达缺口，不把每个缺失按钮都认定新功能需求，不扩成全仓审计。

| 范围 | 需对照的操作和数据契约 |
| --- | --- |
| 问题与项导航 | 问题身份id/file/quote，同名问题、无关联项、未绑定项、正文/回复分组、目录搜索/筛选、前后项与返回、当前项与当前问题一致性 |
| 正文与方案阅读 | 原文和ABC、完整/变更片段、合法TeX/公式/颜色、插入删除位置、差异高亮及前后差异定位、两方案对照/展开的可达路径 |
| 审核决策信息 | 推荐/排序与一句取舍、详细依据、事实变化（数字/引用/符号/术语）、范围提示、候选迁移意图、原始审稿问题与问题核对状态 |
| 批注全链 | 原文/候选/问题/中文的精确划词及片段偏移、整项/方案要求、批注输入位置与明确绑定、保存/编辑/取消/定位、旧版本/上一轮/暂留与返修说明、所选/全部交接及失败重试 |
| 编辑与草稿 | 编辑候选/原文可达、预览/保存不接收/保存并接收；三类未保存稿与用途在换模式/换问题/换项/隐藏重开后的保护，源与候选变化的失效提示，不暗保存或覆盖 |
| 单项与批量决定 | 正确方案的预览/接收/拒绝、暂缓与恢复、当前问题/全部已选的范围差别、筛选下隐含选择、跨问题共享项只处理一次、过期/冲突/暂缓/草稿的禁止条件与可见原因 |
| 翻译及异步 | 复用0.9.62已验的自动/手动、单卡/片段/全文、收起、缓存、失败、迟到和批注身份；本代共享渲染/路由变化仅补受影响消费者，不重新实网翻译真稿 |
| 状态、反馈与可用性 | 全局动作在问题模式的真实目标、PDF/源定位及状态/错误可见、忙态与取消、刷新/选择/滚动/键盘焦点、窄窗口及按钮可辨识，配置/资料入口保持 |

总控初步静态线索（未作为运行缺陷签认）：问题卡原文/候选pre没有段落区的data-side/option选区绑定；仅中文新增了跨卡选区协议。问题卡不展示段落区summary/reason/fact_changes/fulfillment内容，批注按钮经questionCard精确切项后转段落，须核是否使用户失去所选范围/问题位置。暂缓项显示标签及禁选，但是否有清楚恢复路径待核；全局差异导航/源定位/预览是否仍围绕隐藏当前项而非用户所见卡待核。renderQuestionMode重建DOM时输入、选区、译文及阅读位置保护需以实际动作判断。原Q翻译正常Development与回归证据可复用，不能把这些线索直接夸成全部已复现。

## 实施边界与保护

优先复用现有questionRows/directory、精确cardAction握手、单份composer、math模型和writer/版本契约，在负责边界接通信息/动作/选择。新增UI只服务已确认的审核缺口，沿现有视觉与设置；不新增通用框架、配置开关、模式或依赖，不改变作者接收/批注/科学问题核对的含义。共享项、方案、源/译文选区须精确绑定session/item/version/question，禁止通过自动换绑、静默降级为整项或放松CAS消除失败。前端可见性不能替代后端写入校验；合理跳转须告知真实目标并保留输入和返回路径。

真实论文D:/Overleaf/TMI-DA-Marked-up Copy及P、全部26原批注/561引用对象/候选/稿件/模板/范围外暂存受保护，本轮不读写其窗口/源/状态或默认pipe；不进行新迁移、真实论文接收/Git/PDF/编译。已知旧桌面MCP0.9.60拒绝只保留上次观察，不探测、不CLI绕过/杀进程/改全局配置，不用其解释未证实问题模式错误。不得自动重载/重启任何用户窗口、MCP或服务。无文件/目录/对象/截图删除或cleanup，旧首败/未知及误触默认pipe拒绝、隔离对象误删事故记录保留不重放。只用本地新隔离项目/私有profile及专属pipe，不外发真实稿件或调用实网AI。

## 连续阶段、验收与交付

- [x] M1 Terra完成上述母集的真实入口对照；对发现的当前缺陷建立最小运行失败信号，按负责模块归并。execution记录全量对照和实际缺陷，不另造平行报告。作者语义/权限的真正不可替代决定才升级，其他常规修法直接连续实施。
- [x] M2 Terra按每批2至3个强相关问题、最多8源码/测试/文档文件完成所有已确认范围内修复，必要测试与文案同批。优先扩现有测试，局部功能/路由与保护小验收由Terra；正常Development UI使用独立profile/专属pipe、CreateDesktopW私有未切桌面，核不在Default及前台/输入桌面，截图TEMP/CodexUiCaptures实看保留。翻译合成供应商，不称实网质量；不新增性能测试/阈值，不自动变更既有测试超时/覆盖。build-test-delivery按变更闭包复用有效Q/N/P证据，未执行不称通过。
- [x] M3 Terra完成整份实施与小验收后一次完整冻结交包并交回租约。总控审真实diff、全部母集结论及原日志/失败，只补未重叠跨模块/跨模式最终组合；任何必修一次交原Terra，不总控实现自签。必要最终组合重点为带草稿和批注的跨卡/跨问题路由、差异/取舍/决定信息与真实目标一致、共享项/批选和历史批注保护；具体以实际缺陷及既有局部覆盖定界，不重跑相同清单。
- [x] M4 最终通过后由原Terra按明确派单做必要版本/MCP/发行检查、唯一构建、正式tag/Release及同VSIX安装；总控只核元数据结案。沿既有用户项目发布安装授权，不在最终批准前build/install/publish，不自动reload/restart或包后冒烟。

总控先独占plan/index文档批，完成普通同步后给Terra整份产品/测试/UI/隔离配置/Git租约；租约期间不并行写计划。成功内聚批精确stage/commit/普通push origin master/fetch核一致，远端前移等停相关动作，不reset/rebase/merge/force/改remote或绕hook。UTF8、pwsh7、Python -B -X utf8；新证据根建议D:/latex-writing-checks/question-mode-parity-20261124，完整argv/cwd/相关环境/stdout/stderr/真实exit及首败保留，复用现有runner。无在途才冻结移交，阶段消息按全局事件协调：整包、必要决定/实质阻断才唤醒，不普通回执/重复等待。总控无独立待办时角色空闲，任务由必要消息续接。

## 总控最终组合与 M-R1

2026-11-24 Terra完整冻结交包，源码4c58acb7、记录3af28a78均普通同步clean，全部产品/测试/UI/隔离配置/Git租约交回；完整8类入口母集与各局部有效证据见execution。总控已审5文件完整diff和受影响调用链，复用M 92/46项、各真实Development局部及Q既有有效覆盖，未重跑相同组。

总控外置M-controller1正常私有Development首先因Electron不支持Browser.getWindowForTarget而观察器/外层exit1（host0），未进入窄窗判断；首败原日志保留。新qparity-controller2改为在已核私有桌面唯一自有Development HWND上SetWindowPos(NOMOVE|NOZORDER|NOACTIVATE)，实际审核iframe295px。M-controller2宿主/观察器/外层exit0，真实方向键切换全文、Tab到变化筛选、跨卡1/A的[0,9)选区及未保存批注经真实host refresh后目标/版本/源/范围/全文和scrollY、composer top精确保留。Default输入桌面及前中后HWND25630512不变，宿主正常退出、私有桌面关闭。argv/cwd/相关环境/stdout/stderr/退出、done/layout/refresh/run-result在D:/latex-writing-checks/review-efficiency-20261122/M-controller*及qparity-controller*；非完整环境快照。

自动布局断言只核页面无横向溢出，不能证明可用：总控实看截图C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-bc8d895e3f804ac58ada62e88c1f5bee.png，确认问题模式ABC在295px仍强制三列，批注composer嵌于窄方案列，英文逐字断开、保存按钮文案被裁。此为真实可达产品缺陷，M返修1，M3暂不通过，不发行。原M-access两次787px前提失败及本轮首败保留，不能称窄窗已通过。

M-R1由原Terra做最小响应式布局修复：在受影响窄窗口让问题卡ABC和批注输入/保存动作可读可操作，复用已有媒体查询/布局，不新增配置、框架或依赖；保留宽窗ABC对照、精确跨卡选区与所有草稿/翻译/决定保护。以新隔离正常Development真实窄iframe核内容/控件边界并实看截图，实际键盘到保存并精确读回跨卡批注；补受影响已有最小正确性回归，复用此前刷新/翻译等未变链。一次冻结交包后总控仅审返修diff及必要未覆盖部分，再M4交付；真实论文/P/用户窗口/默认pipe及删除禁令不变。

M-R1最终通过：027ac726源码只在现有max-width:600px查询中将.questionOptions设单列，总控已审完整两文件diff、M-r2-ui/done及精确持久化读回，实看窄窗ui-60c3f581503944c99623370269414890.png：文本、用途、保存/取消均清楚可用；同一宿主1035px恢复三列。真实键盘保存跨卡1/A [0,9)和46项workbench均0，复用总控刷新及之前未变覆盖。无额外产品返修，M返修1；M1-M3完成。完整键盘支持只声明已测方向/Tab/保存路径，不夸为全部快捷键；实网翻译质量未测。

M4现授权原Terra按既有流程预核0.9.63无本地/远端tag、Release或输出冲突后，必要版本/MCP/运行依赖闭包/发行工具检查；复用最终有效功能覆盖，唯一scripts/build.py构建双包及SHA256SUMS，附注tag指向实际构建输入并含双摘要，普通推送、正式Release三附件API摘要核对、同一VSIX实际CLI安装并核manifest/登记。发布安装已获原项目流程授权，不重复询问，不自动重载/重启或包后冒烟，不接触真实论文/P/用户窗口或任何删除。若版本确冲突则按真实事实停该操作交总控，不盲覆盖或重构建。交包后总控只核元数据结案。

## 最终交付

M全阶段完成，返修1。0.9.63正式Release https://github.com/zlinkw/texscholar/releases/tag/v0.9.63 已发布，同一VSIX CLI安装exit0；版本/隔离MCP/依赖闭包/发行工具必要检查通过，仅构建一次。构建输入77cf48704e85f1e750443498ce596e1bc9b7f25b，执行尾2b7bd320均普通同步；附注tag对象792c122b3d668d9da4b9bfb105239da72f04be92指向构建输入，SOURCE-COMMIT及双包摘要准确。

总控以远端ls-remote核tag对象和目标，controller-final-meta.py实读Release API确认非draft/非prerelease、三附件digest与本地同包一致：VSIX 7153c48e18a40fc71ed2fc843f37e08138b69758d239cbdef580c104d3a83645，source.zip 1da3fab8244c1ed14cc4346f6f6e08df37b6dfd7fe8222ae972b9153c41014f5，SHA256SUMS c7f4b0e28b649c66a30b6b5f7ea7cceccbe74800870b3a65ca5af6ed349c4d0c；本机manifest和extensions登记publisher/name/version精确0.9.63、source=vsix/pinned=true。元数据脚本exit0，原API stdout/stderr/process在D:/latex-writing-checks/question-mode-parity-20261124/controller-final-release.*，未重构建或包后冒烟。

本轮新增优化为跨卡原文/方案/问题划词与精确片段范围、保存并切换的批注目标、跨模式草稿可见、推荐取舍/事实依据/范围、段落深审明确入口、暂缓/冲突/未保存稿接收限制及窄窗纵向ABC。现有差异导航、方案对照、历史和恢复经明确打开本项保留。有效覆盖按前述组合复用，所有首败/未测及旧保护事件保留；未测实网翻译质量或所有快捷键。真实论文/P/旧批注/用户窗口未触，未自动reload/restart；安装不代表活动宿主加载，用户重载对应VSCode窗口后启用。桌面MCP旧拒绝仅历史事实，本轮现状未知且未操作。唯一Terra冻结交回全部租约，无在途。

## S阶段：问题模式延迟、事务收尾与接收后导航

2026-11-24用户报告问题模式翻译与批量接收特别慢，6项接收等待约3分钟；随后提出可能是未自动切到下个问题。用户明确选择单人、每次约6项、批接5秒内作为性能验证范围和目标；不扩大压测/并发/数据量或擅定翻译服务SLA。当前源码/正式安装0.9.63，起点master==origin/master==9584fac00fa0114c6358de1eb26adbb93b0439d5、clean。继续原总控与唯一Terra，S返修0。

总控已按diagnose读取现有日志及自动CPU采样，无新性能测试或现场操作。真实13:42宿主日志记录68项，cards正常约0.24至1.05秒、刷新约0.28至1.32秒；一次webview_request到宿主延迟58647ms，不能归为后端事务时间。三份VSCode自动无响应采样重复指向inline_review.js的reviewLocation/lines：每次questionRows为各关联项拆分整份正文、前后行、标记和章节；问题翻译及批接前都反复调用questionTable。翻译另有questionTranslationRun串行及片段重算，须按真实调用链定位，不凭猜测并发或缩短网络超时。备份失败提示为未归属本地提交/远端推进保护，scheduleBackup不等待其完成；不得因截图提示删除该保护、推送论文或假称它造成同步等待。

用户随后截图明确报错：审核宿主事务失败；请核对是否存在待恢复意图：编辑器保存失败；请核对尚未完成的编辑事务。对应review_host_edit.js的doc.save()返回false，不能因磁盘已是目标版本而跳过保存/脏稿/真实宿主校验。第二截图C:/Users/ZLK/AppData/Local/Temp/codex-clipboard-4098bfc6-b060-4230-a1cb-7c4786bbbc7d.png。

现场重要事实：只读稳定读取唯一真稿sidecar发现transaction尚在，commit=f2d0537322d016a432837f39fe5174cc634aceefbf1952cd7aa3452a0bdf57df；files仅Response to Reviewers.tex，checks仅main.tex，owner=false。六项du/eh/es/et/eu/ev均暂标accepted/A；逐字对比不可变事务对象确认Response已经与0-new完整相等、与old不同，main与check-0相等，读取前后state字节一致。事务未清不能当完整成功；不重放接收、不直接清事务/改状态、不覆盖正文。该读取不证明活TextDocument/Webview草稿或迟到写安全。现场仅总控后续按真实合格宿主的既有显式恢复协议协调；Terra无真实写入/默认pipe/恢复权限。所有真稿、模板、旧批注、候选、三稿及范围外暂存继续保护。

原始现场日志/三份cpuprofile及汇总在D:/latex-writing-checks/question-mode-latency-20261124。live-state-snapshot.json及live-intent-snapshot.json含真实内容，只供本地受保护对照，不上传或纳入源码/发行。live-transaction-check.json保存精确结果。用户截图C:/Users/ZLK/AppData/Local/Temp/codex-clipboard-519d2ba8-d52e-4968-a330-86863613898a.png。总控一次进程快照仅见翻译子进程、未见source_review，不能由此猜事务失败原因或杀任何进程。

- [x] S1 Terra在既有边界消除重复全源扫描/片段重算和阻塞，保留问题身份、位置跨越/检查过期、Unicode/TeX、全文/片段、全部批注/草稿及版本/CAS。优先按同一不可变源/版本复用现有结果；真实输入变化必须失效，不增加无关通用缓存或新配置。按三种可证伪原因区分：宿主同步扫描、网络串行/重复请求、事务宿主写入与收尾；现有CPU证据优先。修复当前调用链，补可见等待阶段/实际错误，不能用超时提前返回成功或后台暗接收。
- [x] S2 核清接收的源写入成功而事务未收尾的路径并以隔离真实宿主复现必要边界；补有用的完成/恢复反馈，禁止放宽宿主、脏稿、并发或writer保护。接收成功后若当前问题已无可审核项，准确进入下一有可审核项的问题；若仍有未选项则保留当前问题。没有下一问题、暂缓/冲突/筛选或历史项时给准确结果及可达入口，不把接收当科学问题解决或自动勾问题核对。跨问题共享项不重复处理，全部已选与当前问题已选的范围保持。
- [x] S3 按用户确认只验证单人6项批接，正常Development专属pipe/profile、私有未切桌面；合成文本使用接近现场的68个活动项、已有246总记录/长正文及问题关系作为真实规模上界依据，读写隔离项目，禁止使用真实项目操作或上传真稿。已有用户确认覆盖6项/5秒，可测端到端点击至持久化/界面完成；翻译用确定性慢/失败供应商分离网络时间与队列/界面等待，不增加服务SLA或实网真稿翻译。已有功能组按受影响闭包恢复，保留接收原子性、未完成恢复、跨问题/版本/草稿/批注和消息迟到检查；不改既有测试覆盖/超时。Terra做局部，冻结整包后总控审真实diff，仅补未重叠最终组合。
- [x] S4 修复及必要验证通过后沿已授权原流程唯一构建、正式发布/同包安装最新版；必要现场事务恢复由总控先核真实现场，不能把隔离通过当真稿已恢复。自动重载/重启用户窗口/MCP仍无授权，不以清事务或重启绕过；不能安全完成时交具体最小阻塞。无删除cleanup、论文Git/PDF/编译/新批次。普通提交/推送/fetch，不改历史/远端；支持计划与执行记录随对应功能批集中提交，不另拆每条元数据检查的commit/push。

当前总控只写此计划增量及索引，不独立提交；交Terra后同首个验证通过功能批精确纳入，所有源/测试/UI/隔离配置/Git租约给原Terra，plan/index实现期间不并行写。无在途才冻结交回。小验收与最终组合复用有效结果，不重建历史证明链作为目标。必要真实安全阻断及时交包，其余局部过程只记execution。

S首包2b908aa（源码c131f6a/c18adb9/0c54cdd/a586b42/2b908aa）已冻结、全部租约交回，总控已审全部真实源码/测试/README diff。定位按当前源快照复用、片段差异复用、两模式说明移除、接收后导航、保存失败不报成功及跨卡重复接收拦截方向正确；S-speed9在246总/68活动、长合成正文下六项点击至完成546ms，host/observer/外层0，复用其读回及保护证据，不重测同场景。真实保存false具体原因仍未证明，不能把隔离注入当已修真实拒绝；真稿待恢复事务未动。所有S-speed4中断/其余前台及夹具失败继续保留。

S返修1：翻译仍串行questionTranslationRun，慢请求可让后卡排队，尚未覆盖当前用户完整目标。用户随后明确要求把待译内容合并整段发送，用编号拆回。实施当前可见、已授权且无未保存稿的文本批量合并翻译；用独立唯一编号和精确映射恢复每段，核编号完整/唯一、来源/版本/问题/方案/范围及数学保护，错误不可按返回顺序猜配或写入成功缓存。保留每卡手动/自动、重试/收起、成功内容复用与旧批注身份，过期视图/来源结果丢弃；只走本来选定的翻译供应商，不外发真稿或改用AI。复用现有translate_many/Provider与客户端可见项协议，减少实际调用和无关旧队列阻塞，不新增通用调度框架/配置或猜测服务容量。以确定性慢供应商/错编号/429等最小正确性用例核真实接口及批注映射；无需新服务秒数SLA。当前已测六项批接/保存拒绝链有效复用。README仍有每方案显示句数范围的旧承诺，应随同用户要求去掉该陈旧说明。

新增用户精简要求及批量方向均纳入本S：仅去掉AI理由/取舍/事实变化/范围解释，保留作者原文对照、批注、动作与错误；不删除历史数据。批量定位/源读取/写入/刷新共享为优先方向，现有单次decide-batch/persist保留。当前补充计划不单独提交，由原Terra与本次相应功能批集中纳入；最终所有S目标通过才发布同包安装。

S最终功能审核通过，返修1。基线f432a4b43843dceeef863ace11a7fc372460ada4，后端3ee13deb及客户端f432a4b完整diff/测试已审，编号合批、TeX归属、缺/重号拒绝、纯公式本地、429可见、自动/手动及过期视图隔离符合本轮要求；复用S-r1-translate-test2、workbench-test6/7和真实私有Development S-r1-ui4（13个可见段一次合成供应商请求、分卡译文及item1/A精确批注），总控实看ui-d34e45836e1840489315ec1b041b09c2.png。最后JS修改仅区分自动/手动在途键，test7覆盖；未重跑未变UI或六项批接。原S-speed9六项546ms、savefail3等必要有效结果复用；只代表该隔离规模，不承诺实网翻译速度或所有编辑器保存失败原因已明。

总控补做未重叠实际服务兼容：controller-bing-batch1.py采用当前设置Bing和现有代理规则，仅发送3段合成问题/原文/方案，单次合批实际返回正确中文，编号与$x$/$z$归属还原准确、errors为空、exit0；未发送真实论文或调用AI。request/response/result在D:/latex-writing-checks/question-mode-latency-20261124/controller-bing1.*，不是翻译质量或服务SLA验收。其他服务编号保留未实测，改号时按已核协议明确失败而非猜配。

真实原事务已完成：总控controller-recover-once.py经安装0.9.63的真实HostSession及writer/CAS/资格/脏稿/内容版本保护，对固定f2d053...事务显式recover，exit0，transaction=null；整个状态恰为原状态移除transaction，其余批注/候选/决定/counter等字段相等，Response/main字节、真实Git index及HEAD均不变。证据recover1.*在同根。没有重放接收、直接清事务、FakeHost、重载或重启。前文待恢复记录为当时事实，现已关闭；原doc.save false具体拒绝原因未知，未冒称根因修复。

S4现交原Terra做必要版本/发行检查，实际预核下一版0.9.64无冲突后，既有scripts/build.py恰一次构建，源版本commit/tag双摘要、正式Release三附件及同VSIX安装，禁止自动reload/restart或包后冒烟。此次计划/索引支持更新随版本功能批集中提交，不独立metadata提交；发行安装事实的execution尾先写后冻结，最终由总控实核元数据后与plan/index结案集中提交一次，不每个检查另起commit/push。无真实论文/P/窗口动作、默认pipe探测或删除；如版本/远端/权限冲突按具体事实停相关动作。

S全阶段完成，返修1。0.9.64已正式发布并同包安装，唯一构建输入ba62764f843c0fef91343c0a09ade8bb5ac20488；总控实核远端附注tag对象100e0cee71dfd9c20e679c2c8778bd162b833188及目标一致。controller-release-meta.py实际读取Release API，确认非draft/非prerelease、三附件digest与本地包逐项一致：VSIX db12dc9566f971b1a856b26a2f1edfb52ab71aed5ec1891846db1940ea1c0122，source.zip b5950b4527993d2869cb7cb62ae47a8897f3584bc6e85ce19dd904594aa4bd52，SHA256SUMS 3cc583bc27d6e56f4cd03bfd55b5d52286631b8c6e10cfbd3ed5fb18193e8681；本机manifest/登记为local-research.latex-writing-tools 0.9.64、source=vsix/pinned=true，脚本exit0。原API与process/result在D:/latex-writing-checks/question-mode-latency-20261124/controller-release*。

本轮交付包含同源扫描复用、六项批接提速、可见文本编号合批翻译、接收后下一可审核问题导航、失败防重复及AI说明精简；真实原事务已按上文保护完成收尾。六项546ms仅为已核隔离规模，实际网络耗时、其他供应商编号兼容及原保存false原因仍按上述限制披露。全部首败保留，无重复构建、包后冒烟、自动重载/重启或删除；安装不证明活动窗口加载，需用户重载目标VSCode窗口启用。Terra冻结交回全部租约，无在途；发行执行尾与本次plan/index结案集中提交。

## T阶段：评论列表定位失败

2026-11-24用户报告“论文评论定位失败：Cannot resolve tree item for element 1/[真实root,.codex-review/state.json,e74dbc117a5f4cf4991bfb17187ca9c9,eq] from extension local-research.latex-writing-tools”。当前master==origin/master==4b9dc9cd596277a0c58c6a769187d77141bd89d5、clean，正式安装0.9.64。此错误来自VSCode评论目录TreeView.reveal，不能当成论文正文锚丢失或批注损坏，现场具体触发仍须复现。沿用原总控及唯一Terra，T返修0，目标是消除刷新/切项时可达的节点解析失败并保留准确列表选中和审核页路由，按既有授权验证后发布安装。

静态入口：inline_review.js updateList每次重建TreeItem/parent对象后fire全树，再异步selectReviewItem；现有串行队列合并目标但未固定节点生命周期。需分别用真实调用反馈区分刷新导致旧对象失效、进行中reveal与树重建交叠、当前项已移除/换session、父节点尚未注册等原因。禁止仅吞reveal错误、延时猜等待、无限重试或关闭目录跟随；优先复用稳定身份和现有刷新边界。真实存在的错误与未知保留，不新增无关框架/配置/依赖或性能测试。

- [x] T1 原Terra在现有inline host夹具及正常隔离Development复现原错误，定位负责边界，最小修复；已有队列/选择/评论子节点与父节点、同卡刷新、快速切项、项移除及session变化按受影响调用链验证，真实不存在的项不得选错对象。保留审核页草稿、选区/版本、作者批注及既有决定语义。完整日志与首败保留，UI使用独立profile/专属pipe和CreateDesktopW私有未切桌面，不在Default，不抢焦；无真稿、默认pipe/MCP、用户窗口、删除或重载动作。原定位/翻译/批接功能按未变输入复用，不重跑全部功能组。
- [x] T2 整包冻结交回后，总控审真实diff/复现及必要受影响链，只补未覆盖且能影响交付的组合；完整返修交原Terra。总控不实现自签、不重复同清单。
- [x] T3 最终通过后另派原Terra必要版本/发行检查、唯一构建、正式Release/附注tag及同VSIX安装；预核下一版0.9.65实际无冲突才用。总控核必要元数据，execution尾与plan/index集中收尾。仍不自动重载/重启，不包后冒烟或删除。

本增量与索引先由总控写入但不独立提交，交原Terra随首个验证通过功能批纳入。授权产品/测试/UI/隔离配置/Git租约给原Terra，实施期间总控不并行写计划或测试；无在途才交回。普通精确stage/commit/push origin master/fetch，远端前移或权限拒绝停相关动作，不改历史/remote。真实论文及所有批注/候选/稿件/模板/范围外stage保持，旧原事务恢复事实不重放。

T最终功能审核通过，返修0，基线5121cc450e7e8acc2139d0d5e3b2774a6ef82ea7。总控审完整diff及本机VSCode实际按id解析实现，现场新日志16:33 ep/eq与接收移除的身份/业务顺序一致；旧版正常私有Development T-accept-red门控reveal入口并实际接收移除合成项，真实VSCode拒绝同类Cannot resolve tree item，修复版T-accept-ui同条件选中下一项2、事务为空。门控在调用入口，不冒称现场逐毫秒内部时序已证。总控实看ui-38b71429ea65438393205f667c3e4a41.png，目录选中与审核页2一致，批注节点保留；两轮host/observer/外层0、Default前中后各自不变且GUI私有。复用92项有效定向测试，不重跑同组。

总控独占补controller-tree-final.cjs：在真实workbench/inline调用链注入一次真正reveal失败，同时两次刷新并切到项2、追加作者批注；原错误明确reject，队列继续选中最新项2及其最新批注，未调用decide/decide-batch，exit0。证据在D:/latex-writing-checks/question-mode-latency-20261124/controller-tree-final*。首次读取两个UI process文件漏-run后缀只读失败，随后按实际文件名核实，未改日志；Terra全部首败/未复现对照保留。无剩余阻塞，允许T3按原范围必要检查、预核0.9.65无冲突后唯一构建及同包正式发布安装。计划/索引支持更新随版本批纳入，交付execution尾留总控集中结案；不自动重载/重启、包后冒烟或删除。

T全阶段完成，返修0。0.9.65正式发布并同包安装，唯一构建输入23690cc69572933be3967c9c74a61ea1d00ed615；必要版本/MCP/发行工具检查通过。总控实核远端附注tag对象fe3a854862e1ff2e5dea8418414668b2008f54db及构建目标、SOURCE-COMMIT与双包摘要；controller-tree-release-meta.py实读Release API确认非draft/prerelease，三附件digest与本地同包一致，实际manifest及登记为local-research.latex-writing-tools 0.9.65、source=vsix/pinned=true，exit0，完整摘要见execution。API原始输出/退出与结果在D:/latex-writing-checks/question-mode-latency-20261124/controller-tree-release*。

修复解决接收移除旧项与列表定位交叠的已复现路径，未改正文定位、作者批注或接收语义。真实论文/P/草稿/范围外stage及用户窗口本轮未操作；旧真实保存false原因等历史限制仍保留，不夸为全部故障已修。无重构建、包后冒烟、删除或自动重载/重启；安装不证明活动宿主已加载，需用户重载目标VSCode窗口启用。全部租约已交回、无在途，execution尾与plan/index集中结案。

## U阶段：返修上下文、无跳转接收、问题目录、自动备份与方案选择

2026-11-24用户明确要求返修交接仅提供对应批注内容和状态，其余个人习惯、论文要求/背景、原文/候选、其他批注由AI像读取SKILL一样按需查看；随后补充接收时不要跳到源码再回审核页。两个目标均连续实现并按既有授权验证、发行安装。起点master==origin/master==7f0af3b7a0f2357f2af43faf25c19cb0960b6141、clean，已安装0.9.65；沿原总控及唯一Terra，U返修0。

已核入口：inline_review.addRequests默认附件包含完整original/全部options/旧快照、paper_background/personal_prompts及完整反馈协议；read_context/read_feedback随后又自动附加背景、习惯和协议。仅缩短附件而下一次工具再次全量灌入不满足目标。read_paper_background、read_personal_prompts、read_file_roles、get_instructions及ids/scopes定向读取已经存在，应优先复用并明确读取指引，不新建通用检索/RAG或资料副本。read_context默认所有pending及known_feedback完整附件收据的语义必须准确：精简附件不得冒充已有原文/全部方案，不能继续发送这种收据让AI跳过必要内容。共享接口变化以必要消费者组有界回归，旧入口及明确全量读取能力保留。

接收跳转来自review_host_transaction获取不可见文档时showTextDocument(preserveFocus:true)，其显示仍能替换审核页所在组；共享applyHostEdit依赖TextEditor.edit。目标是已有受保护事务后台编辑/保存文档，审核页不被替换、焦点/草稿/阅读位置不跳。优先既有VSCode文档/工作区编辑API，必须保留宿主资格、writer、确切version/text、脏稿拒绝、迟到作者修改拒绝、保存结果和中断恢复；不可用磁盘直写、隐藏盲保存或先切走再跳回冒充无感。共享helper的migration/legacy调用若受接口变化影响须一并处理而不操作真实迁移。

- [x] U1 原Terra按强相关批次收窄返修附件：默认只含本次明确范围内的作者批注正文、状态和必要准确身份/版本/文件/选区/用途及极短读取入口，不自动附个人/论文资料、完整原文/ABC、无关批注或全协议。所选、本项、明确全部入口保持各自范围；旧版/上一轮/暂留/译文/问题批注保留精确定位，可用现有工具显式取得其不可变内容，不截断作者文字或改写状态。连同CLI/MCP实际读取链按需化，资料/规则须可发现、可获取，正式写作仍须读适用作者约定。默认返修读取不能隐式读所有pending或又附其他层资料；明确全量请求继续支持。不自动改全局SKILL。
- [x] U2 原Terra最小修复单项/批量接收在审核页可见时的后台编辑保存，保持所有事务和活编辑器数据保护。必要共享调用方、单测与文档同批；正常私有Development用源码未打开的同组审核页实际单项及多文件批接，核审核页从未被源码替换、Tab/焦点/三稿及最终持久化正确；保存拒绝、脏稿和并发作者编辑继续真实拒绝。无性能测试/新阈值，不重跑未变功能组。
- [x] U2b 底部同一快捷目录随模式联动：段落模式保留文件树，问题模式按完整问题身份分组，跨文件关联及共享项准确显示，未绑定项单列；选择问题或关联项须在问题界面定位，不静默切段落。保留暂缓/冲突、刷新与旧会话树保护、三稿及批注选区；明确深审入口仍可切段落。私有 Development 验证模式切换、跨问题与跨文件、共享项及未保存批注。
- [x] U2c 用户明确授权本项目自动备份包含既有暂存、已跟踪修改及未忽略正式新文件，并普通推送已有本地提交；此授权取代本功能旧的范围外暂存和人工提交排除。保持忽略规则及审核运行数据、临时文件排除，保留仓库身份、私有目标、单写、恢复和并发保护；区分本地领先与远端推进／分叉，不强推或改写历史。合成仓库验证成功、失败恢复及隐私边界；不操作真实论文仓库。
- [x] U2d 问题模式扩大批量选方案的命中区域：单击方案框非交互区域选择对应项和方案，重复切换不增加项目；保留原复选框／下拉框及取消操作、选中视觉和键盘焦点。拖选文字、批注及内部按钮不误触；暂缓、冲突、过期、草稿和事务保护不弱化。私有 Development 验证 B/C 切换、取消、共享项、计数、拖选和按钮，源与审核状态不变。
- [x] U3 整阶段局部验证通过后冻结交包，总控审真实diff、精简附件及实际MCP返回/按需取回、无跳转真实宿主链，只补未覆盖必要组合；必修交原Terra，不总控实现自签。旧批注及数据保护不得因节省上下文而减弱。
- [x] U4 最终通过后另派原Terra预核下一版0.9.66实际无冲突、必要版本/发行检查、唯一构建及同包正式发布安装；总控核元数据并集中结案。不自动reload/restart，不包后冒烟或删除。

仍为普通Windows原仓，分批每批最多8源码/测试/文档文件及2至3强相关问题，按依赖顺序而非凑数拆批。当前总控只写完整plan/index增量，交Terra随首个成功功能批纳入，不单独提交；实施期间全部产品/测试/UI/隔离配置/Git租约给原Terra，总控不并行写/测。仅隔离合成项目、专属pipe/profile，UI遵循CreateDesktopW私有未切桌面、不在Default及前台输入保护，截图实看保留。真实论文/P/任何作者稿件、批注、模板、范围外暂存、默认pipe/MCP和用户窗口不操作；不发送真实内容至外部服务/AI，无cleanup/删除。普通精确stage/commit/push origin master/fetch，远端前移/权限冲突停相关动作，不reset/rebase/merge/force/改remote。pwsh7、UTF8、Python -B -X utf8；首败与未知保留，局部过程记execution，只有完整交包或实质阻断发必要消息。

U3最终功能审核通过，返修0，冻结基线f5ed87e8529d782fc18e7f7a3d77844aa9a4efc8。总控审完整相关diff、共享文档编辑/事务消费者、返修附件与MCP按需协议、备份暂存选择/历史及私有排除、目录模式和方案选择链；复用各局部真实证据及94项前端、12项MCP、后台编辑和7/10项备份定向覆盖，首败不改签。U-handoff-mcp实际附件参数可定向读批注及原版、显式取资料/角色/规则，默认无全量pending或资料注入；接收使用WorkspaceEdit和真实文档版本保护，不显示源标签。

总控独占U-controller3正常私有Development补未重叠组合：底部问题目录切R1-Q2选正文2/B，再切R1-Q1选回复a/C，通过真实页面接收全部已选；读回两文件准确替换、accepted_option及transaction空、项5原批注逐字段不变；TreeView最终待审由7到5且移除两项，模式仍question。持续Tab事件为空、active始终论文审核，无main/reply标签。host/observer/外层均0，Default及前中后HWND4066030一致、GUI不在Default、私有桌面关闭；总控实看ui-97f91cdeabc546f7a1de9273d14d86c9.png。证据D:/latex-writing-checks/review-efficiency-20261122/U-controller3.*及u-controller3。

总控外置setup首轮u-controller1因复用脚本的循环name覆盖变量，在prepare复制前FileNotFound退出1，无UI或业务执行，原目录保留；修正后新u-controller2业务及无源Tab链0，但截图在目录异步刷新完成前，不能用该截图签最终目录；新u-controller3增加真实目录收敛条件并通过，不修改产品或旧日志。外置setup脚本在D:/latex-writing-checks/question-mode-latency-20261124/setup-u-controller.py；首次命令输出保留会话记录。

真实论文仅按用户新增明确许可普通推送既有323f78c旧格式提交，实时远端已核一致；未新stage/commit稿件或备份全部真实文件，当前自动任务及旧提示是否更新未核。其余产品验证均隔离，无真实MCP/窗口/资料写入；无删除、重载或重启。U4现在可按原授权预核0.9.66无冲突、必要版本/发行检查、恰一次构建及同包正式发布安装；本plan/index支持变更随版本批纳入，发行execution尾留总控最终元数据核对后一并结案。

U全阶段完成，返修0。0.9.66正式发布并安装同一VSIX，唯一构建输入d117c52ab97b5e7f3c4f9c4b0ce9d1f2973c10df；必要检查通过，版本检查首次缺PYTHONPATH及一次shell引号失败保留，修正后的version2为0。总控核远端附注tag对象9731e11aeb9c187207d151df51aaf3881ca1f9ec及目标、SOURCE-COMMIT/双包摘要；controller-u-release-meta.py实读Release API确认非draft/prerelease、三附件digest与本地包一致，实际manifest/登记0.9.66、source=vsix/pinned=true，exit0。完整摘要及构建/安装命令见execution，API原始输出/退出在D:/latex-writing-checks/question-mode-latency-20261124/controller-u-release*。

发布安装无重构建、包后冒烟、删除或自动重载/重启；用户重载目标VSCode窗口后启用界面/自动备份变更，现有TeXScholar MCP连接需重启后使用新版按需读取。真实当前稿件未在本轮手动stage/commit，实际自动备份重试和旧提示是否刷新未核，不声称已全量备份真稿；只推既有323f78c的事实保留。全部租约已交回、无在途，执行尾和计划索引集中结案。

## V阶段：按具体批注限定返修消息

2026-11-24用户复核0.9.66后明确：剩余批注也由AI主动查询，返修消息仅放用户添加返修批注的那些批注。当前起点496740d497c9dfe722b3e0b108eb82e34e922e2b、master同步clean；继续原两角色，V返修0。本代将交接从审核项粒度收窄到本次新增/编辑或作者明确选择的具体request身份，不能因同item而附上其他旧/上一轮/暂留批注，不以缩短资料为已满足批注范围。

已核saveNote丢弃后端feedback返回的request，handoffSavedNote只传c，addRequests用feedback-context --id而打包整item的所有待处理/暂留批注；编辑、保存并切换、失败重试及批选交接共享链须完整处理。优先复用后端现有request精确身份、当前批注管理选择器与MCP定向读取，不新增按时间猜测、全局已发送标记或第二份批注状态表。只保存不交接仍保持；保存并交接直接只附该笔成功保存的批注，重试必须固定原snapshot且不重复保存。普通工具栏/所选项交接需要作者明确指定要发送的批注，可沿现有选择UI完成，明确全选能力保留，但不隐式把全部旧批注发给AI。其余批注保存在唯一状态中，可由AI按需读取；不暗归档/删除/解决。

- [x] V1 原Terra实现精确request级附件、必要服务返回值/调用方/批选和失败重试；保留project/state/session/item/version/request/状态/用途/选区及仅所选批注正文，不附其他批注、资料、完整原文/ABC或协议，不伪造known_feedback。新建、编辑、跨卡问题/译文、旧版、暂留、同文不同ID、迟到变更均依原身份/版本保护，不按文本猜配。真正有变更要明确拒绝或让作者重选，不扩大范围。README/交接文案与实际行为一致，AI其余所需上下文仍通过现有工具按需获取。
- [x] V1b 精简 AI 论文助手实际任务提示词，仅保留明确任务、项目身份、版本和必要按需工具入口；不自动注入批注、论文资料、个人习惯或完整协议。历史迁移资料保留原来源及范围，不将待审意图升为已批准要求。
- [x] V1c 作者习惯和论文要求允许为空，未明确设置时不从历史注释、迁移资料或模板自动填充；后续作者明确写入仍可用。保留旧资料和候选 proof 绑定，真实既有资料若需重置由总控核具体范围并协调，执行者不写真稿或 profile。
- [x] V2 局部定向测试和正常私有Development核同item至少三条旧/暂留批注加本次新增或编辑，实际附件只含明确request且状态逐项准确；重试不重新保存、不扩大，作者多选跨项精确输出，底层其余notes/state/对象不变且可按需查回。总控冻结后审真实diff/消费者及只补未覆盖必要组合，不重复同组。
- [x] V3 最终通过后另派必要版本/发行检查、实际预核下一版0.9.67无冲突、唯一构建及同包正式发布安装；总控核元数据集中结案。不自动reload/restart或包后冒烟。

当前总控仅写本plan/index支持增量，不独立提交，交原Terra与首个成功功能批纳入；产品/测试/UI/隔离配置/Git全部租约给原Terra，原总控不并行写/测，整包完成且无在途再交回。仍普通Windows原仓，pwsh7/UTF8/Python-B-Xutf8，精确成功批普通commit/push/fetch核一致；远端前移/权限冲突停相关动作，不reset/rebase/merge/force/改remote。只用合成隔离项目、专属pipe/profile、CreateDesktopW私有未切桌面，不在Default且前台输入保持，截图实看保留。真实论文/P/批注/三稿/暂存/用户窗口/默认pipe及MCP不操作，不外发真稿，无文件/对象/截图删除或cleanup。旧失败及未知完整保留，无新增性能测试。

V1至V2最终通过，返修0，冻结源码ed1ad8be8c993667c5019406333b132048138ff7。总控审精确request返回、选择器、重试快照及二次状态核验，核日常任务不再预读资料；明确机器配置任务保留安装说明。复用V-workbench-test8的94项、V-writing-test4目标组、V-mcp-tests3的12项及V-handoff9正常私有Development有效覆盖，原始process均exit0；实看ui-a89b85523103460aac81b239ca83de79.png。附件接入为隔离桩，不称实际桌面MCP交接；V8人工占位及全部首败保留，不签成功。筛选资料返回partial和revision=null，写前须完整读取，未弱化全数组CAS。

按用户本轮明确空要求授权，总控独占完成真实profile最小重分类：paper_id=1、revision3→4，112条历史constraints改为other并标明历史原注释、非当前要求，原scope随条目保留；152条原文/source/evidence全部保留，其余40条逐字段不变，22个候选proof来源摘要不变。个人习惯本来为空且保持，当前constraints实际为0。使用原writer_lock_at及paper_background.write完整读取/CAS，无FakeHost或源写入；前后state原字节、aliases、roles、personal一致。controller-v-profile.py先只读预览，再明确--apply exit0，baseline/selection/planned/result及实际argv/cwd/stdout/stderr/exit保留在D:/latex-writing-checks/question-mode-latency-20261124/v-real-profile与controller-v-profile-apply.*，原文仅本地保护不上传。此授权仅改变既有历史资料分类，不从中自动提炼习惯或规则；后续作者明确写入仍可用。

V3现可由原Terra预核0.9.67实际无冲突，完成必要版本/MCP/发行检查、唯一scripts/build.py构建、附注tag及正式Release三附件摘要核对，同一VSIX CLI安装并核manifest/登记。支持plan/index随版本批纳入，execution发行尾留总控与结案集中提交。复用有效功能证据，不重复UI、真实profile操作或包后冒烟；不自动重载/重启，不触真实论文/用户窗口/默认pipe，不删除。总控仅在交包后核发布安装元数据。

V全阶段完成，返修0。0.9.67正式发布并同包安装，唯一构建输入5979037e47a702b97f0e56d0c60471db129f6f04；必要版本/隔离MCP/发行工具检查均0。总控实核远端附注tag对象d172400d26050deff94fffdb589f61f0b692da79、目标与SOURCE-COMMIT/双包摘要；controller-v-release-meta.py读Release API核非draft/prerelease、三附件digest与本地包一致，实际manifest及登记为0.9.67、source=vsix/pinned=true，exit0。完整摘要及实际构建/安装命令见execution；API原始输出/退出与结果在D:/latex-writing-checks/question-mode-latency-20261124/controller-v-release*。

返修交接仅附本次新增/编辑或明确选择的具体批注，其他批注由AI主动查询；日常助手提示不自动附资料与批注，角色/规则/个人习惯/论文资料可按需读取。真实当前习惯与论文要求均为空，历史原文和候选绑定保持，后续提炼由作者指定会话执行。实网AI与真实桌面附件接收端未测；未自动重载/重启、包后冒烟或删除。用户重载目标VSCode窗口并重启现有MCP连接后启用新版。全部租约已交回、无在途，执行尾与计划索引集中结案。

## W阶段：接收后清理历史与当前返修隔离

2026-11-24用户报告已接收后旧批注仍存在并混入提交，同时要求可复制提示词供其修改会话从历史注释提炼个人及论文习惯。随后明确纠正：接受后不能继续保存历史，防止长期占空间；此要求取代本代最初保留已完成历史供查看的设计。提示词由总控直接提供，本开发代不擅自提炼或再填资料。起点master==origin/master==51c7b8d23d6c13f38aae417e33ca5a1ab82bfaf0、clean、已安装0.9.67，原两角色不变，W返修0。

只读真稿核对：当前transaction为空；18条previous_feedback批注所在项accepted而批注仍open，另有rework项上一版open3条及当前open2条，当前closed5条。源码decide仅关闭edit.requests，未处理previous_feedback；feedbackRows混列两代全部状态，V交接选择器只检查身份并未过滤已关闭；CLI feedback_context和MCP feedback_packet把任何open/held作为可返修。因此对象保留和实际待办混杂确有区别，不能只把问题归因于窗口未重载，也不能据“旧”批量删除或认定所有未处理意见已解决。

- [x] W1 原Terra补原决定事务中两代批注生命周期：接收成功后清除已完成批注和不再需要的候选历史，不增加历史库、隐藏存储或备份副本；拒绝遵循一致的已完成生命周期。保留held、真正未完成项、共享引用及当前事务恢复/未备份已接受正文所必需的最小数据。优先复用review_checkpoint现有引用分析/压缩协议，保持作者正文和备份正确，不能提前删事务恢复对象。已决定但旧note仍open须有兼容清理/读取语义，不假称科学问题逐条已证明。真实旧数据先精确预览受影响记录/对象及受保护事务，由总控独占协调，不直接写真稿。
- [x] W2 批注管理、当前卡/目录计数、返修选择器、附件、CLI/MCP反馈消费者一致排除已完成历史；不能让“全选当前范围”暗带旧记录，也不能只从UI隐藏而仍无限积累。V保存并交接单笔、明确多选和重试固定快照保持；未处理上一版与held仍可查询继续。旧候选物理回收严格按引用与既有已备份安全门，完整文件删除遵循safe-delete-paths精确目标预核/一次确认/直父目录短叶名，当前不执行真实或隔离文件删除，不重跑cleanup apply组。
- [x] W3 局部先复现决定后上一版仍进入反馈及关闭项仍可选的真实调用链，再修复并验接收/拒绝、旧数据、held、当前未处理/旧版未处理、同ID镜像、附件身份、迟到变化与事务失败不提前丢数据；正常私有Development实际管理/选择/交接，核已完成记录实际退出存储、未完及必要恢复引用保持。对象删除执行边界可用mock验证精确目标和调用契约，不真实删除文件。复用V有效链，不机械全组、无性能阈值。冻结交包后总控审diff及只补未覆盖组合；通过后另派必要下一版无冲突预核、一次构建及正式同包发布安装。
- [x] W4 最终通过后预核0.9.68实际无冲突，必要版本/MCP/发行检查、唯一构建、正式Release与同VSIX安装，总控核元数据集中结案。物理旧缓存未删除，不以发布安装宣称已释放磁盘空间。

当前总控只改plan/index支持增量，交原Terra随成功功能批纳入；全产品/测试/UI/隔离配置/Git租约整体给原Terra，总控停止并行写测。每批2至3强相关问题、最多8源码/测试/文档文件，普通精确commit/push/fetch，远端前移停相关操作，无reset/rebase/merge/force或remote改变。只用新隔离根/专属pipe/profile，正常私有未切桌面实看截图且Default前台保持；真实论文/P/state/批注/草稿/暂存/用户窗口/默认pipe/MCP无写入，无完整文件删除/cleanup执行/实网AI/自动重载重启。首败/未知完整保留；用户已授权已完成历史退出存储，保护仍未完成/held及必要恢复数据，真实文件精确目标另按删除规则处理。完整交包交回租约后总控再决定必要现场操作及发行。

W首次冻结358a34c最终审核未通过，W返修1：新加_decision_pruned在每次有批注接收的事务对象中复制整份state-before，但实际recover及宿主恢复无消费者，仅新增测试读取该副本。它不是当前恢复协议必需字段，违背不额外存历史及最小数据要求；去掉这份全状态副本和对应仅镜像实现的断言，恢复链继续以原old/new正文和transaction为准，验中断后正常完成且未完/held不丢。总控已审相关diff及实看W-ui-run3截图，之前正确功能与有效局部覆盖按未变部分复用。真实prune-completed只读预览exit0：23条已决定非held记录（5 current closed、18 previous open），未apply、未删文件。候选旧对象仍按已核备份检查点及共享依赖安全门处理，不把未运行的物理回收称已完成；返修还须明确指出正常备份与compact/cleanup实际接通情况，以确定本次实际可释放范围，而非仅描述安全门。

W-R1最终功能通过，冻结cd83e3f5bf83ddce00013d1a250b3840b4137755，返修1。总控审新增自动备份→精简的实际调用、无变化重试和备份成功/精简失败的分别报告、session/version/blob/HEAD/origin校验、held/待复核及传递依赖保护；无用全state副本已移除。复用W-r1-lifecycle3七项、backup7两项、backup-extra2两项exit0和W原消费者/UI有效覆盖，不重复同组。自动备份远端确认后只释放可精简候选引用，未接通物理删除，拒绝项对象仍按原成果收尾；这些限制不伪称已解决。

总控真实现场按原writer lock和精确SHA执行prune_completed/persist({})：移除23条已决定非held记录，完整expected-state比较通过，其他状态字段未改；剩余5条均rework/open，MCP反馈只读返回5条，transaction空。controller-w-prune.py首次进程exit1发生在写后反馈包全体比较：包内state SHA必然变化，属于总控断言过宽，不是写失败；未重放，后续只读readback exit0确认结果。首败/argv/stdout/stderr及readback保留D:/latex-writing-checks/question-mode-latency-20261124/controller-w-prune*，未复制整份旧state作为历史。首次脚本中source/index/对象逐字后置断言尚未运行，不能称它们已实测通过；该操作代码路径仅原sidecar元数据写入，未触源/P/窗口或物理文件删除。

现场只读对象核对：957对象中407个当前无引用，合计68733494字节；state无全局成功checkpoint，saved_done提交4943bebea35d7737f28687d3e736e6bfc1ac041a，未触发原成果收尾或清理。物理缓存尚在，不声明磁盘已释放；完整文件删除仍保留现有精确目标和检查点许可边界，不借本次元数据清理绕过。W4只负责已通过代码的正式同包交付，不追加真实备份/删除/重载/重启或包后冒烟。计划索引支持变更随版本批纳入，execution发行尾留总控集中结案。

W代码交付完成，返修1。0.9.68正式发布并同包安装，唯一构建输入a8c59927a01bafd397d2b8436e09fca6569c1ade。总控实核远端附注tag对象e0ed041f750ccd2561de1f61da3822479015f5f4、构建目标及SOURCE-COMMIT/双包摘要；controller-w-release-meta.py实读Release API确认非draft/prerelease、三附件digest与本地包一致，实际manifest/登记0.9.68、source=vsix/pinned=true，exit0，原日志在D:/latex-writing-checks/question-mode-latency-20261124/controller-w-release*。必要版本/MCP/发行工具检查通过；W4-version导入路径首败、只读查询错误和全部前期失败原样保留。

本交付解决已完成批注仍进入返修、决定后两代批注累积，以及已确认自动备份后候选引用未精简。既有407个无引用对象文件未物理回收，这是仍未完成的磁盘清理项；须按原检查点和精确文件规则另行处理，不把引用释放等同空间释放。未自动reload/restart、包后冒烟或文件删除；新界面需用户重载目标VSCode窗口，现有MCP需重启连接才加载新版，旧任务包应重新生成，不能手改版本绕检查。完整可复制习惯提炼提示词已给用户，不自动填资料。全部租约已交回、无在途，执行尾与plan/index集中同步。
