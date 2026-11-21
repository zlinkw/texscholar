# 自动 Git 备份执行记录

2026-11-21：唯一执行会话接管产品、测试和 UI 租约，开始 G1。实核 gpt-6.1-terra/high/default，原生压缩 4 次，未到接替条件。基线 master 与 origin/master 均为 4e3887cc6e32b24d74013601131372a442abbe91；计划和索引为总控本轮修改。真实论文只读，隔离夹具和日志保留。

后续上下文状态实核原生压缩 5 次，第五次后尚未再次达到接替阈值，继续原会话。G1–G3 实现：已保存源码的精确路径提交、旧内嵌状态纯源码导出、范围外暂存保留、历史任务续传、启动／保存／300000ms 定时入口、事件合并与释放、离线重试及自动说明。推送使用已核实的具体提交，避免并发 HEAD 推进夹带其他历史；手动入口保留。修改、测试和隔离 Git 仅在产品仓库及 `D:/latex-writing-checks/auto-git-backup-20261121` 中进行，真实论文未操作。

小验收使用现有 `src/backup.test.js`、`src/inline_review.test.js` 和 `scripts/check.py`；所有测试串行，测试目录、实际 stdout/stderr 和失败日志保留在上述隔离目录。备份定向 Node 命令均使用 `node --test --test-concurrency=1 --test-name-pattern=<下列模式> src/backup.test.js`，环境 `LOCAL_LATEX_GIT=D:/Git/cmd/git.exe`、`LOCAL_LATEX_PYTHON` 为当前 Python、`PYTHONPATH=D:/GitRepo/texscholar/scripts/test-support;D:/GitRepo/texscholar/src`。命令将 stdout/stderr 合流保存，未把合流日志称作分离日志。

- `g1-g2-automatic-first.log`：模式 `saved backup|automatic saved checkpoint|offline automatic push|automatic backup refuses|automatic checkpoint refuses|acceptance during a background|automatic checkpoint preserves`，11 项，退出 0。覆盖旧格式脱敏、手改、部分暂存、BOM/EOL、hook、离线、远端分歧和接收期间排队。
- `g2-events-concurrency-first.log`：模式 `saved backup schedules|saved backup rejects a source|saved backup commits author|saved backup uses the normal`，3 通过、1 失败，退出 1。测试误以为 hook 中写入会改变 Git 已捕获的快照；实际旧快照被正确提交，新磁盘改动保留。修正断言并增加后续检查，`g2-events-recovery.log` 中该项通过。
- `g2-events-recovery.log`：模式 `saved backup uses the normal|saved backup schedules|saved backup preserves a later|saved backup restores a pending legacy|saved backup works without a review`，4 通过、1 失败，退出 1。旧任务完成后状态读取派生 `published_version`，首次断言错误地要求整个显示对象不变；保留原始 owner 字节及未决条目、决定和版本的准确断言后，`g2-legacy-fixed.log` 对应项退出 0。
- `g3-concurrency-first.log`：模式 `saved backup pushes only|saved backup refuses to push|saved backup schedules|saved backup restores a pending legacy|offline automatic push|acceptance during a background`，6 项退出 0。覆盖并发 HEAD 推进只推已验证提交、hook 扩大范围被拒绝、旧任务恢复及处理中再次保存。
- `g3-recovery-status.log`：模式 `a later backup failure|saved backup skips an unchanged|offline automatic push|saved backup schedules|saved backup starts after`，5 项退出 0。覆盖续传后的独立失败、无变化不 fetch/push 和首次保存发现项目。
- `g3-events-final.log`：模式 `saved backup schedules|saved backup starts after`，2 项退出 0；`g3-privacy-multiproject.log`：模式 `saved backup keeps separate|saved backup retains its local commit`，2 项退出 0。覆盖项目间独立定时与释放、未验证私有远端不推送。
- `python -X utf8 scripts/check.py --group editor` 首次退出 1，原因是漏配实际 `LOCAL_LATEX_FORMATTER` 和 `LOCAL_LATEX_WORKSHOP`，原始 stdout/stderr 在 `editor-e25d5390c1a0427391682015d13a6daa/`。补齐 `C:/Users/ZLK/AppData/Local/Programs/LocalLaTeXTools/tex-fmt.exe` 及已安装 `james-yu.latex-workshop-10.20.0/out/src/lint/latex-code-actions.js` 后，同一命令 133 项通过、退出 0，原始分离日志在 `editor-9549516168d540959f23f71560b7a45f/`。随后仅重试入口参数调整，`node --test --test-concurrency=1 src/inline_review.test.js` 29 项通过、退出 0，日志 `g3-inline-consumer-final.log`。

未执行含真实清理的 backup 全组后段，不宣称该组全通过；未改 checkpoint 清理接口，旧任务恢复由实际隔离 Git 定向覆盖。未运行独立 backend、PDF、translation 组。上述隔离远端执行真实 Git commit/fetch/push，但以 fixture 替代 GitHub 元数据和远端地址，不冒称真实 GitHub 论文上传。尚待总控独占 G4 和明确通过后的 G5，未发行或安装。

## R1：保存型备份状态的持久化和消费者

总控 G4 在 359fde0 的真实隔离 VS Code 场景中发现：源码已正常提交和推送，但 `source_review.status` 仍报告旧投影失败；G4 尚未通过。原始证据由总控保留在 `controller-g4/`，本角色未操作该夹具。接回租约后，将保存型排队、处理中、本地待上传、失败和已确认远端结果写入既有备份日志；实际新事件排队时，旧任务完成不能覆盖新任务状态。`source_review`、卡片及 MCP 上下文读取新状态，单独提供 `saved_backup_job`／`saved_backup_done`，旧 `auto_backup_done` 仍是原源码快照，旧失败、旧任务和 published 字段不删除；无审核批次及旧版已完成的保存型记录也可读。不更改审核决定、候选版本或批注。

本次新增定向测试均为隔离夹具、真实本地 Git 或既有 MCP 后端调用；真实论文未操作，GitHub 元数据由 fixture 替代。完整合流输出及退出码保留在同一证据目录：

- `r1-status-final.log`：`node --test --test-concurrency=1 --test-name-pattern='saved backup status|saved backup records offline|acceptance during a background|offline automatic push|a later backup failure|saved backup restores a pending legacy|saved backup skips an unchanged' src/backup.test.js`，8 项退出 0。
- `r1-status-race-final.log`：同命令模式 `saved backup status supersedes|acceptance during a background`，2 项退出 0。额外核验旧版已完成记录的兼容读取、本地待传、后续事件排队及旧提交完成后仍显示新任务排队。
- `r1-no-review-final.log`：模式 `saved backup skips an unchanged|saved backup works without a review|saved backup records offline|saved backup status is readable`，4 项退出 0。
- `r1-mcp-first.log`：`python -B -X utf8 -m unittest mcp_test.MCP.test_ai_context_uses_saved_backup_status_and_preserves_legacy_snapshot mcp_test.MCP.test_new_project_context_and_begin_use_external_state mcp_test.MCP.test_scoped_ai_context_preserves_rules_sources_dependencies_and_notes_without_ui_data -v`，3 项退出 0；覆盖新旧状态、无审核批次和现有 AI 范围读取。
- `r1-backend-consumers.log`：定向执行 `native_review_test.NativeReview` 的 `test_sidecar_backup_preserves_source_conflicts_and_backup_journal`、`test_sidecar_checkpoint_preserves_all_rounds_versions_and_notes`、`test_preparing_block_alone_is_not_a_source_checkpoint` 及 `source_review_test.Flow` 的 `test_edit_feedback`、`test_state_only_saves_are_atomic_without_interrupted_intent`，5 项退出 0。无删除回归。
- `r1-inline-metadata-final.log`：`node --test --test-concurrency=1 src/inline_review.test.js`，29 项退出 0。原 G1–G3 的 editor 133 项有效覆盖未因本轮状态字段补齐而机械重跑；backup 全组清理后段及独立 PDF、translation 组仍未运行。
- `r1-metadata-serialization.log`：模式 `acceptance during a background|a save arriving during local backup|a failed queued commit|saved backup restores a pending legacy`，4 项退出 0。状态写入与同一项目的本地备份元数据串行，覆盖保存发生在本地提交期间、旧任务恢复及 hook 失败原因的持久化，不新增自动重试。

## G5：版本与交付

总控已明确通过 G4 并移交交付租约，最终补验证据与限制见 plan.md。确认本地及远端无 v0.9.52 标签，GitHub 未找到该版本 Release；版本改为 0.9.52。版本相关 MCP 2 项和发行工具 12 项通过、均退出 0，日志 `g5-version-check.log`、`g5-release-check.log`；发行工具中模拟 EOF 的测试按设计重试读取并通过。

仅一次本地打包 `python -B -X utf8 scripts/build.py --output dist/v0.9.52`，退出 0，日志 `g5-package.log`。VSIX SHA256 `e8430551c62aff17d90300f192a0573536d3ebd58f677e958688f82cabde9db0`；源码包 SHA256 `8bc0e08dc83a66ad321bc532c18db90c3f20fe09f74afb7a55362fc33cde6c7c`。后续发布与安装复用这两份产物；尚待提交、正式发行及安装。

源码与版本提交 `8450284994cdee1436935d8428d4ea2fa46e5047` 普通推送后 fetch 一致；附注标签 `v0.9.52` 指向该提交，包含上述双包摘要，普通推送退出 0。`python -B -X utf8 scripts/publish_release.py --tag v0.9.52 --repo zlinkw/texscholar --artifacts dist/v0.9.52` 退出 0，[正式 Release](https://github.com/zlinkw/texscholar/releases/tag/v0.9.52) 的附件摘要与本地一致、非 draft 且非 prerelease。`code --install-extension D:/GitRepo/texscholar/dist/v0.9.52/texscholar-0.9.52.vsix` 退出 0 并报告安装成功；有 Node `url.parse` 弃用警告。日志 `g5-commit.log`、`g5-push.log`、`g5-fetch.log`、`g5-tag-push.log`、`g5-publish.log` 和 `g5-install.log`。未包后冒烟或自动重载 VS Code/MCP，真实论文未操作；含清理的 backup 后段、独立 backend 全组、PDF、translation 未运行。
