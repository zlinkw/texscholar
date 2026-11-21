# 接收合并执行记录

2026-11-21：接管产品、测试及 UI 租约，开始 M1 保存后协调路径调查。已完整读取计划及独立检查报告。基线 `fe648be0b2dcf64162dc729ddd1e225d9195de5a`，真实论文只读；隔离夹具和日志保留在 `D:/latex-writing-checks/accept-merge-20261121`。

本会话实测为 `gpt-6.1-terra/high/default`，已压缩 6 次，第五次后最高上下文 295629，未达到接替条件。总控保留计划、索引和 M5 最终验收；最终通过前不发布。

M1 与 M2 进行中：工作台保存先进入既有协调队列，处理期间保留同步版本及草稿；有界测试复现旧自动跳转覆盖后续导航，`navigation-repro.log` 退出 1，修复后 `workbench-navigation-fixed.log` 退出 0。`inline-m1-first.log`、`inline-workbench-m2-first.log`、`native-cards-first.log` 退出 0；编辑器组 `editor-cd520ebbd14d45fabd3c237b65121494` 退出 0，之后源码有改动，最终检查仍需覆盖最终候选。

首次定向备份测试 `backup-proof-first.log` 退出 1：执行环境漏设项目既有 `scripts/test-support`，三个隔离夹具无法获得测试宿主资格；保留原失败，补齐实际依赖后重新运行，不将其记为产品通过。测试均在指定隔离目录，真实论文未操作。

备份共享锁：`backup-lock-repro.log` 退出 1，真实隔离锁期间保存队列丢失该次备份；以本进程真实审核写入结束事件衔接，`backup-lock-fixed.log` 退出 0，不使用定时重试。远端确认、离线阻断、旧回执不能放行后续接收的真实隔离 Git 检查 `backup-proof-second.log` 退出 0；固定块、独立手改、无审核/损坏元数据、启动事件和锁衔接 `backup-integration-second.log` 退出 0。

宿主计时 `host-timing` 首次 CLI 退出 0 但业务 `passed:false`：外置测试错误地调用未持写入互斥的内部方法，导致协调与接收锁冲突；未把该样本作为性能结果。新隔离夹具 `host-timing2` 使用注册命令，业务通过，接收至宿主推进三次为 776/904/1272 ms。后续合并决定回执与卡片读取，`host-timing3` 通过，首次 1277 ms、连续两次 557/561 ms；这里计时是命令至宿主下一项，不是页面可操作端到端，未配置成功 Git 或 PDF，不能作最终目标结论。实际命令、逐次后端阶段及真实业务状态保存在各目录的 `logs` 和 `host-result.json`。

`host-timing4` 业务失败：隔离宿主继承残缺 Git 环境；`host-timing5` 业务失败：观察器错误要求最终状态必须为 done，实际复核 ledger 已有远端确认且队列最后无变化为 idle。两次 CLI 均为 0，失败不当通过。`host-timing6` 业务通过：真实宿主、实际本地裸仓库提交和推送、TinyTeX 审核 PDF，GitHub 私有元数据与 URL 为夹具替代；三次宿主推进 831/910/1730 ms，存在超过 1 秒的样本。识别到目录高亮等待阻塞工作台后，将高亮留在原有串行合并队列并允许页面先解除忙碌；`workbench-reveal-first.log` 通过。

`host-timing7` 在同规模和本地 Git/PDF 后台条件下业务通过，三次注册接收命令至宿主推进 791/358/516 ms；此计时不含页面实际可操作确认。其后后台空闲状态下三项 A/B/C 批量后端事务及回执 285 ms，非页面端到端。Git 推送实际执行至隔离裸仓库并核 HEAD，私有 GitHub 元数据为夹具；最终 PDF 成功，一次在连续接收时过期的旧 PDF 任务按契约失败并保留日志。M5 仍需实际页面验收及端到端计时，不据此宣布 1 秒目标达成。

受影响权威分组：`C:/Python314/python.exe -X utf8 scripts/check.py --group backend --node "C:/Program Files/nodejs/node.exe"` 退出 0，131 项，完整日志 `backend-e3ff18c8fe854586ba3c85c693c5176a`；同命令 `--group editor` 退出 0，139 项，完整日志 `editor-72c6a2d10d854faea37224a8ac95179d`。隔离根、真实 formatter、Workshop、Git 和 Python 均按已核路径设置。`backup-automatic-final.log` 29 项退出 0，之后发现无变化状态可能掩盖损坏审核元数据的真实原因，已修正并需补跑受影响检查。含真实清理的后段不运行、不记通过。

末次修正仅涉及保存状态消息及其恢复：相同 editor 权威组重跑 139 项退出 0，日志 `editor-eea47ce1732a4872b01a4fc649dd4e65`；自动备份受影响三项 `backup-idle-final.log` 退出 0，MCP 状态消费者 `mcp-idle-final.log` 退出 0。组合上述 29 项与修正后定向结果；未运行 backup 清理后段、独立 PDF/translation 全组。定向备份实际命令为 `node --test --test-concurrency=1 --test-name-pattern=<自动备份名称范围> src/backup.test.js`，明确设置隔离根、`LOCAL_LATEX_PYTHON`、`LOCAL_LATEX_GIT`、`SOURCE_REVIEW_GIT` 和项目 `scripts/test-support;src` Python 路径；原始输出、退出码和首轮失败均保存在同一外置目录。

末次关联检查发现推进下一卡片时，源编辑器存在未保存缓冲会错误阻止只读展示；`dirty-advance-repro.log` 退出 1，改为回到既有只读读取并保留接收前脏缓冲校验后，`dirty-advance-fixed.log` 三项退出 0。同步队列身份同时限定项目、状态文件、编号及版本，避免跨项目复用同编号。最终 editor 组需覆盖此修正。

同角色接替 `local/01a1fd60-2da5-74e0-8e68-e266cf679881` 实核 `gpt-6.1-terra/high/default`，旧角色释放租约并结束后继续。新增跨项目同 ID/version 的保存并发回归：A 保存期间切换 B 并保留三种草稿，B 新版本没有同步凭证时不能误用 A 凭证或覆盖旧基准。首次 `workbench-cross-repo-final.log` 退出 1，原因是测试错误地用相同页面实例请求重载而未触发内容重发；修正夹具后 `workbench-cross-repo-fixed.log` 退出 0，命令为 `C:/Program Files/nodejs/node.exe --test src/review_workbench.test.js`，cwd 为仓库根目录。

最终 editor 命令 `C:/Python314/python.exe -X utf8 scripts/check.py --group editor --node "C:/Program Files/nodejs/node.exe"`，cwd 仓库根；`LOCAL_LATEX_TEST_ROOT=D:/latex-writing-checks/accept-merge-20261121`、`LOCAL_LATEX_GIT=D:/Git/cmd/git.exe`、`LOCAL_LATEX_FORMATTER=C:/Users/ZLK/AppData/Local/Programs/LocalLaTeXTools/tex-fmt.exe`、`LOCAL_LATEX_WORKSHOP=C:/Users/ZLK/.vscode/extensions/james-yu.latex-workshop-10.20.0/out/src/lint/latex-code-actions.js`。141 项退出 0，完整 stdout/stderr 在 `editor-ac02c0319ac947caa950717ac40960b1`。此前 backend、自动备份及定向 MCP 有效证据沿用上文，未跑 backup 清理后段及独立 PDF/translation 全组。

随后仅加强上述测试夹具，使 B 的原文草稿与 A 保存值相同，以验证旧保存回执不能误清草稿；完整 workbench 套件重跑退出 0，日志 `workbench-cross-repo-exact.log`，命令同上；其余 editor 覆盖复用未改变实现的 141 项记录。

自动备份 29 项实际 argv 为 `node --test --test-concurrency=1 --test-name-pattern "^(saved backup|automatic saved checkpoint|offline automatic|a later backup|automatic backup|automatic checkpoint|acceptance during|a save arriving|a saved event|a failed queued)" src/backup.test.js`；后续三项 argv 为 `node --test --test-concurrency=1 --test-name-pattern "^(saved backup works without a review|saved backup skips an unchanged project|saved backup records offline failure)" src/backup.test.js`。两者 Node 使用 `C:/Program Files/nodejs/node.exe`，cwd 仓库根，并使用上文隔离根、Python/Git 与测试支持路径。host-timing7 在随后脏编辑器读取和跨卡防护补丁之前测得，不能视为最终页面端到端测量；M5 仍需全新样例独立验证。

M5 返修 R1：总控 `controller-m5/ui-baseline` 真实页面按钮到下一项可操作 311/383/309 ms，27 项及延期批注保留；`ui-background2` 正常隔离本地 Git/PDF 背景 1057/430/435 ms，首项超过目标，不能声称全部小于 1 秒。之后保存块首 `Author ` 未生成新版，observer exit 1、host-result.passed=false、CLI exit 0。此前 `ui-background` observer 未等初次预览完成，驱动导致旧预览被拒，现场均保留。

R1 根因：候选锚点位于固定块起点 0，作者在块内起点插入不重叠前缀时，原 `reconcile` 将该块起点误判为不明确的内部边界；只在起点 0 纳入前缀，内部边界与选项重叠仍拒绝。`r1-prefix-repro.log` 退出 1 因漏设 `SOURCE_REVIEW_FIXTURES`；补环境 `r1-prefix-repro2.log` 退出 1 复现实际冲突；`r1-prefix-accept.log` 退出 1 因测试样本差异算法将空格归入相邻插入，修正明确内部边界样本后 `r1-prefix-accept2.log` 三项退出 0，验证生成新版、保留原版本、接收后保留作者前缀、重叠及内部边界拒绝。命令 `C:/Python314/python.exe -X utf8 -m unittest native_review_test.NativeReview.test_saved_block_prefix_reconciles_without_losing_author_text native_review_test.NativeReview.test_block_sync_preserves_nonoverlapping_edits_and_versions native_review_test.NativeReview.test_saved_batch_keeps_conflicts_independent_and_checks_source_cas -v`，设置 `PYTHONPATH=scripts/test-support;src`、隔离 `SOURCE_REVIEW_FIXTURES`。

共享协调逻辑变化后 backend 权威组 `C:/Python314/python.exe -X utf8 scripts/check.py --group backend --node "C:/Program Files/nodejs/node.exe"` 132 项退出 0，日志 `backend-293a3111c4fe4bab98148d19d5022dcf`；备份消费者 `C:/Program Files/nodejs/node.exe --test --test-concurrency=1 --test-name-pattern "^saved backup proves fixed-block acceptance after a separate safe author edit" src/backup.test.js` 退出 0，日志 `r1-backup-consumer.log`，使用原隔离根、Python/Git 和测试支持路径。未重跑无关 editor 或含清理备份后段；总控需以全新隔离页面补验 R1 和 M5 剩余场景。

总控明确 M5 通过并交回租约：`controller-m5/ui-background3` 实际页面后台场景 459/556/494 ms，块首安全保存生成 v2，真实隔离 Git 远端确认及最终 TinyTeX PDF 成功；两个过期 PDF 按契约拒绝。`ui-flow3` 的重叠冲突、草稿刷新、处理期间手动导航、重开与显式新批次门通过，详细原始状态及限制见计划。首次 `ui-background3` 旧流程因测试宿主拒绝导航 modal 退出 1；`ui-flow2` 漏传 refresh 身份导致业务失败、CLI 0，其等待 observer 被终止退出 4294967295；均保留。此前后台 1057 ms 样本仍有效，不保证每次低于 1 秒。

M6 实核 `e53e639` 与远端 master 相同，本地及远端无 `v0.9.53` 标签，GitHub 未找到该版本 Release，目标输出目录不存在；版本提升为 0.9.53。真实论文只读，未进行清理或自动重载。

版本相关 MCP 2 项及发行工具 12 项均退出 0，日志 `m6-version-check.log`、`m6-release-check.log`。一次打包 `C:/Python314/python.exe -B -X utf8 scripts/build.py --output dist/v0.9.53` 退出 0，`m6-package.log`：VSIX SHA256 `19eccc8877662c1af12e0d4658e6d7ab2e7f9e150a8d54065b3e33a10da98c6b`，源码包 SHA256 `c0037c9eaa5787700fe07ed769d56ed7cbd5f1820e036cf1193f4df0a166af40`。发布和安装将复用同一产物。

版本源码提交 `03f6cb2945e9468524d30a61503a16d10577a395` 普通推送后 fetch 一致；附注标签 `v0.9.53` 指向该提交并含双包摘要，已普通推送。`publish_release.py` 退出 0，正式 [Release](https://github.com/zlinkw/texscholar/releases/tag/v0.9.53) 的三个附件摘要与本地产物一致，日志 `m6-publish.log`。`code.cmd --install-extension dist/v0.9.53/texscholar-0.9.53.vsix --force` 退出 0，日志 `m6-install.log` 有 Node `url.parse` 弃用警告。未做包后冒烟或重载真实 VS Code/MCP；未运行含清理备份后段、独立 PDF/translation 全组及 Mac 实机。
