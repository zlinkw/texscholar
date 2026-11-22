# 选择式交互与配置持久化

## 授权、基线与角色

2026-11-22用户已审核完整方案并明确授权实施、验证、正式发布和安装：任务选择必须生成对应提示词及上下文，配置跨版本持久保留，保护真实论文、作者批注、未保存草稿和范围外暂存。完整范围包括AI任务与配置引导分流、Git说明与取消前保存时序、工具路径选择、外观常用选项、保留必要自由文本及既有选择入口。无需再次取得泛化实施或发行许可；新渠道、真实秘密、论文操作、删除和权限边界不因此扩大。

刚fetch核实`D:/GitRepo/texscholar`为普通Windows本机项目，非Pi/Herdr管理模式，不迁移worktree；master跟踪origin/master，HEAD==origin/master==`09d0ddfc4ec0089137ab6ba7f44dc44df740cd04`，原工作区clean。0.9.56已完成正式发行安装，用户已重载窗口和重启MCP；前代计划仅作为有效机制/证据，不重新开启。下一版预计0.9.57，发行前核实际版本、tag与Release唯一性。

总控兼最终验收`local/01a1fe7c-cc49-70d0-ac4c-af5e77c7b6ba`独占本plan/index，保持Sol6.1/high/default；唯一原Terra`local/01a1fd60-2da5-74e0-8e68-e266cf679881`负责产品调查、实现、唯一execution.md和阶段小验收，现实核Terra6.1/high/default、4次压缩、match/continue，未触发接替。两者标题已显式更新并回读。按caveman自然门槛接续，不新增审查/执行代理，不唤醒已结束专项Sol。总控审核实际diff/证据并做独占跨入口大验收，不接管产品实现后自签。

## 只读盘点依据与已知限制

原Terra完成母集检索，排除tests/vendor/退役定义/内部MCP参数和文档示例：原生showInputBox 3处、showQuickPick 16处、showSaveDialog 1处、showWorkspaceFolderPick 1处，另查工作台真实input/textarea/select、贡献命令/菜单和GUI设置。QuickPick搜索是筛选，不是被迫填空；无createCandidatePanel实际调用的旧定义不当作可达UI新增改造。

截图入口是`localLatex.startPaperTask`（package.json:353–356、612；inline_review.js:978；mcp_setup.js:119–149）。原功能生成任务请求，加入Codex输入区或经明确选择复制，不自动发送、不直接改论文；可能登记MCP、写插件globalStorage/工作区状态或Codex自有配置，并可能新建聊天，不能声称零本地写入。taskRequest当前只有通用目标/工作区根/版本和稍后read_context、A/B/C指令。另一个writing.js入口已有选区/光标定位和周边上下文；应复用，不能将“提供上下文”仅做成改标题。

已有个人/项目设置多数在VSCode配置或Memento中；globalStorage已有稳定MCP启动器和connection.json，配置写入保留部分用户冲突。版本化chktex包装脚本与MCP server路径确需升级更新，但尚未实证用户反复配置的具体原因；旧活动MCP版本提示、进程内引导提示、不同profile/workspace/client、失效工具路径与真实配置丢失须区分，不把猜测写成已修根因。源证据在setup.js:54–116/183–194、mcp_setup.js:38–88/150–153、mcp_config.py:12–23/37–86、ai_setup.js:98–101/118–168、tools.js:14–52、updates.js:25–45。实施时由Terra按真实调用链补精确位置、缺口和回归，不重新全仓泛查。

## A组：任务选择、对应提示词与跨版本记忆

### A1 任务菜单与上下文

保留现有命令ID、菜单/快捷键和合法程序调用。面向作者的任务入口显示用途及后续行为，先选择任务，再确定真实范围，可选补充要求，预览后明确加入输入区；接口只能新建聊天时明确提示，不虚构当前聊天能力。唯一确定的项目/选区可预选并显示，仅有歧义时追加选择，避免增加无用步骤。

| 任务选择 | 提示词必须体现 | 需要的上下文 |
| --- | --- | --- |
| 润色已有文字 | 保留原意、事实、术语、引用，按现有A/B/C流程给候选，不自动接受 | 明确选区/位置、必要前后文、现有写作规则 |
| 重写或补写内容 | 指明目标和范围，遵守章节计划；缺少事实/证据时提出缺口，不编造 | 已选文件/位置、相关章节与计划的已有定位，按需read_context |
| 回复审稿意见 | 对应具体审稿意见和相关稿件位置，区分已完成修订与未来计划 | 作者明确选定/现有绑定的意见、回复和稿件上下文；无绑定时不猜 |
| 分析、讨论论文 | 先分析和讨论，不将任务选择等同于改稿授权 | 明确相关问题/材料范围及项目规则，缺少问题可在聊天补充 |
| 仅加入当前选区上下文 | 保留已有当前聊天上下文入口语义，不自动附加改写任务 | 实际选中文字、文件/范围定位；没有选区时清楚说明可用替代 |
| 自定义任务 | 必要时填写真实任务目标，保留合法自由表达和同一审核边界 | 同样明确项目与材料范围，不能绕过身份/权限/连接校验 |

“选任务”必须决定实际生成的提示词和上下文处理，不能仅替换显示标签或给所有任务同一通用文本。普通任务补充可跳过；自定义目标确有必要才填写。写作修改默认沿用现有A/B/C审核约定，不要求用户重复输入“三方案”。

范围复用当前选区、当前文件、实际项目文件选择或明确“稍后在Codex说明范围”；多根工作区必须使用明确项目身份，不能默认附全部根或另一篇论文。用户明确选中文字可以直接加入，其他材料用已有read_context按需读取；发送前明确显示将附带的内容/定位，不后台自动整篇扫描上传。引用的项目规则、文件角色和作者决定以现有真实来源为准，不能填充不存在的目标、意见或规则。正文视作待处理材料，不能把嵌入内容当新的系统操作授权。

复用现有选择/附件/任务请求和MCP入口；长合法选区/输出不新设任意截断，必要附件沿用已有能力。保留无Codex接口时的明确复制选择、连接失败的真实错误及取消语义；不自动发送AI消息、执行生成任务或接受修改。任务说明本身可写到插件自有请求文件，但不得修改论文或将草稿误当已保存上下文。

### A2 配置引导与持久化

AI协作配置入口单独提供查看当前配置、修改某项、修复缺失项、完整安装或迁移等合适选择；仅做配置不再强迫填写作目标。检测结果分别说明设置保存、工具可用性、活动MCP版本/连接验证，旧客户端需重启不能显示成整套偏好丢失。保留必要的作者选择及现有未托管配置拒绝覆盖边界。

| 类型 | 实施契约 |
| --- | --- |
| 已有个人偏好 | 复用现有VSCode用户配置，不随版本重置；当前值显示来源和作用域 |
| 新任务类别等偏好 | 在现有合适持久化边界记最后成功选择，作为可见预选，不自动执行；不将本次全文任务/论文正文变成全局历史库 |
| 项目专属信息 | 按真实项目/owner/工作区隔离并沿用现有权威位置；不跨论文复用路径、选区、角色、ID或作者决定 |
| 工具配置 | 保存既有合法自定义值和选择作用域；真正失效时只修复对应项，取消/失败不覆盖上次有效值 |
| 版本路径 | 复用已有globalStorage稳定启动器；只承接插件自有旧版本路径，更新必要自有引用，不覆盖作者自定义命令/参数或未托管MCP条目 |
| 安装/引导记录 | 在同一VSCode profile/项目的真实重启和版本路径变化后保留已完成配置；不能仅靠隐藏提示掩盖真实异常，也不能每次重应用整套默认值 |
| 凭据与外部环境 | GitHub/Codex/VSCode原有凭据管理保持，不读取/复制/打印秘密；若确需新增凭据持久化，使用平台安全存储。CODEX_HOME/PATH不自动迁移 |

保留原全局/工作区/文件夹优先级和合法自定义值，明确修改哪一层，不新增第二权威配置文件、通用缓存、配置框架或全库历史。旧键/旧路径需最小承接时在负责边界处理并有行为回归，升级不全清/强迫重配。跨profile/机器的环境和权限不能冒称同一配置；界面清楚来源与实际失效原因，不静默借用其他账号或项目。

## B组：其他可选择入口与必要自由表达

| 范围 | 必须处理/保持 |
| --- | --- |
| backup.js两处提交说明 | 正文修改/回复信修改/共同修改/其他修改/自定义说明；分类构成真实可读说明，可选补充，不伪造实验结果或沿用上次说明当本次事实 |
| Git保存时序 | 用户已批准先确认范围与说明，再保存/提交；取消前不触发本次保存/Git/精简操作，不能沿用目前输入前saveAll的副作用。只处理作者确认的范围，范围外脏缓冲/暂存/论文状态保留；真实失败可见 |
| 八项工具路径 | texFmtPath/gitPath/pythonPath/checkcitesPath/latexdiffPath/latexmkPath/ghPath/ripgrepPath复用实际检测，列可验证候选、可执行文件挑选和现有合法自定义命令/路径；显示作用域/失效原因，不新增任意shell语义或假称完整发现所有安装 |
| 外观 | 字体提供跟随VSCode/常用/自定义，四个数值提供常用值及合适增减控制，保留既有合法精确值、范围与布局enum；不假称完整枚举本机字体，不裁掉合法配置 |
| 已选择化入口 | 项目/角色/编译主文件、块修复/类别、问题关联、PDF、翻译来源、目录/队列/ABC/历史/草稿/批注范围、配置导入/配套扩展/指南保持旧入口；必要空态/对象说明有具体缺口才补，不重做整套UI |
| 导出 | 保留系统保存对话框、合法新目录及禁止覆盖校验，说明“新建导出目录”；不借此放行覆盖 |
| 搜索和必要正文 | 可选搜索继续可用；正文、候选和批注自由输入保留，提示短语只能辅助且不能自动保存或代表科学事实 |

优先使用平台QuickPick/OpenDialog/既有工作台控件，不另造通用表单引擎。旧文字自由表达入口以合适的自定义/高级方式保留，旧命令与自动化消费者不移除。必要权限、对象确认、ID/version/CAS、脏缓冲/保存/草稿校验不因少填表而削弱。上次选择只是预选，不能成为自动发送、接受、推送、实验或跨项目操作授权。

## 保护、证据与工程边界

`D:/Overleaf/TMI-DA-Marked-up Copy`和所有真实论文完全只读，本轮不得保存/接受/Git/编译/PDF/批注/恢复/迁移/开批/清状态；保护已有正文、版本、决定、批注、counter、未保存稿和范围外暂存。开发验证只使用`D:/latex-writing-checks/choice-settings-20261122`下新隔离子根，保留所有首败/取消/未知及完整stdout/stderr/argv/cwd/实际退出码，不重放已改样例或结果未知操作，不删除文件/目录，不运行真实cleanup备份后段。

配置/升级检查必须使用隔离VSCode user-data/extensions/workspace、隔离globalStorage及CODEX_HOME/注册表/本地bare Git，不能触碰用户真实settings、Codex配置、凭据或活动MCP。产品安装仅最后用户已授权的同一最终VSIX真实CLI安装；不自动重载真实窗口/客户端，用户自行启用。测试附件可用明确记录的输入区捕获接口证明实际生成内容，不能伪称实网AI发送成功。

遵守当前AGENTS的Anti-OverDefense、UTF8、pwsh.exe7、Python-B -Xutf8及build-test-delivery。未知/共享UI/配置/索引/缓存串行；私有输入/输出且无共享资源的检查可有界并行，全局最多两个检查进程，不增加模型。独立文件读取/搜索并行。旧测试/超时/断言不自行退役或改变，无性能测试/压测或无依据阈值；已有效同输入证据复用。

每个内聚验证批审实际diff，精确stage本任务文件（总控plan/index可按原文纳入）、普通commit/push origin master/fetch核相等；无reset/rebase/merge/force/remote变更。远端推进、凭据/保护拒绝或未知冲突停止相关同步并报告，不静默换分支。本计划不是target mode，内部步骤不另建目标模式或论文运行状态。

## 连续阶段、验证分工与完成条件

- [x] C1 Terra：A1任务类别、范围/可选补充、不同提示词和真实上下文、预览/加入输入区语义、旧入口兼容及局部回归。C6发现预览可读性缺口，见R1。
- [x] C2 Terra：A2配置引导分流、成功偏好记忆、旧自定义/键/自有版本路径承接、作用域与失效原因；完成局部配置/迁移/取消/失败回归。
- [x] C3 Terra：B组Git说明与确认后保存事务、实际文件范围和取消零写、旧调用方及受影响消费者回归。
- [x] C4 Terra：B组工具候选/文件挑选、自定义及作用域持久化、外观常用选项；确认已选择入口的真实空态/取消，不扩大重构。C6发现工具名可读性缺口，见R1。
- [x] C5 Terra：最终本轮规定测试/阶段小验收与使用说明，审新增判断/抽象/依赖实际用途；冻结提交与完整交包，明确移交测试/UI/产品冻结租约。冻结8766af4a，规定editor及增量证据有效；不得提前做总控同场景最终大验收。
- [x] C6 总控：审实际diff和原证据，仅做未覆盖的正常Development跨入口、跨进程及版本路径变更组合大验收；首次R1返修已完成，788e8f9的可读性/入口补验通过，结合既有功能/持久化/Git证据整体通过，现交C7。
- [ ] C7 Terra：核预计0.9.57唯一性，必要版本/MCP/发行工具检查，一次构建；源码普通push/fetch、附注tag双摘要、正式Release/API附件digest核对、安装同一VSIX、执行尾提交/远端一致。总控最终核元数据并维护plan/index结案，不包后冒烟、不自动reload。

C1–C4沿上述A/B两组连续实施，按实际内聚调用链组织提交，不为每个按钮换会话或分别冷启动。Terra在execution登记实际改动文件、阶段、返修次数、套件及命令；覆盖所有批准项，不能只做截图菜单或仅记一个内存变量。

本轮规定开发验证：优先扩展现有mcp_setup/ai_setup/writing/setup/tools/backup/workbench及配置消费者套件；新增helper/import先补实际抽取/VM闭包。跨公共入口最终运行当前授权editor组 `C:/Python314/python.exe -B -X utf8 scripts/check.py --group editor --node C:/Program Files/nodejs/node.exe`，formatter/Workshop/Git等使用既有可用本机工具，并登记完整env/argv/cwd/真实子项退出。MCP/config或Python配置实现实际变更时补对应现有消费者，未改的全backend/native/PDF/translation不机械全跑；原未授权cleanup后段不借组名恢复。最终仅补测试/夹具时按增量验收复用有效覆盖而非重跑全仓，不按固定测试数签绿。

Terra小验收负责各任务生成文本/上下文归属、所有选择分支/必要自由输入、取消与空态、配置优先级/冲突/旧键/路径迁移、Git范围与零写、工具/外观值和共享消费者；可用局部真实宿主边界验证，但不得重复下列完整总控场景。

总控C6独占组合验收：用新隔离正常Development profile与两个项目，先带旧版本自定义配置/已有稿件批注、草稿与范围外暂存，从真实命令入口选择任务和范围，捕获实际准备的提示词/选区定位（不发送），验证至少写作修改与另一类任务确实不同；取消自定义和配置步骤保持旧值。整体退出并用相同扩展身份、不同版本安装路径再启动，核个人偏好/显式自定义值仍在、项目隔离、仅插件自有路径更新、配置引导无需填写作目标、不误判全部重配；真正Memento/配置落盘须正常进程证据，不能以extensionTests内存替代。必要重启阶段明确组合事实和首败，不把CLI0当host/UI通过。再从真实Git入口取消后核脏缓冲/磁盘/索引零写，确认合法范围后真实本地bare Git完成且范围外保留；工具/外观至少一条真实选择→持久化→重启链，与原批注/暂存状态正对照。按最终实际diff只补有效小验收未覆盖项，不重复全部局部分支，不要求网络AI/真实账号上传。

全部C1–C6通过且无必需未知后才可C7；发布、安装及元数据核实完成才整项结案。真实用户环境“升级重配”原因为未知时如实保留，不能用隔离通过冒称已复现原环境；但批准的跨版本保存/合法配置承接契约必须有实际新证据。

## 当前归属与下一动作

C1–C5冻结8766af4a，R1冻结788e8f94f5cd2a4a84a029297dd129da7f343881，普通push/fetch一致、clean。总控已审实际diff、execution和局部证据；R1补验及C6组合整体通过，见下文。总控所有隔离宿主/observer/命令已退出，现将产品冻结后发行、测试/安装租约交原Terra连续C7，plan/index仍归总控。沿已授权预计0.9.57正式发行和同包安装；总控无独立待办后角色空闲，待完整交付再核发行元数据结案，不做包后冒烟。

## C6实际证据与R1

证据根`D:/latex-writing-checks/choice-settings-20261122/controller-c6b`，全新Paper A普通项目+本地bare Git、Paper B六项真实审核状态（含既有延期批注），隔离user-data/extensions/CODEX_HOME。正常Development、非extensionTests，同一扩展身份controller-validation.choice-c6-fixture，manifest由0.9.56到0.9.57、lib从extension-v1换到extension-v2，代码均冻结8766af4a。此为版本安装路径仿真，不冒称已在用户原环境复现升级重配原因。完整argv/cwd/env/CLI与observer真实退出在run-phase*.json、logs；原图/原始生成附件和RPC结果保留。

有效组合事实：

- 真实原生命令菜单完成润色、讨论、仅选区三种任务，选择Paper A，捕获实际请求文件，指令确实不同、仅A项目、精确选区quote/left/right或main.tex定位，未发送/接收；自定义目标取消无附件。工具Python真实选择保存及取消保留旧值；配置完整安装入口无需填写作目标。六种提示词及其余局部分支复用Terra c1-integration-1等有效证据。
- 原生普通备份先取消，磁盘/两个脏缓冲/外部stage均未变；再只选main.tex确认，实际保存与本地bare推送成功，HEAD=origin/master=bare HEAD=c9f73c540f2e8fc3b82979634d3a974080488985，other.tex仍dirty、外部stage逐字保留。GitHub私有元数据由任务内exe夹具返回，实际Git操作委托真实Git及本地remote；不声称实网上传。仅手动命令受测，夹具隔离自动定时入口，未测真实五分钟。审核项目finishReview仅真实菜单取消，状态/notes/counters逐字不变，未运行cleanup后段；其旧有非空暂存区安全拒绝不改成支持带stage推送。
- 真实审核页字号常用值20保存；字体Georgia, serif、工具自定义值和关闭自动翻译保留。此字号现有schema为window范围，Paper B文件夹19值不是该键可用的folder覆盖，VSCode忽略它；实际按钮保存用户层20，不能据此宣称同多根窗口的字号可按folder隔离。原有window/机器级作用域未削弱，项目隔离以任务A范围及B审核/草稿正对照验证。
- 正常Development页面创建C6_PRIVATE_DRAFT并暂存，1finish和2retry两个完整进程退出重开、不同session后，真实globalState/workspaceState与工具/字号/自定义字体完整保留，菜单首项显示“仅加入当前选区上下文 上次使用”，B草稿精确快照保留。自有ChkTeX记录的路径从v1变v2，author-owned-chktex及-q/-n8原参数不变；MCP稳定登记换到v2，隔离Codex其他服务/模型哨兵保留。迁移helper操作真实配置和Memento，未使用假的内存Memento。

实际失败与续测不改写：初始controller-c6的observer只找HTML button而VSCode用role=button的a，等待失败，原生预览取消后CLI0/observer1，host false；新c6b原生链已成功，但首段observer1/CLI0因夹具误期望提交说明不带既有backup(paper):前缀，实际推送成功，后续1finish只核结果、完成未执行UI步骤，未重放备份，host/UI true且CLI/observer均0。phase2在自有路径迁移后，夹具events.before引用本数组造成JSON循环错误，observer1/CLI0，不能报整轮通过；修正只读日志快照后2retry只核落盘和未执行菜单/页面，host/UI true且两exit0。原错误、RPC、stdout/stderr/截图保留。外置补丁一次因行匹配错误未应用，后用完整行补丁，无产品写入。两次失败均为已查明夹具问题，未发现功能链产品反例。

R1（首次产品返修）：实际截图phase1-dialog-9.png把read_context、expected_plugin_version和原始JSON整段作为用户确认预览；工具列表实际使用pythonPath/gitPath等内部键名。用户当前要求是看清功能、选择完成，且产品流程不应暴露无助于决定的实现细节，因此C6未通过。仅返修这两处：预览改为可读任务/目标聊天/真实项目/选中文件与原文范围/可选要求/不自动发送和接受/确认后可能连接登记的简洁说明，完整协议继续保留实际附件；原文不任意截断，不引入第二套任务状态。八工具使用中文用途+工具名，内部键可作次要说明，值/来源/机器级约束不变。保留全部旧入口、取消/失败、原校验及成功记忆。Terra做受影响局部回归、精确commit/push/fetch再冻结；总控只补实际预览与工具菜单的新证据，复用上述完整功能/持久化与Git证据，不重复全链或全editor。未整体通过前不得发行。

用户追加截图后的R1范围修订：已只读核实VSCode安装登记仍为local-research.latex-writing-tools 0.9.56；本轮尚未发布安装，新增工具命令等不会出现在当前环境。用户指出命令面板仍有过时和重叠入口，纳入同一可读性返修：原Terra按实际命令/菜单及必要调用链核对入口归属，修正“连接、配置与任务合一”等已不准确的标题，日常任务/审核/配置清楚区分，重复及高级操作收进可发现的“更多”或现有相应菜单，旧命令ID、快捷键及程序调用保持兼容；每个隐藏入口必须有明确可达替代，不能凭截图断定死代码或直接删完整文件。疑似不可达定义按调用证据区别处理，不扩成全仓清理。总控补验可发现性和旧命令兼容，复用已有效业务证据。

旧档位阻断已解除：R1此前未开始产品写入，仅因原规则把priority当作不匹配而只读待命。用户通过规则维护会话明确通知：Standard仅默认，界面选择Fast/Ultrafast无需文字确认；service_tier只记录实际值，不作为模型/强度门槛，保留用户选择。统一caveman及脚本已更新，总控本次实核Sol6.1/high/default、原Terra6.1/high/priority均match/continue，分别1次/4次压缩，均未触发接替。无需用户调档、不操作桌面设置。当前HEAD与origin/master为9b581d3、clean，无在途产品/测试/UI；沿既有租约一次交齐R1及追加命令入口修订，原Terra连续返修、小验收及冻结，总控补验后按授权C7完成，不新建角色、不重放已知结果或重做有效全组。

## R1补验通过与C7交付边界

R1已按范围完成：任务确认预览为可读任务/说明、聊天、项目、文件与实际原文前后文、补充要求及不发送/不接收提示，协议仍在附件；八工具为用途+工具名、键作次要信息。任务/配置命令标题分开，inlineEditCandidate/inlineTranslate/inlineQuestions三个重复命令仅从面板隐藏，原注册/调用保持；prepareReviewBlock/resolveReviewHost/migrateReviewState/recoverReviewMigration四项移至编辑器右键“原文审核与批注 → 审核高级操作”，README给出明确入口。未删源文件或改业务事务/存储/校验。Terra r1-local-2定向writing/setup/menu_commands/inline_review 56项exit0（完整argv/cwd/env在execution及对应外置目录），首次mock错误保留。

总控最终补验新根`D:/latex-writing-checks/choice-settings-20261122/controller-r1d`，正常Development、独立profile/extensions/CODEX_HOME、全新LaTeX样例，保留冻结788e8f9完整真实菜单贡献。`C:/Python314/python.exe -B -X utf8 <root>/run.py`启动实际Code CLI与Node/Playwright observer，真实argv/cwd/关键env/退出见run-result.json，stdout/stderr见logs；CLI0、observer0、host-result.passed=true、observed.passed=true。readable-preview.png/tool-labels.png/advanced-menu.png均已实际看图，确认原生任务选择后预览无read_context/expected_plugin_version/JSON，实际附件仍有完整协议及精确quote/left/right、无选区截断；八项工具用途/路径/来源可读且取消不改设置。命令面板可搜索新任务/配置名，迁移项不在面板；原生右键三级菜单真实展开包含四项高级操作，全部旧ID仍注册，原调用方通过Terra定向测试。样例正文和隔离用户设置前后逐字不变，无发送/接收或迁移操作。

外置失败完整保留，不伪造整轮通过：controller-r1首次宿主夹具漏加载review_host_bridge，初始化断言resolveReviewHost未注册，hostfalse/CLI0；其observer一直等ready无UI动作，核实PID与命令行后仅终止该自有observer，真实exit4294967295。r1b补齐真实模块后，预览/工具有效，但夹具误假定隐藏命令搜索一定显示No matching，实际VSCode提供similar commands，60秒原预算到期，observer1/CLI0、hostfalse。r1c修判据后又在hover返回、子菜单尚未展开时即取文本断言，observer1/CLI0、hostfalse。r1d按真实菜单项目出现等待后全通过，未改产品/原超时，未重放任何迁移/保存/备份；各新样例、原日志和首败保留。既有controller-c6b真实功能、跨进程与版本路径存储/Git保护证据仍有效，不机械重跑全editor或整链。

据此C1–C6功能整体通过，无本轮必需产品失败。未测/限制维持：真实用户环境升级重复配置原因为未知，隔离版本路径仿真不等于原环境复现；无实网AI/论文上传、cleanup后段、完整独立PDF/translation、冷启动/复杂真实论文、Mac/强杀/五分钟定时或AI质量对照。所有真实论文/批注/草稿/范围外暂存与全局配置保持保护。用户随后明确恢复silent-ui-screenshot对完整宿主流程的无感要求，旧直接Code.exe/cli.js --new-window夹具未证明隐藏或不抢焦，保留其有效产品证据，停止旧启动方式，单独补下述宿主行为核验，不重放业务链。

无感补核新根`D:/latex-writing-checks/choice-settings-20261122/controller-hidden`：仅外置夹具，以Windows现有CreateDesktopW创建未切换的独立桌面，CreateProcessW显式lpDesktop=winsta0\\TeXScholarHidden93e697f2a6594f8797610aeb52478602启动正常Development宿主，无SwitchDesktop、不改变用户活动工具/剪贴板/键鼠。实际EnumDesktopWindows确认Chrome_WidgetWin_1在该私有桌面、不在Default；输入桌面始终Default，启动前、ready时、退出后前台HWND均86837022（同pid/thread），CDP只在隐藏宿主内查看真实八项工具菜单并取消，未保存配置/正文。CLI/observer均0、host/observed true、样例正文不变；结束后无Chrome_WidgetWin_1，桌面handle已正常关闭，随后核此宿主主进程及crashpad PID均已退出。argv/env/cwd和窗口/焦点实测见run-result.json、desktop-observation.json、logs。截图`C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-a6e8debf7c5142a4b5d935d3bf5450bc.png`非空并已逐图查看（CSS视口1440×900，真实菜单渲染正常），未删除任何旧图或失败证据。完整启动/交互/截图无感不以隐藏控制台或独立profile替代证明；本次无需重复全部产品链，C6含此补核最终通过。

C7继续由原Terra执行：核实际下一版0.9.57的版本/tag/Release/输出目录唯一性；仅必要版本/MCP/发行工具检查，一次构建，源码普通push/fetch；附注tag关联源码提交及VSIX/源码包双摘要，正式Release并API核附件digest，真实CLI安装同一VSIX，execution尾提交普通push/fetch clean。不得自动reload真实VSCode/MCP，不包后冒烟；用户需再次重载对应窗口及重启MCP启用新版。总控仅最终核元数据/日志与计划索引结案。
