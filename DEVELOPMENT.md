# 开发与平台验证

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

## 保护与验证目标

用隔离样例验证配置合并／恢复、重复导入、Typst 与无 TeX 项目不变、首次打开评论、单卡片源码展开、批注与接收、原始问题关联、同一 PDF 更新、编译失败保留旧 PDF、普通缩进、私有 Git 备份与缓存引用保护。伪造的 GitHub 传输只用于隔离备份测试；公共源码仓库与论文私有备份要求不可混淆。

Windows 上已经执行的测试结果必须与 macOS 状态分开。macOS 的路径和键位模拟不是 Mac 实机验证；仍需 Mac 验证 GUI 启动环境、TeX/Perl 依赖、窗口打开与更新、Cmd/Option 冲突、文件锁、大小写敏感卷及实际 Git hooks。原生评论框宽度没有公开的扩展布局控制接口；只能使用可换行内容和短标题，不修改 VS Code/第三方渲染器，实际窄编辑区表现交实机核对。

发布前仅提交源码、说明和必要测试；不提交个人 settings、凭据、论文、候选、运行 DATA、对象缓存或测试产物。源码包可离线分享，VSIX 不内置系统工具或完整 TeX。GitHub Marketplace 上架不属于源码发布；需要实际发布者账号才能单独进行。

## 默认发布方式

仅允许本地测试、打包与直接上传 GitHub Releases。不使用 GitHub Actions、GitHub 托管 runner 或其他云端任务打包、测试、上传，不消耗 Actions 运行额度。旧发布工作流已在仓库设置中禁用；源码也没有自动触发条件，保留的手动入口所有 job 固定跳过，不能重新启用它替代本地发布。

本地完成本轮必要验证后，仅运行一次 `python scripts/build.py --output dist/v<版本>`，安装和上传都复用这两个本地产物，不为上传重打包。确认 `master` 已推送后，为该版本创建附注标签 `v<package.json 版本>`。标签注释必须含本轮已验证 VSIX 和源码包的两行 SHA256：`VSIX-SHA256: <64位摘要>`、`SOURCE-SHA256: <64位摘要>`。推送标签后，在本机执行 `python scripts/publish_release.py --tag v<版本> --repo zlinkw/texscholar --artifacts dist/v<版本>`，不触发云端任务。标签不得移动或覆盖；插件仍保持 preview 状态。

发布器只读取已存在的本地包，先核对标签摘要，再查询实际发布页。已上传且摘要相同的资产跳过，只补齐缺失资产；摘要不同就停止，不覆盖、不删除。针对实际出现的 EOF 和 502/503/504，只读 GET 最多尝试三次并保留错误；创建或上传请求不盲目重试，创建报错先回查。失败后修复网络并重新执行同一个本地上传命令，不重打包、不重跑 Actions。日志保留实际错误，成功必须经过 GitHub 返回的资产摘要核对。

需要代理时，给本次本地上传命令追加 `--proxy <当前实际 HTTP 代理地址>`，或只为该进程设置 `HTTPS_PROXY` / `HTTP_PROXY`。地址从当前系统实际配置读取，不把个人端口写入共享脚本，不改系统代理或其他应用。502 不能单凭错误码归因于代理；先检查发布页和资产是否已创建，再决定恢复动作。没有必要的产品代码变更时不为调整发布配置升级、重打包或重装现有插件。
