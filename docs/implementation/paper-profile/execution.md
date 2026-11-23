# 批注批量管理执行记录

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
