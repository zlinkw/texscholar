# 唯一执行登记

计划：[plan.md](plan.md)。基线：1ef578d2dc19cfb85323254eedf806bc7e7b4f48 / 0.9.49。

当前执行者：local / 01a1f82e-ba0a-7501-9797-4eba07a69ea5。context_status 实核 resolved 和 turn_context 均为 gpt-6.1-terra / high，service_tier=default，role_settings_status=match、next_action=continue；0 次压缩。
当前租约：用户总体认可修订方案后恢复；唯一 Terra 接管产品实现、测试、UI、Git 和本登记，总控保留计划与最终验收。2026-11-20 实核 HEAD=origin/master=3facb33df55402bf997bc2600802ebd72511f78d，暂存区空；本登记及 source_review.py、native_review_test.py 为本任务草稿。模型与强度实核仍匹配，0 次压缩，无在途测试或其他写入者。
最终验收：尚未开始；仅总控有最终大验收权。

后续由唯一执行者维护步骤、源码/检查基线、完整日志及真实退出码、首次失败/返修计数、未测/阻塞和交包事实。普通小进度写在此处，不逐项唤醒总控。不得删除旧失败或将未运行记通过；相同问题三次真实返修后再按技能记录经总控核实的永久踩坑。

## 当前分析

已核 source_review 的初始化、正文内 CAS 和事务恢复，以及 MCP、编辑器发现、成果检查点和归档的直接引用。当前 `state_rel` 同时表示正文 owner 和状态文件；分离时须保留旧正文 owner 的独立概念，不能把 JSON 当 `.tex` 传给 `read()`。MCP 的上下文读取与回执、编辑器的 owner 偏移更新、备份清单和 PDF 导航均直接使用该字段，需随新模式调整。现有状态缺失时的初始化与已有状态损坏须有不同入口。B1–B5 全部未完成。

正在实现 B1/B2：加入 schema 3 状态读取、显式初始化、初步发现及独立事务恢复，固定块解析、按块定位和预览正在接入；其他消费者、迁移及同步尚未完成，不可交付。定向检查 `b1-target`、`b1-recovery`、`b1-init`、`b1-mcp`、`blocks-integrate`、`blocks-unrelated`、`blocks-projection`、`blocks-conflict` 均退出码 0，完整 stdout/stderr 位于 `D:/latex-writing-checks/state-v3-target/` 的同名日志，仅覆盖测试所列后端行为。`blocks-preview` 首次退出码 1：测试夹具错误选取更早的右花括号，修正后 `blocks-preview-fix` 退出码 0。`blocks-mcp` 首次退出码 1：Windows 夹具用通用换行读取计算原字节偏移，改按 UTF-8 原换行读取后 `blocks-mcp-fix` 退出码 0。原失败日志保留。所有规定组和实际 VS Code 操作未测；B1–B5 均未完成。

块内作者原文保存和显式非重叠同步已有初稿。`blocks-sync` 首次退出码 1，原因是对重复片段的差异判断过严；修改后 `blocks-sync-fix`、`blocks-sync-multiple`、`blocks-sync-overlap` 均退出码 0。`blocks-source-save` 和备份冲突及旧格式回归 `backup-conflict` 均退出码 0。完整日志同目录保留。编辑器两套定向测试此前 26 项通过，但之后界面已有修改，证据不覆盖最终状态。单宿主桥接、迁移、完整消费者及规定检查仍未完成，不得交付。

MCP 同步预览、应用和不变内容收据检查 `mcp-sync` 退出码 0。编辑器当前两套测试 `editor-current` 首次退出码 1，原因是调用时遗漏 `LOCAL_LATEX_TEST_ROOT`；补齐隔离目录后 `editor-current-fix` 退出码 0，26 项通过。日志位于 `D:/latex-writing-checks/state-v3-editor-target/`，保留首次失败。上述均不是完整规定检查或真实 VS Code 多宿主验证。

完整 `native_review_test` 的 `native-current` 因遗漏 `SOURCE_REVIEW_GIT` 首次退出码 1；指定用户所列 Git 路径后 `native-current-fix` 退出码 0，40 项通过。完整日志及首次失败均保留在后端隔离目录。该回归不覆盖尚未实现的迁移及宿主桥接。

`mcp-current` 退出码 0，30 项通过。其后修复备份投影不能按全文件相同文字猜位置：只有投影与准备标记前正文完全相同时写入标记，否则保留冲突；`blocks-projection-fixed` 三项定向检查退出码 0。这些测试仍不代替最终全组检查。

`projection-no-guess` 退出码 0，验证投影与正文不同时接受结果保留且后台投影显式冲突，不按相同文字误关联。该保守冲突尚需覆盖完整后台备份流程。

无块绑定的旧审核项现可显示为冲突并保留候选。`unbound-conflict` 首次退出码 1，测试断言误写了既有夹具的候选原文；更正断言后 `unbound-conflict-fix` 退出码 0，原失败日志保留。迁移本身仍未实现。

成果备份入口已识别外置状态并拒绝双状态；外置状态的成果检查点保留各轮、候选版本与批注。`checkpoint-history`、`init-checkpoint` 定向检查退出码 0，后者同时覆盖初始化时批次名称不被文件名覆盖。尚未执行成果备份端到端验证。

审稿问题容器支持包含独立子块，跨越既有块边界的标记被拒绝；`nested-blocks` 两项检查退出码 0。容器直接保存当前会阻止覆盖内嵌标记；结构属性、父子块交互及完整 UI 仍需继续验证。

块登记可显式关联核实过的审稿问题原句，无法唯一匹配时拒绝；`block-question` 退出码 0。该项没有自动猜测章节或题号，实际界面链路仍未完整覆盖。

`nested-container` 退出码 0：进一步限定只有问题容器能承载子块。该结果不代表已完成宿主隔离和真实排版验证。

`mcp-range` 退出码 0，覆盖外置状态下准确候选范围及对应的源码版本回执，连同显式同步预览、应用和无变化返回。该局部验证未覆盖实际宿主写入。

旧 owner 参数在外置状态存在且该 owner 不再活跃时路由到外置状态；该 owner 仍含活跃状态则拒绝。`legacy-route` 与 `legacy-route-forward` 定向检查退出码 0。显式指定外置路径时跨项目全部旧 owner 的双状态检查仍待完善。

构造器及检查点修改后并行重跑隔离回归：`native-v3` 46 项、`mcp-v3` 30 项均退出码 0。它们不覆盖实际 VS Code 宿主和未实现的迁移。

新增受控文本事务的隔离模拟：`host-edit-sample` 和版本号契约修正后的 `host-edit-sample-fix` 均退出码 0，覆盖检查后手改、资格失效及保存期间手改。此为模拟，不证明 VS Code 真实行为、多宿主登记、宿主断连、磁盘 CAS 或跨文件事务；编辑事务尚未接入产品。

另启动隔离 VS Code 实际 API 样例：首个 `code.cmd` 启动器退出码 0 但输出无回执，不能算通过；第二个隔离实例的 `host-api-sample/result.json` 返回 `passed:true`，覆盖真实 `TextEditor.edit` 正常保存及检查后另一编辑造成的停止并保留手改。启动器本身退出码不代表测试结果。第二宿主、失联登记、磁盘 CAS 和跨文件状态事务均未覆盖，产品尚未接入该事务。

显式外置路径现检查当前轮登记文件及记录的旧 owner，双状态直接停止；全项目发现入口仍负责发现范围外 owner。调整新测试夹具为非双状态后，`native-dual` 46 项、`mcp-dual` 30 项均退出码 0。此检查尚未证明全部消费者路由完整。

外置状态下源码读取保留旧 owner 的完整注释，审核 PDF 的定位和反向行号使用相同源码；`owner-preserve-final` 和 `pdf-reverse-fix` 定向检查退出码 0。`pdf-reverse` 首次因测试模块要求 `LOCAL_LATEX_TEXBIN` 而退出码 1；该纯定位测试不调用 TeX，补充隔离占位路径后通过，未编译 PDF。日志保留。

上述源码读取变更后的 `native-owner` 47 项和 `pdf-units` 19 项均退出码 0；后者仅覆盖纯 Python 定位与差异逻辑，未调用 TeX 编译器。

第二次真实 VS Code 样例 `host-api-sample/result-3.json` 为 `passed:true`：模拟资格在文本编辑后失效时没有保存，磁盘仍为原内容，编辑器保留未保存缓冲。资格变化是样例注入，尚不是实际第二宿主登记或断连证明。

`checkpoint-comments` 验证外置状态检查点保留作者评论；`marker-no-checkpoint` 首次退出码 1，原因是测试夹具迁移旧 owner 时错误归一化 CRLF；`marker-no-checkpoint-fix` 在修正夹具后因另一个断言用通用换行读取再次退出码 1。按原字节读取后 `marker-no-checkpoint-fix2` 两项退出码 0，确认仅加入标记不会产生虚假的成果检查点。全部失败日志保留。

真实 TinyTeX 隔离编译样例 `marker-tex` 退出码 0；原稿与嵌套标记稿均为 1 页，抽取文本、页面尺寸和 PDF 页面内容流一致。产物和两次编译完整日志保留在 `D:/latex-writing-checks/state-v3-target/marker-layout-dyp3p6hy/`；仅证明该样例，不代替全部 TeX 输入或完整 PDF 组。

`block-conflict-scope-fix` 退出码 0，已定位的其他固定块不因相邻块正文冲突而被阻塞；标记缺失或嵌套位置不明时仍需核对。`slot-consecutive` 退出码 0，覆盖同槽两次接收的顺序和剩余候选重绑定。

两个独立 VS Code 扩展宿主仲裁样例首轮仅有启动器返回且未产生回执，已核对并停止本轮独立样例进程；修正第二实例启动环境后，`host-arbiter-sample/result.json` 返回 `passed:true`。样例覆盖第二宿主连接使旧资格失效、两宿主时停写及连接丢失后不明状态停写；仅为隔离样例，产品登记、源/状态事务和崩溃后持久登记仍未实现。

`workbench-block` 退出码 0，4 项通过，新增工作台消息级检查覆盖保存原文、显式同步和候选身份/未接收状态。它是模拟界面服务，不代表真实宿主桥接已完成。

固定块候选换行按当前 CRLF 源稿保存；`slot-crlf` 两项退出码 0，检查连续插入后的顺序、不相交冲突范围和无裸 LF。保留原有源码的实际换行，不扩展到旧模式。

换行、冲突范围和检查点调整后，`native-eol` 51 项与 `mcp-eol` 30 项均退出码 0；完整正式分组尚未执行。

`batch-stale` 退出码 0：同批存在过期候选时，全部决定与正文保持原样。

投稿源码副本导出已加入后端、CLI 和命令入口，仅复制常见论文资源及显式附加文件，剥离块标记与机械状态，保留工作稿；损坏标记、活跃旧内嵌状态和运行态路径会拒绝。`clean-export`、`clean-export-ui`、`clean-export-cli` 退出码 0，覆盖后端、CLI 和备份回归；命令面板实际操作、自定义依赖核对及导出期间编辑场景尚未完整验证。

`clean-export-case` 与 `clean-export-invalid` 均退出码 0，覆盖 Windows 路径大小写绕过和损坏标记时不创建导出目录。

`marker-tex-multiline` 退出码 0，追加覆盖在同一自然段的源码换行处插入嵌套标记；页数、文本、页面尺寸及内容流仍一致。隔离产物与编译日志位于 `D:/latex-writing-checks/state-v3-target/marker-layout-tg616uty/`。

宿主登记原型 `review_host_registry.js` 的 `host-registry`、`host-registry-markers`、`host-registry-lifecycle` 隔离 Node 检查均退出码 0。两个真实 VS Code 扩展宿主加载该原型的 `host-arbiter-sample/registry-result.json` 返回 `passed:true`，覆盖第二宿主使旧资格失效、非正常连接断开及重新打开后停写。该原型尚未集成至扩展或 Python 写入；实际进程崩溃、信任边界、跨文件状态事务和恢复仍未验证。

`host-arbiter-sample/registry-result-crash.json` 返回 `passed:true`：第二个隔离 VS Code 扩展宿主进程实际退出后，原型登记保持不明状态并在重新打开后停写。仍未覆盖产品接入、信任边界及跨文件提交。

登记原型随后改为单一用户本机生命周期日志，不向任意项目创建登记文件；日志使用原子替换并在损坏或残留时停写。`host-registry-journal` 退出码 0；两个真实 VS Code 宿主的崩溃回归 `registry-result-crash2.json` 返回 `passed:true`。本项仍未实现 MCP 仲裁、受控源写入或事务提交，不作为交付证据。

`host-prototypes` 7 项及 `host-registry-disconnect` 4 项均退出码 0，补充正常退出后重新取得资格、连接断开后清除本地旧资格。产品接入仍未完成。

真实 VS Code `host-api-sample/eol-result.json` 返回 `passed:true`，隔离文件经受控编辑保存后保留 UTF-8 BOM 与 CRLF。样例未连接生产事务。

`review_host_transaction.js` 为外置状态事务增加真实文件、状态/对象摘要及编辑器检查的原型。真实 VS Code 首次 `transaction-result.json` 返回 `passed:false`，原因是 Windows 工作区路径盘符大小写比较；改用现有平台路径比较后 `transaction-result2.json` 返回 `passed:true`，核对源码写入及状态意图未改变。该测试使用模拟登记资格，尚未接入注册原型、Python 锁或正式恢复流程。

`review_migration.py` 增加旧内嵌状态的只读迁移预览初稿。`migration-preview-ambiguity` 两项及 `migration-preview-owner` 一项退出码 0，覆盖候选/批注保留、重复位置不猜测及旧 owner 的真实偏移；尚无迁移应用入口、Git 旧对象转换闭环或中断恢复。

宿主握手的 Windows 命名管道探针首次因命令行转义错误退出码 1（ENOENT，原输出保留在工具记录）；改为隔离脚本后 `pipe-binding` 退出码 0，第二个监听返回 `EADDRINUSE`。仅证明该本机接口行为，尚不是持久登记、身份校验或产品仲裁实现。

宿主事务原型现通过同一连接最终核对状态意图及已保存正文；第二宿主加入后禁止提交。`host-python-transport` 13 项退出码 0，包含 Python 经 Windows 命名管道往返并提交隔离事务；该测试的宿主正文写入为模拟，尚未接入产品或验证旧格式写入与恢复。完整日志保留于 `D:/latex-writing-checks/state-v3-target/host-python-transport.stdout.log`。

总控确认旧格式继续使用嵌入式意图与已有对象，首次意图和恢复均需宿主预检，纯元数据只做一次受控 owner 保存。`host-workspace-recovery` 15 项退出码 0，覆盖工作区切换及外置事务恢复前的第三种正文阻断；仍是隔离原型，生产入口与旧格式未接通。日志位于 `D:/latex-writing-checks/state-v3-target/host-workspace-recovery.stdout.log`。

外置状态事务已接入宿主预约：`sidecar-no-host` 退出码 0，验证宿主不可用时源码和状态均未改变；`host-reservation-check` 17 项退出码 0，覆盖预约后第二宿主进入。隔离真实 VS Code `host-api-sample/integration-result.json` 返回 `passed:true`，Python 外置后端经隔离管道和实际编辑器完成块标记保存及事务提交；宿主注册由测试显式建立，未覆盖产品启动、旧格式和崩溃恢复。

旧格式现经宿主计划执行元数据保存与嵌入式意图、多文件、最终 owner 分阶段写入，并加入恢复计划初稿。隔离真实 VS Code `host-api-sample/legacy-integration-result.json` 返回 `passed:true`，覆盖旧格式初始化、候选元数据及跨文件接收；`host-legacy-plan` 19 项退出码 0，覆盖首次 owner 写入前的其他源变化。此时仍未验证真实中断恢复、产品启动全链路和现有完整回归。

隔离真实 VS Code 的旧格式恢复样例注入了 owner 意图保存后的中断。`legacy-recovery-result.json` 首次失败，测试夹具用文本模式写文件时在 Windows 改变了换行；改用字节后 `legacy-recovery-result2.json` 因外部文件刚改完而编辑器尚未刷新，按设计拒绝恢复。等待隔离编辑器文件监听器更新后，`legacy-recovery-result3.json` 返回 `passed:true`，覆盖保留作者手改、目标已是新内容时幂等完成恢复。首次两次失败及其日志均保留；注入故障不等于实际进程崩溃。

后端旧回归采用仅限隔离测试进程的宿主替身，以保留原有状态、并发及恢复断言；宿主集成证据另见真实 VS Code 样例。`native-host-backend` 首次失败，三项子进程未获得宿主、一项缺 Git 环境；补齐隔离子进程夹具与 Git 路径后 `native-host-backend-fix` 57 项通过。原有 30 项单次计时使用宿主替身，不代表真实宿主延迟。`mcp-host-backend` 首次因旧测试仍注入废弃的磁盘替换位置失败；改为注入宿主保存失败，并另保留 sidecar 原子替换失败及临时文件检查后，`mcp-host-backend-fix` 31 项通过。失败与通过日志均保留。

`legacy-host-backend` 首次 22 项中 1 项因子进程未连接测试宿主失败；加入仅限隔离测试的子进程宿主夹具后，`legacy-host-backend-fix` 22 项退出码 0。上述旧后端及 MCP 组均未替代真实宿主全链路验收。

迁移预览准备可保留候选身份、版本及备注而不改源码；隔离真实 VS Code `migration-result.json` 返回 `passed:true`，验证一次显式迁移后的待审候选定位。`migration-recovery-result-3/5/6/8.json` 均返回 `passed:true`，分别注入旧意图后、标记后、pending 状态后及旧 DATA 移除后中断；第 6 项叠加作者手改并确认停止。`migration-recovery-result-5multi.json` 覆盖两个源文件中仅一个已加标记的恢复。故障为测试注入，不冒充进程崩溃；CLI/MCP/UI 实际入口和完整回归仍待验证。

真实隔离宿主中，`migration-recovery-result-8cli.json` 验证旧 DATA 已移除后通过 CLI 预览并恢复；`migration-mcp-result.json` 验证 MCP 只读预览和显式确认应用。`migration-adapters-backend` 89 项与 `host-all-after-migration` 23 项退出码 0，前者使用隔离宿主替身。插件命令的完整启动路径和最终验收仍未完成。

正式源码 PDF 不再依赖审核状态可解析。`pdf-formal-independent` 首次因新源码上下文缺少共享写锁方法失败，补齐后 `pdf-formal-independent-fix` 退出码 0；`pdf-formal-pending` 首次因测试传入空 ID 失败，修正测试输入后 `pdf-formal-pending-fix` 退出码 0，真实编译覆盖不完整迁移状态。为遵守不自动删除测试产物，两次通过检查均在隔离进程禁用 PDF 缓存清理；完整 PDF 组及缓存清理行为未由此证明。

固定块显式修复覆盖恢复缺失的标记对与重新关联唯一跨文件移动；`reassociate-block` 首次两项因测试夹具把 CRLF 转成 LF 失败，`reassociate-block-fix` 修正后又因新增测试插入位置错误而失败；恢复原测试段并按原字节处理后 `reassociate-block-fix2` 三项通过，所有失败日志保留。审核页修复消息和迁移预览确认的模拟 UI 检查包含在 `reassociate-ui` 28 项中，退出码 0。

按 `scripts/check.py` 执行的 backend 完整组 122 项退出码 0（使用隔离宿主替身，日志在 `backend-dbaceb3fdc784a5b86ea8ab9b85c5c6b`）；editor 首次因未配置本机 tex-fmt、ChkTeX 与 LaTeX Workshop 路径退出 1，补齐已有工具路径后完整组 124 项退出码 0（日志在 `editor-93f39103b20b46dea0257e336fcb5ecf`）。两组为小验收，不代替真实 VS Code 宿主样例或总控最终验收。

已确认的单人 30 项规模下，隔离真实 VS Code 宿主单项接收后端样例 `performance-result.json` 返回 `passed:true`，读取、决定及宿主保存合计约 0.259 秒；准备 30 项使用测试宿主替身，计时不包含前台点击、PDF 或 Git，因此不能作为完整用户交互耗时结论。

文件角色登记原有源码写入口已接入宿主校验，保留无审核对象目录的行为。隔离真实 VS Code `roles-bridge-result.json` 返回 `passed:true`，角色后端定向 9 项及宿主定向 14 项通过；两次定向检查最初因未设置夹具根目录退出 1，补齐后通过。完整 editor 首次重跑因 ChkTeX 路径错误和角色 UI 测试未配置宿主替身失败，日志 `editor-3e4a6cce071a4c21ae149636b40b29ad`；修正后 `editor-c5121f14ae3f4f39a94d03204f071031` 125 项退出 0。完整 backend 重跑 `backend-f909923e618a464587e3ebe59f3cde08` 因未设置 `SOURCE_REVIEW_GIT` 而 1 项出错，正补齐路径重跑。角色 UI 测试使用宿主替身，真实编辑器结果另列于上。

补齐 Git 路径后，backend 完整组 `backend-0f142d9499fb45e093a4625477f4e144` 124 项退出 0，使用测试宿主替身；translation 组 `translation-3f3e21811894476f99332bfad0e21f85` 8 项退出 0。备份和 PDF 完整删除回归仍等待用户对限定测试根内夹具删除的授权，不以其他检查代替。

用户已明确授权仅在新建的 `D:/latex-writing-checks/state-v3-delete-regression-20261120` 内删除本轮测试夹具，保留根和日志；开跑前确认根及父目录为非链接的规范路径，测试临时目录和 TeX 缓存均指向该根。PDF 完整组 `pdf-c73dd1b7e90345ff8bc8223730ce9e79` 43 项退出 0，包含实际缓存轮换和删除边界；backup 完整组 `backup-70ee96ef632544feacfb42b2209dd852` 23 项退出 0，包含真实清理、失败及恢复，后端通过测试宿主替身。原有 PDF 套件包含既存 100 项计时用例，本轮未新增或修改其性能测试。根及剩余现场均保留。

总控首次最终检查发现的四项已返修：卡片传递块身份、同版本推送最新块与冲突状态并保留及标明过期草稿；新增明确选区与确认的人工更新候选，保存全部现有方案、旧版本和批注，不自动接收；候选输入及接收边界拒绝固定标记。人工更新另生成独立版本身份，使同内容重复更新也会阻止旧按钮。普通保存不更改基准。

返修后 backend 完整组 `backend-4fda2e783fa6416692e85465a06424ed` 126 项、editor 完整组 `editor-66ca16249eb64683ac4fce6044718678` 127 项通过。随后为人工更新补充版本身份，最终受影响 backend 定向组 `rework-final-74c1a89543404c60bb64f79ea103f534` 3 项及 editor 定向组 `rework-editor-ba2b4d0f24b24c88812bf1bf9b28f604` 31 项通过；覆盖 CLI 预览和显式应用、旧版本失效、空插入、Unicode/CRLF、原文批注保留、更新后接收、候选标记输入及旧异常候选单项/批量接收阻断。backend 使用隔离宿主替身；确认弹窗为模拟扩展宿主。

隔离浏览器加载实际生成的审核卡片 `workbench-render-fixture3.html`，观察到正常状态首次手改后出现同步和修复按钮，候选草稿及过期提示保留；在最新块内实际选区并点击后，页面发送了包含相同草稿、准确范围、块身份及当前源版本的消息。`workbench-render-fixture2.html` 同时验证修复按钮实际点击与原文草稿保留；页面使用模拟消息对端，不代表真实 VS Code 产品全链路。首次创建 HTML 的单行 Python 命令因 PowerShell 引号失败，改用 UTF-8 脚本后成功；浏览器程序化选区未触发选择事件，改为点击文本框并用键盘选择后验证通过。两个本地静态服务均在检查后以 Ctrl+C 停止（退出码 1），不涉及文件删除。

总控最终通过后，将唯一版本来源 `package.json` 更新为 0.9.50；纯 JavaScript/Python 无独立转译，打包直接组装已验证源码。版本相关 MCP 定向 2 项 `mcp-version-8f8232a4a3db40a2954f54dd655fad8e` 与发行工具 12 项 `release-version-36fdeebf85584d68b93face40d218e17` 均退出 0。打包、推送、发行及安装结果以随后实际回执为准。

`python -X utf8 scripts/build.py --output dist/v0.9.50` 退出 0，日志 `package-c59cf0a85280439fa22a8676b9770b04`。VSIX SHA256 `793305532135c17452f292a816a3e37ca4669c99f00333d46a754c4b80f45e47`；源码包 SHA256 `7f47ed96ad8130d1cf08fae1eb355b15353d4b1d43ff509cd3d88424f9950f2c`。发行和安装复用这两份已生成产物，不重打包。

源码提交 `b35bd331409a6f70898cb6595e7a8f9272ba852a` 已普通推送 `origin/master`，fetch 后两者相同；附注标签 `v0.9.50` 指向该提交并记录两包摘要。`scripts/publish_release.py` 退出 0，正式版设为 Latest，GitHub 返回三项附件摘要与本地产物一致；日志 `publish-5c82a18c06da41d0a9a84bd415390f4b`。VS Code CLI 安装前核对同一 VSIX 摘要，安装退出 0，日志 `install-4d741de5761d4c97a220d9e736895a27`，包含 Node 依赖弃用警告。未额外做包后冒烟或自动重载。
