# 问题审核翻译修复执行记录

现任执行 local/01a208d4-2ab9-7a93-9994-56e2c5dfc6c7，gpt-6.1-terra/high 实核 match/continue、service_tier default；Q 返修 0。初始 master 与 origin/master 均为 66d8c9c1d363dca3339aebe044a1a9df8a2a9a5f，工作区干净。总控独占 plan/index；真实论文、P、用户窗口、默认管道和 MCP 连接不操作。

Q-ui-red 为隔离 Development 宿主复现：设置自动翻译并使用合成供应商，进入问题审核的变更片段，实际多卡无任何译文节点及单卡翻译按钮，观察器断言 exit 1；不能把该失败视为修复。GUI 在专属未切换桌面，前中后输入桌面均 Default，前台 HWND 均 25630512，专属桌面已关闭。截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-4b99738155c7409cacb1a52151d14bbd.png 已查看且保留。日志与夹具位于 D:/latex-writing-checks/review-efficiency-20261122/Q-ui-red.* 和 qtranslation-red1；prepare 使用 FakeHostSession，宿主使用独立 texscholar-efficiency-qtranslation-red1 管道。

待验证原因按优先级：问题模式未创建或接收译文节点；宿主仅按当前 loaded 项调度而非可见多卡；手动入口及状态位于隐藏段落区；来源错误独立于以上显示问题。片段身份、未保存草稿及迟到返回必须在实现边界核对。首次读取猜测 question-translation/index.md 不存在，计划已读，未因此修改其他文件。

实现：问题模式为关联问题、原文和每个方案建立独立译文与手动翻译／重试／收起入口，自动请求跟随可见区域；段落模式恢复方案独立按钮并按可见区域自动请求。宿主以会话、问题、项、版本、原文／方案、片段及来源核对请求和返回，切换或隐藏后丢弃过期结果；草稿不作为请求内容。片段和全文使用同一差异计算，跨行 TeX 参数或不安全结构回退到显示并翻译全文。新增译文选区沿原批注入口保存，关联完整问题与片段源码的 Unicode 范围，后端核对精确来源及问题；重新定位要求当时译文仍精确可用。失败可单项重试，已有成功项保留。README 已同步入口和行为。

首败保留：Q-host-red 真实协议定向测试 exit 1，未接通多卡请求；Q-target-green2 exit 1 因原测试按源码切片提取函数，新函数已移至共享数学模块，改为调用实际共享实现；Q-workbench-second exit 1 因旧测试未发送新的可见区域消息，补真实协议后通过。Q-ui-red 的界面缺口见上文。额外一次只读检索使用 Windows 字面通配报路径语法错误，另一次读取 Python 行范围超出文件末尾报 IndexError，均无写入。

Q-editor-final5 在 D:/GitRepo/texscholar 执行 `node --test src/review_workbench.test.js src/review_math.test.js src/inline_review.test.js`，90 项 exit 0；LOCAL_LATEX_TEST_ROOT 为 D:/latex-writing-checks/question-translation-20261123/editor-fixtures5。Q-feedback-final 在 src 目录执行 `C:/Python314/python.exe -B -X utf8 -m unittest source_review_test.Flow.test_question_and_translation_feedback_snapshots review_translate_test -v`，10 项 exit 0；SOURCE_REVIEW_FIXTURES 为 D:/latex-writing-checks/question-translation-20261123/q-fixtures4、SOURCE_REVIEW_GIT 为 D:/Git/cmd/git.exe、PYTHONPATH 为仓库 scripts/test-support 和 src，启动前实核 FakeHostSession 模块位置。测试覆盖可见项调度、跨卡与过期版本、切换问题时迟到结果、来源切换、429及显式重试、纯公式提示、跨卡选区与交接重试、Unicode 片段和 TeX 边界、后端精确上下文与拒绝不匹配。完整 argv/cwd/相关环境、stdout/stderr 和真实退出保存在 D:/latex-writing-checks/review-efficiency-20261122/Q-*；runner 只记录预设相关环境变量，非完整环境快照。

隔离正常 Development 宿主 Q-ui-green4 exit 0：关闭自动翻译后单卡片段仅发一项，独立 429 可见，成功译文保留；全文原文及段落方案单卡手动显示，四次请求对应四次点击。Q-ui-green5 exit 0：实际选中跨卡片段译文、在合成审核状态保存批注，读回精确 item/version/option、完整问题和来源片段范围，并从批注重新定位到同一译文；另核 429。Q-ui-green6 exit 0：自动显示当前可见问题和方案，未见隐藏第 4 卡预译，用户收起后切换全文仍保持收起。均使用独立 profile、专属 pipe 和确定性合成供应商；GUI 在未切换私有桌面，Default 输入桌面与前中后 HWND 25630512 一致，宿主和观察器均 0、桌面已关闭。截图 ui-a1f932d228ea4cfe9976228668116c8c.png、ui-130f0d6ed07befbe8956a315a0962b87.png、ui-cfedac2a335e47a6bf59f2a5ddde9b32.png、ui-924a88f5bb814e198b1fc253cf7dd55c.png 均位于 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures，已实际查看并保留。Q-ui-green1/2/3 亦为独立样例，exit 0；green1 自动问题、green2 手动入口、green3 片段批注和错误的早期结果按当时输入保留。

未使用真实论文、真实 P、默认管道或桌面 MCP，未重载用户窗口、构建、安装、发行或清理；实网供应商质量未测。旧默认管道拒绝和隔离对象误删事件仍按先前执行记录披露。本阶段为执行者局部验证，尚待总控独立核对受影响跨模式和跨卡组合。

补充核验：Q-editor-final4 exit 1，因为新指定的隔离测试根目录尚未创建，测试夹具 mkdtemp 报 ENOENT；创建新测试根后 Q-editor-final5 90 项 exit 0。Q-ui-green7 exit 0，在自动翻译关闭、中文隐藏后，通过全局翻译按钮实际显示当前可见问题译文；私有桌面隔离、宿主及观察器结果保存在同名日志，截图 C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-8bf616506a644b1db7b170a4d7f2ad03.png 已查看保留。

Q 返修 1：总控实证同文两卡各自路由但重复调用供应商；controller-cache-check 首例因缺 workspaceState 夹具失败，check2 才复现产品缺口。起点 cc710cf3e95c07f36c1f33d65803ce4086a79d25，工作区干净。Q1-cache-red 复制 check2 使用独立名称执行，exit 1；Q1-unit-red 新增真实 workbench 调用链断言，exit 1。问题模式改用既有 provider/text/kind/option 成功内容缓存，仍单独记录每卡精确身份供消息和批注核验；失败仍按原卡保留，不作为共享成功，恢复 README 复用说明。Q1-cache-green 相同反例 exit 0；Q1-unit-green2 exit 0；Q1-workbench-final 执行 node --test src/review_workbench.test.js，45 项 exit 0，覆盖跨卡和双向跨模式复用、相同片段、不同来源/类型/方案隔离、第二卡批注身份与原迟到及 429 测试。日志在 D:/latex-writing-checks/review-efficiency-20261122/Q1-*，真实 argv/cwd/相关环境及退出均保留。一次 rg 向 Windows 传字面通配报路径语法错误，无写入。既有 UI/后端/TeX 检查对应文件及输入未变，复用 Q 局部结果；实网未测，未操作真实论文、用户窗口、默认管道或 MCP，未构建、安装、发布、重载或清理。
