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