# 审核衔接与返修质量执行记录

2026-11-21：唯一 Terra `local/01a1fd60-2da5-74e0-8e68-e266cf679881` 实核 gpt-6.1-terra/high/default、match/continue，接管 Q1–Q7 产品、测试、UI 租约；已读取完整计划及独立报告。基线 `4e3ab921100e8541e09c383d57c61ba2b14c3583` 与 origin/master 一致；总控持有计划及索引。真实论文完全只读，隔离样例和日志保留在 D:/latex-writing-checks/review-quality-20261121；Q8 明确通过前不发行。

Q1：暂缓在保存队列前捕获导航代次及批次身份；队列写入可完成，更晚显式打开同项、另一项或切开后返回都阻止旧自动前进。`q1-nav-repro.log` 首次退出1实际复现同项被旧回调覆盖；`q1-target-final2.log` 53项退出0，含三种竞争及正常路径，命令 `C:/Program Files/nodejs/node.exe --test src/review_workbench.test.js src/inline_review.test.js`，cwd仓库根、`LOCAL_LATEX_TEST_ROOT=D:/latex-writing-checks/review-quality-20261121`。问题核对增加固定块/父块、章节、相对既有块及邻近原有行跨越检查；无关前缀导致坐标平移不失效，已确认上下文跨越/章节/父块/旧格式显式锚点变动需重核，旧核对记录首次升级需重新核对。原独立报告实际backend迁移前后投影通过 `q1-projection.js`、`q1-projection.log` exit0；无新真实UI移动实点。该定位采用已知稳定标记与上下文，并非能推断任意语义移动；真实页面和最终跨入口仍在后续验收。原 `q1-original-boundary.log` exit0表示三个旧缺陷被断言复现，不是产品通过。
