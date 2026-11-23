# 批注批量管理执行记录

## P7 只读调查与 P R1

现任执行 local/01a20284-4ad8-70b1-87ff-61225eaec6aa；P 返修 1。总控移交产品/测试/UI/隔离配置/Git 租约，仅修迁移冲突写入边界；真实论文和真实资料库仍无写租约。用户已明确由代理一次性迁移，完成验证后再发行安装；本阶段不重载、不重启、不发行。

只读调查基于 controller-p7-preview1 冻结副本，HostSession 显式禁用。P7-analysis-first/second/third 均 exit 0，脚本、process、stdout/stderr 和逐项结果保存在 D:/latex-writing-checks/paper-profile-20261123/P7-analysis*。68 个待审/返修项中 65 项现有精确锚点可核：以最近合法独立行边界构造的 65 个候选块互不交叠，纯内存 prepare 全部成功，最大 12 行；这不是现有迁移器支持的映射，也不是源写入或完整迁移通过。原 29 项宽段落范围交叠实际分 7 组，原始精确编辑片段无交叠；bg/bh 两处行内插入和 dy/dz/ea/ef 四处边界可在保留精确偏移下置于独立行块。aq/ar/115 原文均为空插入、120 字符左右上下文不能同时匹配：前两项仅左上下文各唯一，115 仅右上下文唯一，单侧证据不足以确定插入点，不可猜测或静默丢弃。

局部注释复核发现原 85 对精确映射漏了 main 中缩进的两对：160–166 figure 和 631–635 paragraph，故按宽松缩进解析共 87 对纯注释；剩余 5 个未配对尾标记为 main 201/586/748 与 response 320/1079。总数以只读解析为准，不能把配对等同于适用范围已核实或授权删除；精确内容保留外置结果。CODEX-QUESTION 被 questions.js 解析为实际问题关联，CODEX-RESPONSE 及 QUESTION 在 document_roles.py 亦参与旧角色识别，旧写作指南仍使用 RESPONSE 依赖和 QUESTION 语义；不得当普通冗余注释批量移除。P 的 entry 支持 text/evidence/source/scope，scope 是自然语言字符串，范围不自动绑定位置；每条须精确保留来源和适用范围并核消费者，未知内容保留原位。

实际反例在全新合成项目：p7-r1-repro-first exit 1，缺锚点例真实产生 schema3 无块项，第二例的 itemize 夹具未构造出预期交叠，断言失败；p7-r1-repro-second 用新根、章节相邻样例 exit 0，实际重现缺锚点及交叠项被 prepare 切为 schema3 且缺 block。两轮没有连接任何真实管道、论文或资料库。代码修复在 prepare 的完整预览相等校验后拒绝非空 conflicts；apply 在取得宿主前对提交与当前预览均检查冲突，防止绕过或占用宿主；合法路径保留原校验和事务。

p7-r1-tests-first exit 0 为初版 6 项；增加 CLI 与 MCP 并最终修改输入后，p7-r1-tests-second 和 third 各 7 项 exit 0。third 使用 SOURCE_REVIEW_FIXTURES=p7-r1-test3、PYTHONPATH=仓库 src，启动前静态导入确认 review_host_test_support 为仓库 FakeHostSession；CLI 子进程专属 sitecustomize 把任何 HostSession 调用设为立即报错。定向覆盖缺锚点、交叠、伪造空冲突、prepare/transaction/apply、真实 CLI 及 MCP 调用的零写/无宿主，保留原有无冲突迁移、过期预览测试。无真实 UI、实网、完整后台或真实迁移；未运行 cleanup/backup 删除组。原 P6 局部未变链按原证据复用。

现任执行者：local/01a20284-4ad8-70b1-87ff-61225eaec6aa，Terra 6.1/high；N 产品、测试、UI、隔离配置和 Git 租约。总控维护 plan/index。N 返修计数 0。

基线：master 与 origin/master 均为 aa7540b64c4c5bf172e43103d73764354188509f，工作区及暂存为空。N1 调查与实现进行中；N2 尚未验证。真实论文、配置、活动宿主及安装不操作，禁止文件删除和 cleanup 后段。

已核发现：当前新批次 `begin` 会清空全部旧 edits；与本代保护所有旧未处理批注的要求冲突，需要在本轮处理，不能让暂留或旧开放批注随批次丢失。返修的 previous_feedback 是快照，当前 requests 可能有相同身份，批量操作必须避免重复或遗漏。

首次静态语法检查：`node --check src/review_workbench_client.js` exit 1，新增语句插入原 if/else 中间；调整语句位置后待重验。`node --check` 对宿主和 inline 文件各 exit 0。一次只读搜索包含不存在的 tests 目录而 exit 1，未触碰数据。

`n-backend-first` 外置执行器 exit 1：指定的隔离 cwd 尚未创建，WinError 267，子进程未启动；保留该失败，不重放该名称。随后另建独立目录和证据名。

`n-backend-second` exit 1：故障注入误指定 FakeHostSession.write，sidecar 纯状态保存实际调用 Review.write，因此未触发预期异常；样例已改变，不重放。已改为注入真实写入边界，后续另用新目录；完整 stdout/stderr/process 保留在 review-efficiency-20261122 同名前缀。

N1/N2 实现：审核页“更多 → 批注管理”支持范围多选、暂留/取消和确认删除；无待审卡片可通过“LaTeX 审核：管理论文批注”。选择独立于候选批接；管理以 repo/owner/session、项 ID、当前版本、文件、批注 ID/版本与完整快照预检，sidecar writer 锁及 SHA CAS 下整批一次保存。原 requests 与同身份 previous_feedback 镜像一起处理，上一版独有批注可单独管理；缺稳定身份或旧内嵌状态明确拒绝。保留未处理旧版本、暂留标记和对象引用；接收不会自动关闭暂留批注；返修、checkpoint、交接及 MCP 反馈消费相应保护。新批次对未处理/暂留批注拒绝清空，零写且不提供绕过。现有旧测试对自动丢弃未处理旧批注及其基准的断言按本代明确保护要求改为验证保留；合法无未决批注的开批、旧版本拒绝原断言仍在。

验证证据根 D:/latex-writing-checks/paper-profile-20261123：backend-first exit 1，源自 7 个 Git 测试长路径、缺 SOURCE_REVIEW_GIT、旧期望及旧批注身份处理；backend-second exit 1，剩余一项旧版本丢弃断言与新要求冲突，该轮运行期间源代码亦有修改，不作最终覆盖。短隔离根 b3 的 backend-third exit 0，150 项（执行时 SOURCE_REVIEW_FIXTURES 和 LOCAL_LATEX_TEST_ROOT 均为 b3，SOURCE_REVIEW_GIT 为已发现 git.exe；runner process.json 未记录 SOURCE_REVIEW_FIXTURES）。之后仅修改 MCP 反馈选择及相关旧版收据判断，mcp-final 首次 exit 1 为新夹具把项目设为 accepted 后先命中已接收未备份保护；保留该结果，调整断言顺序后 mcp-final2 46 项 exit 0，包含实际 MCP 及旧版本独有暂留、文件/批次快照、失败零写。native-target-first exit 1 为旧测试仍要求丢弃需保留的版本；native-target-second 四项 exit 0。previous-target-first 两项 exit 0，后续被 mcp-final2 的更新测试覆盖。editor-final 首次 exit 1，隔离根未先创建，测试夹具 mkdtemp ENOENT；全新 editor-final2 的受影响两个 editor 测试文件 79 项 exit 0。未运行 backup 组或 cleanup apply=True。

正常 Development 隔离 UI：ui-n4 setup/prepare/stage/run 均 exit 0，真实宿主/观察器均 0；三条跨正文与回复批注全选暂留，删除确认取消零写，再准确删除一条、其余保留，源及范围外 stage 未变。前/中/后输入桌面 Default 与前台 HWND 20580124 一致，GUI 不在 Default，私有桌面关闭；截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-0c373d49b73042ab8a4ef1628f07d2ca.png 已实际查看。fixture 创建使用合成数据及 FakeHostSession，实际 UI 操作经正常 Development 宿主桥和 Python 后端；prepare 启动时 sitecustomize 曾报告模块搜索警告，进程实际 exit 0。旧 ui-n1/n2 的有效局部及其桌面状态见各自 logs，n1 前台窗口有变化不称一致。所有现场及首败保留，不删除文件。

待总控 N3 以新样例核跨模式重建、完整进程重启、旧批注与范围外选择/迟到动作组合；用户真实论文、真实 P 数据库、配置、活动 VSCode/MCP、安装均未触碰。N3 前不发行、不安装、不重载或重启。此前 backup-first 至少三个隔离对象误删事件与未知总数保留，不能算合规覆盖。
P2–P5：2026-11-23 用户批准继续，执行者 local/01a20284-4ad8-70b1-87ff-61225eaec6aa；context_status resolved/observed Terra 6.1/high match、continue，service_tier priority 仅记录。P 返修计数 0，持产品/测试/UI/隔离配置/Git 租约；不持真实论文或安装租约。基线 676a59b4487b486eb36fdbab955ad6fb1874aa0d，master、origin/master 一致且 clean。P 与已验收 N 分别记录，不重测不变 N。

P2 首批只扩既有 paper-background.sqlite3：同一 paper_id 下独立角色记录及 revision CAS，论文背景 revision/entries 不受角色写入影响；根关联多份 paper_id 明确拒绝、原角色 owner 不自动搬迁。该批仅存储原语，角色确认、调用链及一次性迁移尚未接通，不能作为 P2 完成。隔离测试 p-db-first：既有 MCP 测试夹具内三项独立角色/背景 CAS、旧 P 保留与显式关联 exit 0；argv、cwd、env 和 stdout/stderr 在 D:/latex-writing-checks/paper-profile-20261123/p-db-first.*。真实资料未读取。
P2/P3 本批：角色扫描可从同一 profile 的 paper_id 读取结构化登记，保留原角色拥有文件及独立 revision；无审核状态时不创建批次。GUI 确认走原宿主核验全部源缓冲并写论文资料，不向源码插入角色块；旧块只读，存在两权威时拒绝，只有一次性迁移的内部精确核验可比较同值。MCP 增加结构化 read_file_roles/write_file_roles，任务助手显示角色、可选择调整、支持多文件并在预览/附件保留真实范围。论文资料允许 scope 表示局部要求；作者约定与参考事实不等于操作授权。独立自动备份进程经宿主传入 profile，仅已确认角色允许新增源码；读取失败或结构变化不放宽。修改审核 owner 仍须明确关联，不按名称猜。

外置一次性试验脚本 p-migration1/profile_once.py 及新合成样例 p-migration2/3：先预览准确顶注、独立批注与论文资料，依次以 CAS 存原样规则/角色并读回；在内部显式匹配状态调用实际上下文、反馈和编译根读取，再经原宿主事务精确移除已证明的顶块；每一步独立记录和恢复点，中断不自动重放。p-migration3 preview/apply exit 0，较早 open、暂留、当前批注及跨正文/回复同文四条保留，状态/版本/来源以完整 JSON 对照；此为 FakeHostSession 合成逻辑验证，并非真实宿主或整套旧状态迁移通过。旧内嵌审核 DATA/计数头、非标准块和其他文件仍保留，尚需完成并验证无损迁移/身份关联，不能运行于真实论文。真实 profile 的宿主新增严格验证器：要求论文资料中已存在逐字规则和一致角色，才允许移除精确插件块；缺失或冲突阻止源写入。

测试均为新隔离根：p-roles-first/third/fourth/fifth/eighth/tenth/eleventh exit 0；p-roles-second exit 1 因只读 scan 对另一证据文件中示例状态头误认多 owner，改为仅写入时拒绝不明归属；p-roles-sixth exit 1 因指南改写后旧测试期待仍准确的 structure 字段措辞，补明后通过；p-roles-ninth exit 1 因测试源 Windows 换行转换导致规则快照不一致，固定夹具换行后通过。最终 p-roles-eleventh 58 tests exit 0。p-editor-first exit 1 因旧助手夹具未提供新增角色确认分支；补充角色输入与多文件实际断言后 p-editor-second/third/fourth/fifth/sixth exit 0，p-editor-sixth 58 tests，后加宿主脏缓冲守卫以 p-host-second 定向 exit 0 覆盖。所有失败及逐个 stdout/stderr/process 保留。p-migration-prepare 首次 exit 1，fixture import 已创建目标目录；使用新 p-migration2/3 目录修正，无重放。p-backup-reject 受控实际独立 Python exit 2，原因是新增 TeX 导致结构变化未确认；前后隔离 Git HEAD 与 status 一致，未执行提交/cleanup；不冒称后台成功备份通过。其他实际 Git/PDF、实网与真实用户环境未测。

本批仅为中间实现和局部检查；正常 Development 真实场景→角色→多文件→附件、跨进程背景/角色、旧状态无损迁移与真实宿主检查仍未完成，P2–P5 未冻结，P6/P7/P8 未开始。全部保护与原 N 误删事故记录不变。
正常 Development 论文助手局部：p-ui1 观察器未等待 QuickPick 即输入，隔离编辑器出现未保存文本并在原 60 秒超时；host 0、observer 1、外层 1，无附件，不能算通过，截图 ui-c3bac627adbc4a8091e603f6ffbdf370.png 留存。全新 p-ui2 的 setup/prepare/stage/run、host/observer 均 exit 0；真实 VS Code Memento、宿主桥，选择回复任务、进入角色确认并保存默认角色、选择 main.tex 与 reply.tex，预览后实际捕获附件；源、审核状态和范围外暂存前后一致。前/中/后 HWND 20580124、输入桌面 Default，GUI 位于私有未切换桌面且已关闭；截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-7481d6013d81485bb1199d10bd1344d4.png 已实际查看。角色调整界面虽打开但未改变具体角色，不能算角色修改验证；该夹具默认将回复文件推断为 manuscript 并由模拟作者确认，仍需新样例真实更改角色及取消。实际附件未发送 AI。

助手角色摘要、文件选择和最终预览现显示既有中文角色名，附件中的机器角色 ID 不变。p-editor-seventh exit 1，59 项中三项因漏设 LOCAL_LATEX_PYTHON 导致子进程启动参数为空及配置测试失败，首败保留；新隔离 p-editor8 正确显式设 C:/Python314/python.exe 后 p-editor-eighth 59 项 exit 0。runner process 只记录部分环境变量，实际还设置 LOCAL_LATEX_PYTHON，完整日志按原前缀保留。

正常 Development 新隔离 p-ui3：setup/prepare/stage/run、host/observer 均 exit 0。真实交互选回复任务→逐项调整 reply.tex 为“回复信”、编译入口未指定→保存角色→使用已保存角色→多选正文和回复→预览并加入隔离附件；预览中文角色，附件 machine ID 为 response，源、状态与范围外 stage 完全不变，未发送。前中后 HWND 20580124、输入桌面 Default 不变，真实窗口在私有未切换桌面且已关闭。截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-62ceea198c324f4a852dd0cf6760caf3.png 已查看；此轮未证明取消和跨重启。

p-migration4-check exit 1：对比旧审核项时错误地删除新 anchor 后将其与仍含旧 anchor 的项比较；旧 schema 迁移需要按新块建立 anchor，失败不代表旧批注不一致。保留全部原始预览及失败；全新 p-migration5 只读语义比较准备结果，排除新旧不同锚点后其余全部项目字段、版本及独立批注、批次、计数一致（exit 0）；已创建隔离恢复对象，尚未执行真实宿主事务和迁移后读取，不能称旧状态迁移通过。

保护事件：p-roles-twelfth 13 项、6 项 error、exit 1；因漏设 PYTHONPATH，测试对默认审核宿主命名管道以隔离 fixture 根申请事务，六次在 reserve 阶段被拒绝，日志为“宿主资格已失效或存在多个宿主；未提交正文”，不能据此判断默认宿主身份或真实环境绝对零副作用。总控已告知用户；无真实论文路径或成功提交证据。p-roles-thirteenth 显式配置隔离 test-support 后 13 项 exit 0，但启动前未单独校验导入；以后由测试入口执行本地导入自检，未通过不启动测试。只读核对本代现有 p-roles 系列 argv/env：除本次 twelfth 外均记录 test-support；p-db-first 未加载该模块，但其 MCP.setUp 显式调用 NativeReview.setUp 以 mock 替换 HostSession，三项背景数据库测试 exit 0；p-migration2/3 apply 均记录 test-support，p-migration4/5 的 NativeReview.setUp 同样显式替换 HostSession，check 只调用 preview/prepare 不连接宿主；p-ui 各项使用独立 pipe。现有相关日志中该宿主拒绝仅出现在 twelfth，无法据此推断未记录的其他环境。

p-ui4 首次旧状态真宿主迁移样例失败：外置 fs.watch 同一 start 文件触发两次，两个 worker 竞争，首个被锁拒绝，观察器据此失败并关闭宿主，另一 worker 随后连接中断；保留其未知现场，未重放。全新 p-ui5 限制该外置触发仅启动一次，setup/prepare/stage/run 及真实 Development host/observer/worker 均 exit 0：旧内嵌状态真实事务迁至 sidecar，较早 open、上一版暂留与当前正文/回复同文四条批注及 ID、版本、计数、批次读回一致，候选重定位可检查；随后规则/角色先入独立 P 并读回、用真实宿主去除准确顶块。范围外 stage 保持；截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-89b493d5ddf74c0886eac7ff1ac3c62f.png 已查看。旧审核迁移通知及计数头仍待单独安全去除，不能将此算整体迁移完成。

旧审核机器头处理：外置状态已完成、legacy_owner 与旧源匹配、计数一致、论文资料角色已确认且持原锁时，宿主只移除已识别的状态封装、计数和迁移通知；保留头内普通作者注释。未知机器字段、旧数据、状态不一致、源／状态变化或脏缓冲均拒绝。宿主把 sidecar 作为精确快照检查项，事务中复核；不删除文件或对象。新隔离 p-ui6 实际 Development 宿主中，从旧内嵌迁移、角色/规则接管到去旧头依次真实执行，四条批注、版本、反馈及定位读回，作者注释和范围外 stage 保留；worker/host/observer/外层 0。输入桌面 Default 及前中后 HWND 20580124 一致，GUI 在未切换私有桌面且已关闭；截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-9ff2284badca4126beb8c5ef11746f7c.png 已实际查看。预先本地核实 sitecustomize 位于 p-ui6 并指向专属 p6 管道，无默认管道探测。

选区快速入口保留原有用途：已确认角色写入附件；未确认/结构变化明确提示先核对，选区仍可作为只读上下文，不自动要求三方案。p-editor-ninth 60 项 exit 0；p-native-second 三项 exit 0，其外置执行器先校验测试替身和本代 fixture 根才运行。取消和跨进程/旧格式中断组合仍需补齐。

Git 旧版多轮样例：p-gitold1 使用隔离真实 Git 对象构造两个旧批次及同文不同位置独立批注，准备阶段 exit 0；p-ui7 将角色顶注在候选锚点创建后插入，预览对两个旧项报定位不唯一并在事务前拒绝，worker/host/observer/外层失败，保留现场；该拒绝不能当无损迁移通过。全新 p-ui8 在创建候选前放置旧角色/规则，正常 Development 真实宿主将两个 Git 旧批次转 sidecar、迁角色规则并去旧头，阶段 exit 0，两个批次的源基准、条目/状态/计数、同文两条独立批注与暂留状态经版本映射读回，范围外 stage 不变。宿主前中后 HWND 29166230、输入桌面 Default，GUI 不在 Default 且私有桌面关闭。截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-f1aa6226427342fa95f1d956e41ca31c.png 已看。独立 p-ui8-map 首次 exit 1：旧 DATA 的 next 在头部计数而非 JSON，修正读取后 map2 exit 1：直接比较 Git 字节与 API 返回字符串；未写源，map3 解码后 exit 0，逐项核对不同 note ID、held、版本内容与两个批次。p-ui8-locators exit 0，去顶注后两处仍可实际定位与读取反馈。由 p-ui6 合成结果复制出的 p-continue1 使用精确 previous_feedback 身份取消一条暂留并保存，其他三条、其他状态和源逐字保持（FakeHostSession，exit 0）。

正常 Development p-ui9：明确保存 reply.tex 为回复信后，在任务范围选择 Esc，真实角色读回仍为 response/null，未创建附件，源、审核状态和范围外 stage 不变；setup/prepare/stage/worker宿主/observer/外层 0。前中后 HWND 29166230、Default 不变，GUI 位于未切换私有桌面且已关闭；截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-7e2731e8722c4f2fb84afccee0d0cfeb.png 已查看。

恢复与调用方：p-recovery1 受控在 P/角色分别 CAS 后、源码写入前中断，源未改变；仅新隔离资料和 FakeHostSession 下 resume_once.py 核原预览/源/状态/论文资料及 MCP 消费后续接，exit 0；再对已完成结果以禁止任何写函数的注入验证，确认无重复写/消费，exit 0。此不证明跨 SQLite 与源天然原子；review_migration 原事务另保留对象及 recovery_preview，冲突或未知格式需人工停止。p-retire1 从已完成侧车样例复制并明确关联到新身份后，以独立 retire_header_once.py 预览/受控宿主替身执行，均 exit 0；真实宿主对应路径是 p-ui6。p-export-first 对新隔离复制源执行真实 source-only export，源未变、无上传，P SQLite 和审核哨兵/TS 标记不入导出（exit 0），不声称备份含私有资料。p-backup2 真实独立进程使用已确认新文件角色通过角色关口，随后被事先配置的 Git 内容转换保护拒绝，真实 exit 2；HEAD、范围外 index 和 status 不变，也未执行 cleanup。它只证明角色许可到达下一校验，不冒称成功提交/推送；p-backup-reject 是角色变化时的零写拒绝。

一次性协议的隔离原型及对应恢复脚本集中于 D:/latex-writing-checks/paper-profile-20261123/p-migration1：profile_once.py、resume_once.py、retire_header_once.py；先由原 review_migration 的 preview/显式 apply 按唯一位置和批注版本映射转换旧内嵌状态，冲突则停止；随后角色/规则 CAS、消费者读回、宿主校验后切换源码，最后仅对已迁 sidecar 且旧 owner/计数一致的头预览并保留作者普通注释。p-ui6/worker.py 和 p-ui8/worker.py 是受控组合夹具，不是可对真实论文直接运行的命令；旧格式、颜色、分散文件和实际审核身份须 P6/P7 单独核定。脚本的恢复记录含预览和源快照，应保留在受保护本地位置，不能当源码备份上传。未用真实论文、真实 P 库或真实宿主执行此协议。

指南消费者复核发现 writing、question 和 collaboration 指南仍有“规则写入源码顶部”的旧指令；已改为论文资料及范围，并保留旧注释迁移前可读。旧内嵌 rework 需显式 discard_annotations=false 才保留当前批注，已如实注明；README 的旧记录说明同步。p-roles-fourteenth 58 项中 1 项失败：修改指南标题后 MCP 模块按旧标题抽取，导致相关章节丢失；已修复实际抽取调用方，新隔离 p-roles-fifteenth 58 项 exit 0。之后仅补指南/README 的明确旧格式保护措辞，p-guide-first 定向规则加载 exit 0；两次均由外置自检确认 FakeHostSession 及隔离根。

P5 冻结候选：产品/指南源码 0cde2c9d2ea1386219b538e4abd73557d513462b；本记录尾提交由交包中的实际 Git 结果给出。补充真正可供 P6 审核的外置 legacy_once.py：预览拒绝定位冲突、旧颜色和身份不完整批注；写前在原 writer 锁中预备转换对象，逐项核完整状态、旧/新版本与批次源基准、每条批注映射，再经实际宿主提交并读回；失败保留事务现场，不自动恢复。p-legacy1 Git 模式双批次与 p-legacy2 文件对象模式旧版本批注分别通过预览/映射预检；p-ui10 用该原型、全新 Git 双批次及正常 Development 真实宿主完成旧状态转换，再执行论文资料接管与旧头处理，setup/prepare/stage/worker/host/observer/外层 0。前中后 HWND 29166230、输入桌面 Default，宿主不在 Default 且私有桌面关闭；C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-37b92f1f2ea9453daa38d05a45495616.png 已实际查看。p-ui10 合成数据仅两条旧批次批注，更多旧版本、暂留及跨正文回复以 p-ui6 四条和 p-continue1 补充，不称覆盖真实论文格式。

P6 仍须独占补跨进程/安装路径资料身份、下一任务/反馈和后台消费者组合、实际中断恢复及旧未决批注跨重启可见/可继续处理；原对象或资料与真实目标不同、颜色/旧块未知、未完整定位、既有 P 冲突、中断及源脏稿均停止对应处理。自动备份成功提交/远程推送、真实论文、真实用户活动宿主/安装、实网 AI 和跨平台未测。P8 未授权；P6 明确通过之前不执行 P7。禁止 cleanup、文件/对象删除及重载/重启。除已披露默认命名管道拒绝事件外，没有真实论文路径请求或已取得默认宿主事务的证据，不扩大断言为真实环境绝对零副作用。
