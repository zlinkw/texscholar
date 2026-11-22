# 选择式交互与配置持久化执行记录

2026-11-22：按已批准计划接手 C1–C5。基线 dcdf947，master 跟踪 origin/master；真实论文及其状态、草稿、范围外暂存均受保护。产品、测试及隔离 UI 租约归执行者；总控负责计划和 C6。尚未验证或发行。

只读准备：实核本会话 gpt-6.1-terra/high/default，连续性 match/continue、4 次压缩。读取计划、索引与交付技能。尝试读取不存在的 src/mcp_setup.test.js 返回文件不存在；后续定位实际测试入口，不当作测试通过。

C1/C2 开发中：任务选项、项目和范围、区分指令、说明预览及成功类别记忆；配置引导分流。保留程序调用目标与写作选区入口。C3/C4 同一候选开发中，尚未冻结。C1 定向 src/writing.test.js：首次 c1-writing exit 1，新增测试夹具在查找元素时错误多次 shift，修正后 c1-writing-2 exit 0（11 项）；完整 cwd、argv、环境与 stdout/stderr 在 D:/latex-writing-checks/choice-settings-20261122 对应目录。非产品缺陷。两次未加引号的 node --check 因 PowerShell 将空格路径解析为 C:/Program 而 exit 1；改为调用运算符并引用路径后 backup.js 和 mcp_setup.js 语法检查 exit 0。当前仍需备份、配置、工作台受影响回归及规定 editor 组。

隔离 C3 取消测试 c3-cancel exit 0（1 项），实际 Git 状态、文件及模拟脏缓冲保存调用均未改变。editor-final-1 组 exit 1（163 项中 11 失败）：执行环境误设 LOCAL_LATEX_TEX_FMT 而非测试所需 LOCAL_LATEX_FORMATTER，真实 tex-fmt 无法启动，相关失败保留原日志；不是组通过，需以正确变量重跑规定组。

editor-final-2、editor-final-3 使用正确 LOCAL_LATEX_FORMATTER，均 exit 0、164 项；后续仍有 C1/C3/C4 产品修改，需最终候选重新验证。c1-integration-1 exit 0（11 项），含实际命令模拟附件和任务类别；setup-1 exit 0（7 项），含插件自有旧路径迁移、未托管路径拒绝和设置取消；c3-target-3 exit 0（3 项），含两入口取消不保存、确认后仅所选缓冲保存，所选目标因非 GitHub 远端被实际拒绝；c3-consumers exit 0（4 项），用真实隔离 Git 和模拟 GitHub 元数据核提交推送、暂存、隐私与 hook。命令、环境和完整输出各目录 process.txt/stdout.log/stderr.log。原 cleanup 后段及独立 PDF/translation 全组未跑。

工具设置的 package.json 现有 scope 为 machine，不能从工作区或论文目录指定可执行程序；选择界面只提供用户机器级设置，保留该安全边界。尚需总控 C6 真实跨进程、隔离版本路径和真实 UI 验证，不能将模拟 Memento 当持久化证明；用户原环境升级反复配置的具体根因仍未知。

最终产品候选的 editor-final-4 exit 0（164 项），完整命令与环境在目录 process.txt；后续仅修改 backup.js，故 editor 覆盖不失效。c3-final-stage exit 0（8 项），包括实际隔离 Git 正常推送、已暂存范围外文件逐字保留、所选文件与已有暂存重叠时拒绝、拒绝公开目标和 hook；同时覆盖两入口取消和仅保存选中脏缓冲。普通项目备份可保留范围外暂存；审核成果检查点沿用原有整暂存区非空拒绝，保护但不备份，不能声称此入口支持带范围外暂存完成推送。未运行真实 cleanup 后段，未做真实 UI 跨进程或原用户环境升级测试。

editor-final-5 对更新后的公共 backup 模块再次运行规定组 exit 0（164 项）。随后仅在备份按钮增加选择项与手动暂存重叠的提前拒绝，并扩展该按钮测试；c3-overlap-final exit 0（3 项），确认重叠在保存脏缓冲前拒绝。该后续变化不触及 editor 命令或共享后端；组合覆盖为 editor-final-5 与 c3-overlap-final。所有执行日志均保留，未将首败改为通过。

R1：总控 C6 正常 Development 功能、跨进程及 Git 组合有效，但预览暴露内部协议、工具名和命令入口不够易懂；原始证据及驱动失败见 plan 的 C6 节。此前仅按旧档位规则短暂只读待命；新规则下实际 gpt-6.1-terra/high/priority，match/continue，4 次压缩，继续 R1。

预览现只展示任务、聊天、项目、实际文件/选区及前后文、可选补充和不发送/不接受提示；完整协议与精确定位仍在最终附件。八项工具显示中文用途及工具名，内部键作次要信息。修改任务/配置命令标题；三个仅打开审核页的重复命令从命令面板隐藏，原 ID 仍注册并可从审核页使用；四个块/迁移/宿主恢复命令移至 LaTeX 编辑器右键“原文审核与批注 → 审核高级操作”，旧 ID 不变。README 给出入口。原功能/持久化和暂存保护继续复用 C6 证据；未修改业务事务、配置作用域和发行状态。

R1 定向检查 cwd D:/GitRepo/texscholar，argv `C:/Program Files/nodejs/node.exe --test --test-concurrency=1 src/writing.test.js src/setup.test.js src/menu_commands.test.js src/inline_review.test.js`，env `LOCAL_LATEX_TEST_ROOT=D:/latex-writing-checks/choice-settings-20261122/r1-local-2 LOCAL_LATEX_PYTHON=C:/Python314/python.exe LOCAL_LATEX_GIT=D:/Git/cmd/git.exe PYTHONUTF8=1`，exit 0、56 项；完整 argv/cwd/env/stdout/stderr 在该目录。覆盖人类可读预览与完整附件、工具菜单八项及取消、命令路由和旧注册、迁移及审核调用方。首次 r1-local-1 exit 1（19项中1失败），新增测试 mock 对缺失步骤误匹配 undefined key，修正 mock 后上述结果通过；原日志保留。未重跑全部 editor、真实 UI、清理后段及未受影响完整组；总控 C6 补验实际预览、菜单和发现性，未通过不得发行。
# C7 发行与安装

总控C6明确通过，实际角色 gpt-6.1-terra/high/priority，match/continue；基线 eb1f5aa5269594767bf633dab746d9575bed867a 等于 origin/master、clean。0.9.57 本地和远端标签不存在、发行 API 返回预期404、输出目录不存在；package 由 0.9.56 升为 0.9.57，MCP 取同一版本。已有 editor 164、overlap 3、R1 局部56和总控 C6 真实界面与跨进程证据复用；真实用户环境升级重复配置的原因为未知。

证据根 `D:/latex-writing-checks/choice-settings-20261122`。`c7-version` 实际2项 exit0，`c7-release-check` 实际12项 exit0，分别使用 MCP 及发行脚本既有测试，完整 argv、cwd、环境和 stdout/stderr 在同名前缀 process.json 和日志；版本测试 cwd `D:/GitRepo/texscholar/src`，Python `C:/Python314/python.exe -B -X utf8 -m unittest mcp_test.MCP.test_write_results_chain_without_context_rereads_and_keep_conflict_guards mcp_test.MCP.test_stdio_catalog_and_notifications_and_retired_cli_are_real_processes -v`；发行测试 cwd scripts，`C:/Python314/python.exe -B -X utf8 -m unittest publish_release_test -v`。仅一次执行 `C:/Python314/python.exe -B -X utf8 scripts/build.py --output dist/v0.9.57`，`c7-build` exit0。

源码提交 ee95ac97c3325afb6fe7ff3fdee6103b8a190f03 已普通 push/fetch 一致；附注标签 v0.9.57 对象 db202c9a7f7df84b841496e04b4d27cae8a79772，远端解引用同源码提交。VSIX `D:/GitRepo/texscholar/dist/v0.9.57/texscholar-0.9.57.vsix` SHA256 `30fad53556cb3e59a89f8c8769c29fc5e8cfea60a126bd8f069fb03d911b1526`；源码包 `D:/GitRepo/texscholar/dist/v0.9.57/texscholar-0.9.57-source.zip` SHA256 `fa695570dc1cfe7fa888fe9e45cc354c32f136b8edbe1095b2c242da9dae2ddb`，二者摘要均写入标签。首次本机标签查询因 PowerShell 未引用 `^{}` 出现 fatal，随后用引用参数核本地及远端精确解引用一致；标签推送本身成功。

`C:/Python314/python.exe -B -X utf8 scripts/publish_release.py --tag v0.9.57 --repo zlinkw/texscholar --artifacts dist/v0.9.57` exit0；正式 Release API 三附件摘要与本地一致，SHA256SUMS 为 `c9364620ac38334cdd2428b05c14090a57e590e2adcc110463401804c22f9b67`，draft=false、prerelease=false；实际请求及回执留 `c7-publish`、`c7-release-api`。首次安装通过 cmd.exe 调用包含空格的路径时语法错误 exit1，未启动安装，原日志保留；改用 PowerShell 正确引用后，同一 VSIX 的 `code.cmd --install-extension ... --force` 实际 exit0、报告安装成功，Node DEP0169 url.parse 弃用警告保留。`c7-registration` exit0，实际登记及 manifest 均为 0.9.57，source=vsix、pinned=true。

未包后冒烟或自动重载真实 VSCode/MCP；用户需自行重载窗口并重启 MCP 客户端连接。真实论文、批注、草稿、范围外暂存及全局配置未操作；未测 cleanup 后段、独立 PDF/translation 全组、实网 AI/论文上传、复杂论文或冷启动、Mac、强杀及真实五分钟定时。计划中原失败和界限保留。
