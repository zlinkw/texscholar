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
python scripts/build.py --output dist
```

每个组先保留完整 stdout/stderr，脚本返回真实子进程状态。独立组最多两个并行，分别使用独立样例目录；不对共享缓存、真实仓库或界面做并行写入。测试产物不自动清理，不纳入 Git。没有性能基准或等待时限承诺。

## 保护与验证目标

用隔离样例验证配置合并／恢复、重复导入、Typst 与无 TeX 项目不变、首次打开评论、单卡片源码展开、批注与接收、原始问题关联、同一 PDF 更新、编译失败保留旧 PDF、普通缩进、私有 Git 备份与缓存引用保护。伪造的 GitHub 传输只用于隔离备份测试；公共源码仓库与论文私有备份要求不可混淆。

Windows 上已经执行的测试结果必须与 macOS 状态分开。macOS 的路径和键位模拟不是 Mac 实机验证；仍需 Mac 验证 GUI 启动环境、TeX/Perl 依赖、窗口打开与更新、Cmd/Option 冲突、文件锁、大小写敏感卷及实际 Git hooks。原生评论框宽度没有公开的扩展布局控制接口；只能使用可换行内容和短标题，不修改 VS Code/第三方渲染器，实际窄编辑区表现交实机核对。

发布前仅提交源码、说明和必要测试；不提交个人 settings、凭据、论文、候选、运行 DATA、对象缓存或测试产物。源码包可离线分享，VSIX 不内置系统工具或完整 TeX。GitHub Marketplace 上架不属于源码发布；需要实际发布者账号才能单独进行。
