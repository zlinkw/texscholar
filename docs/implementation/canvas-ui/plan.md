# 画布阅读界面

## 目标与批准依据

2026-11-23，用户在设计聊天 local/01a20308-ef70-7e43-a41e-e1f6b66a0d6c 选定方案1“画布阅读”，明确交总控实施。目标是减少寻找、切换与重复阅读，让原文和三方案在段落、问题两种模式下保持一致的比较关系。没有新增速度指标或性能测试。

唯一设计交接：`C:/Users/ZLK/Documents/Codex/2026-11-22/texscholar-ui-design/outputs/approved-direction/ui-implementation-handoff.txt`。用户原话与全部保留功能在该文件，执行者须完整读。参考原型：同设计根 `outputs/interactive-round-03/texscholar-five-studies.html`，仅方案1；说明为同目录 `design-notes.txt`。原型只供外观与空间组织参考，禁止移植 HTML、脚本、模拟状态、事件路由及假后端。

用户最新纠正优先于原型：全部选中选项仅加深背景；不得有强调描边、顶线、左条或模拟边线。反例截图 `outputs/approved-direction/selected-background-reference.png` 中方案A蓝色顶线必须去掉。浮岛的柔和阴影及悬浮层次应比原型更明确，深浅主题均处理，不能用粗边框代替。

## 基线、职责与保护

- 产品起点：master，HEAD==origin/master==`10cba5f1c09bf4296101ac31ad5a934f69247771`，工作区及暂存 clean；2026-11-23普通 fetch 已核。0.9.58发行源码 `08d91ffdcff873620ddbfe1ee0bf9815af1ac6ba`，已安装但用户明确暂不重载VSCode、不重启MCP。本轮不替用户启用新版。
- 总控兼最终验收：local/01a1fe7c-cc49-70d0-ac4c-af5e77c7b6ba，Sol6.1/high；只维护本计划、索引，审实际diff与必要调用链、最终隔离验收和发行元数据，不自行调查或实现产品。
- 唯一执行：local/01a20284-4ad8-70b1-87ff-61225eaec6aa，Terra6.1/high；调查实际界面、实施、小验收及获准后的发行安装，维护同目录 `execution.md`。开始前用真实ID核 context_status；模型/强度必须match，服务档位仅记录。不新增角色，不唤醒原专项检查会话。
- 本轮沿既有多会话验证、发布和同包安装授权推进；UI交接不扩大外部写入。U6明确通过才可U7。没有包后冒烟或自动reload。
- 所有真实论文，尤其 `D:/Overleaf/TMI-DA-Marked-up Copy` 严格只读，不save/accept/Git/PDF/迁移/恢复/新批次/清状态。保护真实批注、决定、候选、计数、未保存稿及范围外暂存。
- 新隔离夹具和完整日志使用 `D:/latex-writing-checks/canvas-ui-20261123`；旧已写样例不可重放。禁止文件/目录/截图删除，不修改用户全局SKILL、配置、活动窗口或安装目录；U7正式同一VSIX安装为既有授权例外。
- 普通Windows本地，不是管理器/容器，不建worktree。每个通过的内聚批精确stage、commit、普通push/fetch核HEAD==origin/master；远端前移等阻断按规则停止，不reset/rebase/merge/force或改remote。UTF-8显式、pwsh7、Python -B -X utf8。

## 实施边界：保持真实接线

保留真实 Webview、按钮、命令ID、标识、数据属性、事件委派、监听、消息、处理器、状态及事务链；除下面用户明确批准的问题卡精确身份路由外，仅重排真实UI并调整样式。不得换成原型接线，不重写MCP、存储、保存/接收/交接、Git/PDF业务或改变批选顺序、校验与授权。DOM重排必须核选择器、祖先关系、事件容器、具体项身份和滚动/焦点依赖。全部旧入口、快捷键及高级功能保持可达。

2026-11-23用户明确选2：“允许为问题模式增加必要的精确身份路由，让每张卡片都能直接操作，但不要改动原有业务逻辑和校验，重点验证不会串项。按之前流程完成验证、发布和安装，保护论文、批注、草稿及范围外暂存，暂不重载或重启。” 此决定取代先“打开本项”的待选替代，仅放宽这一处接线边界。

问题卡各方案可直接使用既有预览、编辑/保存、批注、单项接收等已支持操作，动作明确绑定所属repo/owner/session/id/version及适用方案；完整问题身份与实际修改身份不可混同。通过原业务处理器及其校验执行，不以当前焦点或active项回退猜目标，不复制业务事务、决定或草稿状态。保留旧段落入口、批量入口和保护性取消/拒绝；编辑或操作时显式导航、重绘、返修更新均不能让旧动作、回调、选区或草稿写到另一项。旧版本按既有契约拒绝，不自动换新版本重试，也不把打开、预览或选择变成保存/接收授权。必要前端/宿主消息参数与分派可作最小完整调整，原源事务、锁、预检、唯一定位、CAS、宿主保存、反馈身份和脏稿保护不得削弱。

另外批准的展示交互仍为抽屉外空白点击收起及自适应尺寸，包含必要的开关、尺寸、焦点和留稿处理。关闭不得调用保存、接收、发送、放弃或清空。其他确需改动接线的范围仍须先给可行替代与具体限制，不能把本次例外扩为通用业务重构。

## 完整界面要求

1. 主画布不常驻宽队列，目录、批选、返修、历史、上下文和工具按需展开；段落/问题切换稳定可见。原文为独立固定参考区，ABC始终等宽三列、同字号/层级/动作组织，不改为四等分，不隐藏B/C为标签页。问题下正文与回复仍用同一比较单元及视觉语言。长文、公式与窄窗均保留内容和操作，可用现有展开/放大能力，不能用隐藏列或无尽横滚规避。
2. 作者重点要求短而醒目，真实差异可辨。保留必要ID、真实文件位置、版本、当前范围及数量。正常保存/连接/版本/排队不占常驻状态条；重复说明按需查看。未保存、陈旧、冲突、阻断与失败须在相关位置清楚可见。
3. 所有选择态仅背景加深，原生勾选/单选语义保留；键盘focus-visible独立清晰。实际文字diff不属于选中装饰，不误删。低对比表面、隐形圆角、柔和环境与接触阴影形成浮岛，不加厚边框、强饱和、玻璃或夸张立体效果。跟随VSCode主题，保留既有深浅切换/外观入口及合法精确值；不把原型17px/1.65/8等样例写成新默认。
4. 点抽屉外空白关闭；内部点击、选文字、输入、菜单操作不误关。Esc与显式关闭保持，必要焦点恢复不触发业务。尺寸随内容和视口，短内容不过度铺满，长内容限高并内部滚动，按钮始终可达，文本/公式不裁掉；不同辅助抽屉不统一变成覆盖全部审核的巨框。
5. 抽屉收起、切模式和重排不丢候选/原文/批注输入、六用途、批注范围、批选身份/方案、阅读位置；使用既有草稿机制，不新造审核状态或多层确认。

## 0.9.58功能保持清单

- 原文/ABC、编辑保存与接收、片段/全文、两两对照、历史版本方案与落实映射、翻译/LaTeX/公式、差异定位、暂缓、三组件暂存/恢复及旧基准保留。
- 问题完整id/file/quote；正文/回复、同名不同问题、共享项唯一决定、未绑定入口、问题内续审、问题科学核对独立。客观标记筛选不得变成科学安全判断。
- 共享批选与各项ABC，当前问题/全部及范围外数量；筛选外陈旧项需重核，不能自动升级、删除后接剩余。真实忙时写禁用、只读/模式可用；保留全批预检、源事务、宿主保存及版本校验。
- 单项/共同子集反馈、六用途及自然语言混合意图；保存不启动AI，附入Codex不发送，SKILL用途不等于批准；批注范围、译文身份、实际选区保持精确。
- SKILL公共规则、U个人跨论文习惯、P论文特定背景的三层入口、编辑、隔离、CAS与附件保持；不得因展示省略关键对象/作用域。
- 六任务、配置检测/修复/迁移、八工具、外观精确输入、PDF/源码/定位、Git范围与保护、导出、文件角色、审核高级命令均保持原处理链；不为极简删除功能入口。
- 翻译行间公式不送、纯公式明确无需翻译、行内数学和内部英文原样；结构方案标签不翻译，正文不按A/B/C字母误删。此轮不改翻译业务。

## 阶段与完成门槛

- [x] U1 唯一Terra完整读设计交接及本计划，记录真实基线、现任与租约；调查既有markup、样式、选择器、祖先与监听契约，确定保留接线的最小完整布局。结果写execution，不为普通进度发消息。
- [x] U2 在真实界面完成画布、原文/ABC、两模式统一、按需辅助入口；处理全部选择态、深浅主题、阴影、重点与异常层次。按用户选2补问题卡必要精确身份路由与真实各项动作，复用原业务链及校验。
- [x] U3 抽屉外空白关闭与自适应；保留内部交互、Esc、焦点、输入/用途/范围/批选/阅读位置，核窄窗长文本与公式。
- [x] U4 同步必要使用说明和受影响验证；按实际修改选择规定editor与DOM/消息消费者覆盖，复用适用旧证据，不机械跑backend/native/PDF/translation全组。真实无感正常Development局部UI验证、截图实际查看，深浅两模式、ABC等宽及真实按钮可用、抽屉内部/外部/Esc/尺寸/留稿、键盘与异常可见。问题卡路由重点覆盖active项与点击卡不同、相同方案字母跨不同项/文件、同名不同问题及共享项、候选更新后旧版本动作、操作中导航/重绘、失败/取消与三类未保存稿；核真正目标的源/候选/批注/决定，其他项零误写，不只断言前端消息。记录完整argv/cwd/env/输出/真实退出和业务终点，失败保留；CLI0不当业务通过。
- [x] U5 Terra审本次diff中的实际接线与所有触达入口，精确提交push/fetch，冻结产品并一次完整交包。交包列基线/commit/dirty、实际布局与展示处理器改动、保留接线证据、适用测试/首败/未测、夹具协议、截图、保护事实、无在途过程及测试/UI/隔离配置/Git租约交还。U1–U5不能代签U6。
- [x] U6 总控审实际diff和必要调用链、交包范围；只补局部未覆盖的正常Development组合：两模式与跨文件/共享项批选、三组件未保存输入及用途、抽屉收起/重开/窗口尺寸、深浅和异常状态。问题页同时多卡、宿主active项与点击目标不同，实际预览/编辑保存/批注/单项接收及原批接组合确认精确id/version/option与旧版本拒绝，不串项；必要保存/批接仅在全新隔离样例核源/决定及其他项/草稿/延期/counter/范围外stage哨兵。按实际受影响范围复用旧草稿持久化/后端/Git/PDF/export证据，不重跑全部。若失败交原Terra明确复现与返修边界，未通过不发行。
- [x] U7 U6明确通过后交原Terra核下一个正式版本（预计0.9.59，以真实tag/Release无冲突为准），必要版本/发行检查、一次构建、源码普通push/fetch、附注tag含双包摘要、正式Release/API摘要核对、同一VSIX实际CLI安装、登记/manifest核及尾记录push/fetch。不包后冒烟、不reload、不重启MCP。总控只核发行安装元数据并更新计划/index结案。

## 证据复用、资源与当前状态

0.9.58有效证据入口：`docs/implementation/review-efficiency/{plan,execution}.md`、`D:/latex-writing-checks/review-efficiency-20261122`。editor171、backend148、translation9、R1定向74及E7正常进程组合各有适用范围，不相加冒称新测。新DOM变更影响的选择器/委派/真实消费者须针对性覆盖；纯样式不能自动说明接线未破坏。无新性能测试、实网AI/翻译质量或人工吞吐承诺。此前真实失败、未知和未测保持原记录，尤其原升级重配原因未复现。

所有GUI验证遵循silent-ui-screenshot：测试宿主启动、交互、截图全程不抢焦；沿用已证未切换私有桌面CreateDesktopW/CreateProcessW.lpDesktop并核实际窗口/前台/输入桌面，不能仅凭独立profile、CDP或隐藏控制台宣布无感。截图按技能目录保留并实际查看，不删除。最多两项确已隔离的独立检查并行，共享UI/配置/Git串行。

当前：U1–U7全部完成并结案。最终功能候选d940b6，发行源码69b138c46c11defe8a1bd093519492152aea5e7b；0.9.59已正式发布并同包安装，总控已独立核tag远端解引用、Release附件摘要和本机登记/manifest。执行尾提交a33024d276190b4dddd7cafb79f0fa02e8a2fd23与origin/master一致且clean；最后计划/index结案提交按本仓普通push/fetch规则同步。全部租约已交回，无在途；未重载VSCode或重启MCP。

2026-11-23范围决定已解决：原问题卡只有复选、方案下拉和“打开本项”，段落动作以active项为目标，直接复制会串项；用户现明确选2，批准上述有限路由，不再等待确认，也不以只读三列替代最终功能。总控已审中间实际diff及两张局部截图，尚未签最终视觉或功能验收。继续原计划的极简画布、两模式同一动作组织、原文独立ABC并列、背景选择及阴影，不能只补路由而遗漏布局；原型代码仍禁止复用。

执行期间普通进度写execution，只有完整交包、必要交权、真实阻断或需决定事实发消息；总控无独立待办时按事件协调进入角色空闲，不轮询催问。

U6首次反例/R1：全新正常Development `D:/latex-writing-checks/canvas-ui-20261123/controller-busy1`，在真实sync-saved调用边界受控暂停，只为确定协调中的按钮状态，不修改产品。`coordinating=true`时原段落接收禁用、模式可切，而Q1四项ABC共12个新增问题卡接收按钮全部disabled=false。`busy-state.json`与截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-7cc4db1660a94a76ba95f3b8e599a198.png`（已看）为证；未点击接收，不称发生错写或已完成串项检查。新按钮没有原写操作标记/协调条件，实际按钮消费者与原状态脱节。需沿原动作及目标条件修正新增卡片的可操作呈现，保留后台guard与只读/模式能力；不削弱校验、不重构业务或新增自动排队/重试。

`controller-busy1-setup/prepare`各exit0，run外层exit1、observer1、host-result false（CLI0不是业务通过），真实断言失败而非观察器误判。pause已释放，自有宿主/观察器及相关进程均退出；私有桌面未切换、前中后HWND86837022与Default相同，无GUI落用户桌面，所有失败保留。完整argv/cwd/env/stdout/stderr和宿主/桌面结果在该根及同名process.json。前置只读读取曾误找不存在的fixture entry.js/项目settings文件exit1，无业务结论。复验用新样例，不重放旧状态。

U6组合/R2：`controller-combo1/2`均实际完成同名不同来源问题中非当前b/B候选保存、非当前a/B个人用途批注，独立state/source快照证明只改对应项、源未接收；随后未绑定分组无法显示5/A，尚未到三稿、迟到消息或最终批接，不称整轮通过。combo1未等卡片即报不可用；combo2按原60秒等待仍失败。独立最小正常Development `controller-unbound1`只打开未绑定分组即捕获真实 `TypeError: (entry.requests || []).some is not a function`，entry5的requests=1、hasCard=true，实际cards=0。服务目录的requests是待处理数量，关联问题条目的requests是批注数组，现标题渲染混用；这是受影响工作流的真实契约缺口，不以静态假想或夹具故障抹掉。

R2证据根仍为本轮外置根；unbound1 setup/prepare/stage各0，run外层1/observer1/host false、CLI0。`done.json`/`milestones.json`含原生error事件栈与具体entry；before/after源、state及范围外暂存逐字相同。截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-4771e33657624c508ffa2bcb66601166.png` 已查看。三轮均新项目、正常Development、未切私有桌面、前中后HWND86837022/Default一致，全部已退出，无在途。所有失败保留。外置combo2 setup首次exec变量被覆盖造成路径重复，随后只补未运行配置；stage首跑cwd重复WinError267，Git未启动，修路径后成功。combo2失败诊断函数在catch作用域不可见，原ReferenceError保留；独立unbound1另捕获原生产品错误，没有修改业务断言求绿。

R2仅修正问题卡相关目录/问题条目的待处理批注显示契约与受影响消费者，保留真实条目、计数、批注、选项及精确动作身份，不能吞错、返回空列表或拿假数组掩盖。局部验证未绑定且有/无批注与关联问题两条路径及直接动作；不重复未变全组。之后仍须U6新鲜三稿/批选、迟到动作、共享项与跨文件批接组合，核真实落盘及保护哨兵；后台Git/PDF/export未变范围复用0.9.58，独立PDF完成复用Terra ui-sixteenth。真实返修计数：2（R1忙态；R2未绑定批注契约）。最终结论、实际提交与未测据实续记。

## U6最终结论（2026-11-23）

**通过，允许进入U7。** 最终功能候选为d940b6；实际产品返修2次，分别为R1问题卡忙态与R2未绑定批注契约，不把外置观察器或夹具错误记作产品返修。已审产品实际diff与必要原处理链，未移植原型代码，新增问题卡路由复用原show、三稿保护及实际段落动作；业务事务、后端、MCP、存储和校验保持。U1–U5有效局部证据由execution记录：editor174、最终路由40项，深浅主题、447px三列、抽屉内外/Esc/焦点、真实预览/编辑/批注/接收和TinyTeX预览完成；不相加冒称一次全测。

R2最终修复仅在questionEntries汇合处生成openRequests，关联项统计真实open数组，未绑定沿真实数字，标题消费此数量；原requests不改。r2-route-first40项exit0，r2-unbound1正常Development有/无批注两类未绑定项与关联问题同显、非当前5/B个人批注独立落盘，其他项/源/counter/范围外stage保持，总控已审diff与截图。复用此前combo1/2真实b/B候选编辑和a/B个人批注落盘的局部结论，不把其整轮失败改成通过。

### 全新正常Development组合及独立消费者

证据根 `D:/latex-writing-checks/canvas-ui-20261123/controller-combo5`，最终d940b6冻结源码、新项目/profile、真实VSCode Memento、实际宿主桥与Python源事务。setup/prepare/stage/run/consume各真实exit0；host、observer和外层均0，业务结果passed。完整argv/cwd/env/stdout/stderr及退出在证据根同名前缀process.json/stdout.log/stderr.log；样例内before/after、received、milestones、host-result、run-result和consumer-result保留。

- Q1先选1/B、a/C，切Q2追加2/A；抽屉关闭与模式切换保留范围外选择。未绑定5建候选/原文/批注三类未保存输入和paper_background用途，再点另一卡4/B编辑，原保护对话框取消后仍为5，三稿/用途保持、state与两个源零写。
- 显式暂存并关闭整个工作台后重开，真实Memento保留三稿及用途；整个面板销毁会按原生命周期清空批选，记录实际空集合后由作者动作重新选择1/B、a/C、2/A。**不声称整个面板销毁后批选持久化**，不把这与抽屉/模式保留混淆。
- 夹具在出站边界暂扣a/C单项接收的一次性grant，真实导航到1后释放旧grant；旧动作被拒，零accept消息、state及源零写。没有自动重放或重试接受。
- 非当前4/B真实单项接收成功；Q2共享4只有同一份accepted决定。Q1批接精确只提交1/B、a/C，保留范围外2/A，继续当前问题的3，完整问题身份不变。
- 整宿主结束后的独立consume核实际源/状态：1/B、4/B及a/C正确，原6/A保持；2/3/5/b不变，长期批注、schema/session/rounds/counter不变。三类未保存文本未进源，仅留既有Memento；范围外sentinel的Git index内容逐字保持，未提交该文件。真实后台Git与自动PDF在此夹具禁用，不把提示“已排队”当作后台成功。

最终截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-be211da197a843229ce77c73a0742678.png` 已实际查看。该轮出现旧观察项“Cannot resolve tree item”提示：夹具host位于扩展目录外，VSCode API上下文缺失。为判定是否影响发行，另建 `controller-context1`，将宿主放在真实扩展目录由该扩展激活加载，不改产品；同样正常Development真实跨文件批接1/B+a/C成功、留在3，host捕获uiError为空、实际通知无该定位错误。setup/prepare/stage/run各0，host/observer/外层0，截图 `C:/Users/ZLK/AppData/Local/Temp/CodexUiCaptures/ui-617b102e21244257a65ec650232f1d31.png` 已看。该定向证据排除本夹具加载上下文导致的提示，不宣称验证所有未来树定位组合，也不新增产品修补。

两成功轮均CreateDesktopW/CreateProcessW.lpDesktop私有未切桌面，EnumDesktopWindows核GUI不在Default，前/中/后HWND86837022、pid59260及Default输入桌面一致，desktop_closed=true；全部自有相关进程已结束，没有重载真实窗口或重启MCP。

### 保留的外置失败与边界

controller-combo3在三稿取消/暂存及迟到grant保护之后，4/B提交因support/sitecustomize仍指向combo1管道而失败；真实宿主错误与原60秒失败保留，不算产品错误或通过。combo4新样例修正管道后4/B实际接收，随后页面销毁使外置观察器挂在旧Runtime.evaluate，后续批接尚未发出；核精确命令行后只停止自有观察器，driver-stop及done=false保留，宿主正常退出、外层1，不改写为全绿。combo5只修外置CDP上下文销毁时拒绝待决只读查询并重发现，点击/写动作不重试，原60秒验收限不变。未知结果从未在原样例重放，所有首败、源状态和截图保留。一次plan标记apply_patch未匹配完整行，未改文件，随后UTF-8精确更新。

后台Git/PDF/export、翻译、U/P资料和跨重启三稿等未变业务沿0.9.58有效证据原范围复用；本轮PDF完成用Terra ui-sixteenth，不声称禁用查看器的宿主已验证PDF查看器显示。未新增性能测试、实网AI/翻译质量、人工吞吐收益、真实用户升级重配根因、cleanup后段、独立PDF/translation全组合、复杂真实论文/冷启动、Mac、强杀或真实五分钟验证。所有真实论文、批注、未保存稿、范围外暂存、用户全局配置及活动VSCode/MCP未触碰，无删除。U7必须复用一次构建的同包发行安装，不包后冒烟，继续不重载或重启。

## U7交付与总控结案（2026-11-23）

正式版本 **0.9.59** 已发布并安装，总控只做约定元数据核验，未重新打包或做包后冒烟。发行源码 `69b138c46c11defe8a1bd093519492152aea5e7b` 相对U6功能候选d940b6的唯一产品变化是package版本0.9.58→0.9.59，其他差异只有总控已通过的计划/index；运行源码未再改。执行尾提交 `a33024d276190b4dddd7cafb79f0fa02e8a2fd23` 经总控普通fetch核HEAD==origin/master，工作区及暂存clean。

Terra版本/MCP u7-version2项exit0；发行工具u7-release-check首次12项中2项因新夹具根未创建FileNotFoundError而exit1，未改产品或断言，新根u7-release-check2的12项exit0，EOF为测试模拟错误。恰一次u7-build exit0，u7-publish exit0；实际argv/cwd/env/stdout/stderr与首次失败均在 `D:/latex-writing-checks/canvas-ui-20261123/u7-*`，execution保留。源码、标签及尾记录普通推送，没有重写历史。

总控实际读取本地附注tag及 `git ls-remote`：v0.9.59对象 `184b49d7b5beea8a2daf0bdd9314961644ec40f9`，远端及本地解引用为上述发行源码，附注含双包摘要。总控重新计算三个本地文件SHA256，并实际查询GitHub Release API；[正式Release](https://github.com/zlinkw/texscholar/releases/tag/v0.9.59) draft=false、prerelease=false，三个附件均uploaded且digest逐项一致：

- `dist/v0.9.59/texscholar-0.9.59.vsix`：`a3c12af04fee9258f137e91b4fe5c94562f804e1214cf07f3c8bf38cf45b13be`
- `dist/v0.9.59/texscholar-0.9.59-source.zip`：`25613670ba1cbe148b07b7a00b9ae7f9926c586f48d83a61f9e38137f3bf429f`
- `dist/v0.9.59/SHA256SUMS.txt`：`92a67b535f9eeae52872199e22dedc86637a6dfc68d481edb95d6b29258b221c`

同一VSIX真实CLI安装u7-install exit0、报告success，Node DEP0169弃用警告保留。总控已重读实际 `C:/Users/ZLK/.vscode/extensions/extensions.json` 及对应安装manifest：唯一local-research.latex-writing-tools登记版本与manifest均0.9.59、source=vsix、pinned=true，未把CLI成功当作运行启用证明。用户明确暂不重载或重启，因此没有替用户启用新版；日后用户自行重载对应VSCode窗口并重启MCP连接后生效。

U6通过及全部未测范围沿前文；真实论文、批注、未保存稿、范围外暂存和全局SKILL/配置未触碰，无删除。全部实现、必要验证、正式发布、同包安装及元数据核验已完成，没有必需待办。
