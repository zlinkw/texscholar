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
