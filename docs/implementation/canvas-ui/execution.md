# 画布阅读界面执行记录

2026-11-23：现任执行者 `local/01a20284-4ad8-70b1-87ff-61225eaec6aa`，实核 gpt-6.1-terra/high/priority、match/continue。计划提交 da16ca30d29fd72f963ee6677464759411d587a5 与 origin/master 一致，工作区及暂存 clean；总控交出产品、测试、UI、隔离配置及 Git 租约，保留 plan/index 与 U6 验收。用户选定画布阅读，完整交接与计划已读，反例图及段落/问题参考截图已逐一查看；不复制原型代码。真实返修计数 0；U6 前不发行。

真实入口调查：工作台使用 `review_workbench.js` 的 HTML/CSS 和 `review_workbench_client.js`；段落三方案由 `renderOption` 构造，问题页由 `renderQuestionMode` 构造，原问题页片段仅展示当前选择而全文位于 details。两种模式共用目录/批选 Map，真实接收、历史、意见、版本和范围通过既有 `data-action` 委派及宿主消息处理；选择器还依赖 `article`、候选 id、`#noteComposer` 的父节点、题目卡复选及 `data-question-item`。目录和外观使用原生 dialog，其他工具使用 details；候选批注编辑器可按选区移动。布局必须保留这些绑定、祖先及作用域，新增仅展示性外点收起和尺寸处理；问题卡呈现 ABC 可增加只读展示节点，不增加或改写接收/选择路由。后端、用户真实论文及全局资料不动。

局部布局已实施：模式移至固定工具栏，原文独立，ABC 等宽，问题卡改为原文加三方案片段/全文并复用数学及文字差异渲染；选择背景、主题表面和阴影调整，目录/外观 dialog 外点收起、自适应及菜单外点收起仅处理展示状态。已有 data-action、消息与真实选项选择/接收链保留。后台备份正常状态折叠，失败或本地未确认状态展开。README 同步操作说明。

当前有一处需总控裁定：问题模式的真实卡片原有接线只有本项复选、方案下拉和 `questionEntry` 打开本项；段落模式的每方案预览/编辑/批注/接收处理器使用宿主当前 active 项，而问题页可能同时显示其他 id/version。直接复制按钮会对当前项而非所在问题卡执行，不能安全声称是同一动作。本次保留原下拉和“打开本项”，进入后使用原三方案按钮；这是保持接线的可行替代，但未满足“问题卡各列与段落相同动作组织”的字面要求，U5 尚未冻结、U6/U7 未开始，待总控决定是否接受替代或给出已获用户授权的精确接线范围。未修改业务接线。

验证：`editor-first` 虽 exit0，但运行时曾调整 CSS，输入不稳定不作为最终覆盖；最终 `editor-third` 173 项 exit0。`ui-setup1` 因外置 Python 构造路径时反斜线转义产生 SyntaxError、未创建项目；换新样例成功，首败留日志。`ui-fourth` 和 `ui-fifth` 分别在独立正常 Development 深/浅主题验证段落三列、问题三列、差异/公式、目录内部与外点、用途及选择保留；`ui-fifth` 实测446px页面三列各113.7px、无页面横向溢出。`ui-sixth` 实际保存隔离项目3的方案A、personal意见，状态读回原身份/版本/用途，首次外置只读查询错误假设 edit 内有 id 而 KeyError，改按字典键读回，不影响保存。`ui-seventh` 实测446×453页面的目录限高内部滚动、输入焦点、Esc关闭及候选草稿/批注/用途/范围跨模式保留。各成功轮 host/observer/外层 exit0、未切私有桌面、前中后真实前台不变；截图均实际查看，分别 `ui-c60392bcaa1ebcdbb0ef80e56ad46542.png`、`ui-93b357a32d554d0aa8430b092ec8279f.png`、`ui-c245dfd62dc13f1b4325304e39e1baac.png`、`ui-9343234d5c924579b90cbe74548cbe21.png`、`ui-1f7cdca438164d23ae303617d635588e.png`、`ui-fb115b1e705f4a4384f8b43f4424a779.png`，均在 `%TEMP%/CodexUiCaptures`。完整日志及隔离夹具在 `D:/latex-writing-checks/canvas-ui-20261123`，此前真实失败、旧任务未测与保护范围继续保留；未重测后端/PDF/export、实网及性能。

问题视图开始复用公式渲染后，补齐原有公式模式切换时的展示重绘；最终 `editor-fourth` 173 项 exit0。`ui-eighth` 观察器断言失败、外层 exit1：观察表达式的 JavaScript 字符串将反斜线序列解释为制表符；原诊断与已拍截图 `ui-318477537ee02e64b8748991edd8555f.png` 保留并查看。新样例 `ui-ninth` 用字符码表达反斜线，实际验证问题页公式源码与预览互切、ABC、目录留稿及 Esc，host/observer/外层均 exit0；截图 `ui-fdca3f99d9faac3e3335071ed475acec.png` 与 `ui-454ec206eb5948938cafd0aa12270753.png` 已查看。其窄窗宽度采样发生在视口调整完成前，不能作为窄窗通过证据；有效窄窗证据仍是 `ui-fifth`。
