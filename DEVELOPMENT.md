# 开发与平台验证

## 固定审核页与内置 MCP

发行仍为单个 VSIX。`review_workbench.js` 管理唯一标签页，`review_workbench_client.js` 管理局部 DOM、选区与未保存草稿。`source_review.py` 是唯一持久化核心，底部编号列表、固定审核页和 `mcp_server.py` 共用其 writer_lock、版本校验及 persist；MCP 直接调用核心，不再启动每次读写的 Python CLI 子进程。AI 单方案 CLI propose/rework 已移除，作者的 edit-option 与接收入口独立保留。待审并列选项同属一个快照和编号，接收将 chosen option 纳入原有成果投影。

`mcp_setup.js` 将稳定启动器与可信工作区登记放入扩展 globalStorage，不向论文项目增加管理文件。`mcp_config.py` 仅维护带专属标记的 texscholar MCP 表，保留其他配置、个人启停和额外超时项，拒绝接管未标记的同名服务；不读写 SKILL。MCP 为本地 STDIO，不需要云服务、密钥或新端口。连接可发现不等于模型语义必定遵守；结构校验不冒充科学核验。重载后以实际 MCP 列表为准。

本轮保护区：真实论文、审核决定及 Typst 配置不作为开发样例。隔离检查覆盖单选接收、跨文档复用、精确 B 批注、其他备选保留、旧操作拒绝、并发保护、MCP 初始化/调用/配置、真实完整 PDF 与反向映射。沿用现有 editor/backend/pdf/backup/translation 组；无额外性能门槛。Windows 原生 UI 与实际工具检查单列，Mac 仅静态路径/键位适配，不是实机通过。

唯一插件源码位于 `src/`，根目录 `package.json` 为发行清单；旧本机脚本和 SKILL 内历史分发副本不是新的维护入口。纯 JavaScript 直接运行，不需要 npm install、TypeScript 转译或独立编译缓存。打包只组装已经验证的源文件，不重新运行测试；安装和发行使用同一个 VSIX。

## 开发依赖

Node.js 22 或更新版本、Python 3.12 或更新的 Python 3、Git、tex-fmt、TeX Live/TinyTeX/MacTeX。Python PDF 测试另需 `pypdf`，不是插件后端的运行依赖。ChkTeX 测试需要实际安装的 LaTeX Workshop 的 `out/src/lint/latex-code-actions.js`，通过环境变量指定，不依赖个人扩展目录或固定版本。

通过 UTF-8 设置以下环境变量，再执行检查脚本：

- `LOCAL_LATEX_TEST_ROOT`：专用保留目录，路径含 `latex-writing-checks`；不指向真实论文。
- `LOCAL_LATEX_GIT` / `SOURCE_REVIEW_GIT`：当前平台的 Git。
- `LOCAL_LATEX_FORMATTER`：tex-fmt。
- `LOCAL_LATEX_PYTHON`：Python 3.12+。
- `LOCAL_LATEX_TEXBIN`：实际 TeX 工具所在目录。
- `LOCAL_LATEX_CHECKCITES` / `LOCAL_LATEX_CHKTEX`：对应工具。
- `LOCAL_LATEX_WORKSHOP`：上述 Workshop 实际模块。
- `SOURCE_REVIEW_FIXTURES`：隔离后端样例目录。

```text
python scripts/check.py --group editor
python scripts/check.py --group backend
python scripts/check.py --group backup
python scripts/check.py --group pdf
python scripts/check.py --group translation
python scripts/build.py --output dist
```

每个组先保留完整 stdout/stderr，脚本返回真实子进程状态。独立组最多两个并行，分别使用独立样例目录；不对共享缓存、真实仓库或界面做并行写入。测试产物不自动清理，不纳入 Git。没有性能基准或等待时限承诺。

translation 组以模拟响应检查各来源协议、完整分块、数学／引用保护、失败与不换源行为，不访问网络。实际服务可用性另用合成文字检查，不发送论文；接口返回 401／限流须如实报告，不能把协议单测当服务连通证明。翻译使用 Python 标准库，不依赖第三方翻译插件的私有接口。

Google／Bing 的请求协议以 Translate for Zotero 的 `src/modules/services/google.ts` 与 `bing.ts` 为参考，Python 适配独立实现。Google token 按 UTF-8 字节执行 32 位整数运算，非 ASCII 与补充平面字符均须保留；Google 两个主机不自动切换。请求头相同不代表 Python 网络栈与 Zotero 完全相同，也不能据此保证匿名服务稳定性。维护时对照请求格式，不直接搬入 AGPL 插件实现或引入浏览器凭据。

Google 的 UI 调用传 `proxy=null`，后端明确调用 Windows 注册表／macOS System Configuration 的系统代理读取接口；不使用会被仅有 `NO_PROXY` 的继承环境遮蔽的默认发现顺序。其他来源的显式代理或显式直连保持原意。默认发现为每次点击重读，不保存个人地址，现有 `urllib` 的目标地址绕过规则保留。PAC 自动配置不在当前静态代理支持范围内；Mac 系统调用分支有隔离协议检查，仍未实机验证。

各来源一次发送完整原文、候选或问题摘录，不再按 500 字符发多个请求；不截断长文。UI 从当前仍有效的其他卡片复用同来源、同文字的成功译文，不复用失败或自动换源。TranSmart 对齐 Zotero 的 header、client_key、Referer 和请求正文。DeepL 保留可用的第一方 oneshot 接口：Zotero 当前 DeepLX JSON-RPC 接口在本轮实测 HTTP 成功但返回旧客户端升级通知，并非译文，不能用它替换有效接口或把该通知标成翻译成功。其官方密钥接口不冒充免密钥入口，不接入不明中转。

默认 Bing，自动翻译默认开启。仅为当前固定审核页的原文、备选和关联问题顺序翻译，事件驱动，不预翻译源码可见范围或整个项目，不自动重试／换源。译文只供阅读，不写入论文、状态或 Git。

底部 `texscholar.reviewList` 是受支持的 TreeView，通过显式编号命令直接打开同一个固定审核页。它不创建 CommentController，也不借源码选择事件间接跟随导航，因此源码内不再生成旧原生批注框；VS Code 和其他插件的原生评论不受影响。同一源码行的多个审核项分别显示，批注、精确选区、候选编辑、接收、拒绝、关联问题及 PDF 操作统一在固定页中执行。源文件选区批注命令把原文 UTF-16 选区传到固定页，保存时仍经核心转换和验证，不读取原生评论卡片的选区。

本次回归范围为编辑界面及其必要调用链：底部编号选择与唯一标签复用、同一行独立编号、精确原文批注及 Codex 附件、草稿保护、明确接收方案后转下一项、自动更新现有 PDF、普通代码项目不触发。后端持久化、PDF 差异算法、Git 备份和翻译协议未改，不重跑其独立全量组。测试替换的是已退役原生评论外框的 UI 专用断言；原有正文保护、显示和工作流行为在新入口继续验证。

0.9.1 Windows 检查：editor 组首次 61/65 通过，4 个失败为新夹具把未保存编辑同时当作磁盘快照，修正夹具后对受影响入口定向补跑；新增文件事件样例最初未修改所通知的源文件，改为通知实际状态拥有文件。最终 inline_review、review_workbench、writing 共 15 项通过，其余 editor 组覆盖复用同轮已通过结果。原生 VS Code 隔离界面完成正文／回复信切换、精确 B 批注、手动编辑、底部编号导航、接收 B 后自动下一项；未发现旧 review-widget，1308px 审核页三列无横向溢出。首轮原生自动化等待旧网页上下文未结束，保留失败日志；修正等待方式后完成实际界面检查，退出码 0。Mac 没有实机验证。检查日志保留在开发机隔离目录，不随源码发布个人路径或论文数据。

## 保护与验证目标

用隔离样例验证配置合并／恢复、重复导入、Typst 与无 TeX 项目不变、首次打开底部列表、固定页源码展开、批注与接收、原始问题关联、同一 PDF 更新、编译失败保留旧 PDF、普通缩进、私有 Git 备份与缓存引用保护。伪造的 GitHub 传输只用于隔离备份测试；公共源码仓库与论文私有备份要求不可混淆。

Windows 上已经执行的测试结果必须与 macOS 状态分开。macOS 的路径和键位模拟不是 Mac 实机验证；仍需 Mac 验证 GUI 启动环境、TeX/Perl 依赖、窗口打开与更新、Cmd/Option 冲突、文件锁、大小写敏感卷及实际 Git hooks。审核列表和固定网页使用 VS Code 公开接口，不修改 VS Code/第三方渲染器。

发布前仅提交源码、说明和必要测试；不提交个人 settings、凭据、论文、候选、运行 DATA、对象缓存或测试产物。源码包可离线分享，VSIX 不内置系统工具或完整 TeX。GitHub Marketplace 上架不属于源码发布；需要实际发布者账号才能单独进行。

## 默认发布方式

仅允许本地测试、打包与直接上传 GitHub Releases。不使用 GitHub Actions、GitHub 托管 runner 或其他云端任务打包、测试、上传，不消耗 Actions 运行额度。旧发布工作流已在仓库设置中禁用；源码也没有自动触发条件，保留的手动入口所有 job 固定跳过，不能重新启用它替代本地发布。

本地完成本轮必要验证后，仅运行一次 `python scripts/build.py --output dist/v<版本>`，安装和上传都复用这两个本地产物，不为上传重打包。确认 `master` 已推送后，为该版本创建附注标签 `v<package.json 版本>`。标签注释必须含本轮已验证 VSIX 和源码包的两行 SHA256：`VSIX-SHA256: <64位摘要>`、`SOURCE-SHA256: <64位摘要>`。推送标签后，在本机执行 `python scripts/publish_release.py --tag v<版本> --repo zlinkw/texscholar --artifacts dist/v<版本>`，不触发云端任务。标签不得移动或覆盖；插件仍保持 preview 状态。

发布器只读取已存在的本地包，先核对标签摘要，再查询实际发布页。已上传且摘要相同的资产跳过，只补齐缺失资产；摘要不同就停止，不覆盖、不删除。针对实际出现的 EOF 和 502/503/504，只读 GET 最多尝试三次并保留错误；创建或上传请求不盲目重试，创建报错先回查。失败后修复网络并重新执行同一个本地上传命令，不重打包、不重跑 Actions。日志保留实际错误，成功必须经过 GitHub 返回的资产摘要核对。

需要代理时，给本次本地上传命令追加 `--proxy <当前实际 HTTP 代理地址>`，或只为该进程设置 `HTTPS_PROXY` / `HTTP_PROXY`。地址从当前系统实际配置读取，不把个人端口写入共享脚本，不改系统代理或其他应用。502 不能单凭错误码归因于代理；先检查发布页和资产是否已创建，再决定恢复动作。没有必要的产品代码变更时不为调整发布配置升级、重打包或重装现有插件。
