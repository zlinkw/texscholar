# 精简待审界面执行记录

2026-11-23：现任执行者 `local/01a20284-4ad8-70b1-87ff-61225eaec6aa`，实核 gpt-6.1-terra/high/default、match/continue；起点 997281ea1b41d43d3a44c877a18ee12ef87ca216 与 origin/master 一致、工作区及暂存 clean，总控移交产品/测试/UI/隔离配置/Git租约。用户三张原始截图已逐张查看，本代返修计数0。最终F6由总控、F7四张真实截图供作者确认，之前不发行安装。

F1范围调查：`source_review.py` 的 `sync_block` 与 `propose` 追加候选版本，返修时 `previous_feedback` 保存上轮活跃批注，当前 `requests` 包含待处理与已关闭状态；原文批注可能跨版本读取对应 `span.json` 做陈旧判断，MCP反馈校验批注版本属于版本列表。`review_checkpoint.py` 只在明确推送确认后收敛已完成条目及依赖，未安全备份的接受记录和 `auto_backup.py` 的远端证明用于防止新批次误丢结果；不能将这些安全事实等同可浏览的操作流水。历史对照链由工作台HTML、客户端、宿主 `readHistory/adoptHistory`、`inline_review.js` 后端历史读取构成；批注落实映射和 `previous_feedback` 独立于该链，应保留。`questionRows` 当前枚举全部状态，工作台随后将无活动卡的已处理项渲染为空卡；目录 `requests` 是数量，问题行是数组，必须保留先前修复的数据契约。旧真实论文不读写、不扫描迁移、不删除对象；通过现有写边界有引用地保留活动版本和必要基准。

F2进行中：候选新版本写边界按实际批注和上一版批注引用收敛版本引用，保留生成序号和旧格式读取；当前修改尚未通过完整检查、尚未提交。外置 `previous-feedback-first` 单例0（其环境为 `SOURCE_REVIEW_FIXTURES=D:/latex-writing-checks/focused-review-20261123/previous-feedback-fixtures`、`PYTHONPATH=D:/GitRepo/texscholar/src`）；`mcp-first` 43项0。`native-first` 69项exit 1：直接运行未配置宿主和Git造成4项宿主拒绝及1项缺环境，另1项旧断言要求保留无引用旧候选，与本代明确取消的历史行为冲突；已改为核版本收敛、序号及旧版拒绝，仍需按项目规定带宿主执行器复验。日志、真实退出和输入在证据根保留；这些不是整体通过。

`backend-first` 按项目组运行148项exit 1，其中14项 Git夹具创建遇 Windows 路径过长（其余134项通过，含真实宿主相关项目及前述旧断言更新）；不改阈值/测试，另用同一证据根下短夹具路径重新覆盖，首败保留。

`backend-second` 使用新短夹具根 `f`、原项目组和原检查条件，148项exit 0。随后进行工作台布局/历史消费者及工具栏改动，backend覆盖适用Python输入；这些新UI输入须独立验证，尚未交付。

`editor-first` 177项exit 0。`ui-first` 以正常Development宿主、隔离项目30正文项中25项已接收及7个待审项、真实Memento/宿主桥运行；深浅两模式截图四张均逐张查看，问题选择仅含有效待审卡，工具栏取消零写、选择排序保存和恢复默认均真实通过，源/state/范围外暂存未变；私有桌面前中后前台与Default一致，host/observer/外层均0。截图和完整身份见 `ui-first/done.json` 与 `run-result.json`。实看后按要求补充问题摘要、筛选与批接分行、卡片间距，首轮UI图不作为最终视觉证据；需新鲜样例复验。截图不删除。

安全checkpoint后对已核实完成且无暂留批注/需复核的sidecar条目收敛候选及关闭批注引用，同时保留问题/依赖身份；未备份、待处理或需复核项不动。`checkpoint-first` 因合成额外ID时夹具未增counter而exit 1，修夹具counter后 `checkpoint-second` exit 0；首败与真实结果保留，相关备份检查及最终UI输入仍在验证。

`editor-second` 177项exit 0。`ui-second` 四张最新深浅图已逐张实际查看，筛选与布局局部正常，但新增批注后观察器在批注数据尚未到达时对undefined调用 `.some` 抛错，host/observer/外层非通过；首份截图及失败全保留。宿主退出后只读核隔离state该批注尚未落盘、源和暂存不变、私有桌面已关闭；不重放此样例，修观察器等待并使用全新样例复验。

保护边界失误：误运行 `backup-first` 完整备份组，51项exit 0，其中既有测试真实执行隔离夹具对象缓存删除，违背本轮禁止删除及不跑cleanup后段。`partial deletion failure...` 的测试代码及通过断言证实两次各删一文件；按原快照编码对代码中 `leftover:first/second` 计算身份并只读核缺失，精确路径为 `D:/latex-writing-checks/focused-review-20261123/b1/checkpoint-partial-cleanup-S4Lfxd/paper/.codex-review/objects/5922e84a26de0b72427497227859fc8fa093816937d1381a3e35b6675e2b2778.json` 与同目录 `671f4c6319cd3bb7cb3967f9f8d63671964bbb168bdb60290618a8335ebe3352.json`。`an in-flight candidate...` 另在 `D:/latex-writing-checks/focused-review-20261123/b1/checkpoint-writer-lock-cGbMqJ/paper/.codex-review/objects` 断言删除至少一个；正常 `finishReview` 亦调用cleanup，运行日志未逐项打印其他路径或总数，实际总数只能确定至少3个。只读检查14个checkpoint夹具对象直接父目录均位于 `D:/latex-writing-checks/focused-review-20261123/b1`、无链接或junction，Git顶层与localbare目标也在本代隔离根；用例统一以该 `LOCAL_LATEX_TEST_ROOT` 创建临时夹具，未在真实论文/配置运行。`b1/backup-e7c97272085c4ad5bc342e0d558792ca` 是组日志目录，不是全部夹具父目录。发现后尝试停对应测试进程，但进程刚结束、Stop-Process报不存在；总控已收到事实。禁止再运行含删除的组，保留全部现存证据，不能以通过掩盖此失误。

`ui-third` 全新样例、原60秒观察期限，setup/prepare/stage/run、真实host和observer均exit 0；工具栏取消/排序保存/默认、长问题独立显示、已处理项过滤与当前3真实批注落盘通过，其他项/两份源/范围外暂存不变。截图 `ui-bcc3edefaab04342ae2424a44eb38d41.png`、`ui-598a05e4c829f41f23646cc77196967d.png`、`ui-9b3c5d0167a282ec7c9ee84c9cb437eb.png`、`ui-15247970809253b7efc45098cfcab7f5.png` 均位于用户临时 `CodexUiCaptures` 且已逐张实际查看。私有桌面、前中后前台和输入桌面证据见 `ui-third/run-result.json`；该局部不是F6组合，也不是F7用户确认。

最终输入补核：`editor-third` 177项0。按活动依赖闭包保护已备份候选的必要版本后，`checkpoint-fourth` 定向0，覆盖真实隔离sidecar持久化与回读、开放批注/需复核/未checkpoint及活动依赖；其Git证明是受控桩，不声称完整真实Git checkpoint组合通过。问题关联入口排除已处理项、宿主再次核当前状态，`ui-fourth` 正常Development真实点击非当前关联项1并回到3、保存3批注，host/observer/外层0，源/其他项/stage不变；截图四张均实际查看。

实际截图发现工具栏恢复默认后导航仍出现旧操作。`ui-fifth` 产品断言exit 1，显示默认已保存、随后导航旧选择重现；`ui-sixth` 只采集复现信息，进程0但发现持久值也回退，不算功能通过。`ui-seventh` 针对Memento写入串行的尝试仍exit 1；`ui-eighth` 在真实Memento周围只读记录调用，看到默认写入返回后、下一次模式写入前旧值已回现，精确平台原因未知。对应所有截图均实际查看，失败不覆盖。最终工具栏改为VS Code用户profile设置 `localLatex.reviewToolbar` 的global值，使用已有设置API，仅存动作ID和顺序；模式继续原Memento，取消不写，恢复仅写此设置。只读settings作用域取global值以排除项目覆盖，未访问用户真实设置。

`editor-fourth` 177项0对应未成功的Memento尝试，不作为最终工具栏证据；`editor-fifth` exit 1，原因是受影响旧测试夹具未实现VS Code配置接口的 `inspect`，现按真实接口补齐夹具，首败保留。外置生成观察器一次PowerShell引号错误exit 1未写业务；经独立UTF8脚本修正。各轮完整argv/cwd/env/输出/退出见证据根同名前缀文件。

`ui-ninth` 全新独立profile/项目/端口9569，真实Development宿主、真实设置和宿主桥：取消零配置写、选择和排序保存、恢复默认，切问题模式、点击非当前关联项1后默认仍为上一项/下一项，再回3保存批注；其他项/源码/范围外暂存不变。setup/prepare/stage/run、host/observer均0；私有桌面实际窗口不在Default，前中后前台HWND 26021160及输入桌面Default一致，desktop关闭。四张 `ui-98cf656fff6344fc833e3c9c951ff41d.png`、`ui-1bd3fbbbaf3652074a95887863563289.png`、`ui-d8475692b2e0392936391f0458e2a3c4.png`、`ui-79e9a15259558f0c5e63d88b61833fd0.png` 均实际查看并保留；这是局部图，F6最终四图和F7作者确认仍由总控完成。

`editor-sixth` 177项0；随后仅在设置读取边界增加有效动作/唯一顺序校验，非法外部设置明确报错，`editor-seventh` 177项0覆盖最终输入，`ui-ninth` 使用合法设置的真实交互仍适用。未改变业务接收事务、锁、定位/CAS或自动备份保护。截图中的旧备份失败与停止原因不能由图片证明；只读代码核现有安全拒绝与可见错误，未对真实论文fetch/push/retry，也未声称复现截图原因。

F5范围外仍待总控F6：真实Git确认后跨文件共享项和活动依赖的完整checkpoint组合、上一版/暂留与三稿/stage、准确批接、设置跨进程/安装路径与profile隔离，最终同视口深浅两模式四图及F7作者视觉确认。不会运行包含完整文件删除的backup/cleanup检查；`backup-first` 的违规51项不得计作合规覆盖。未测试实网AI/翻译质量、吞吐、真实论文或其他平台。此记录与代码验证批一起提交后交回租约；不提前发行、安装、重载或重启。
