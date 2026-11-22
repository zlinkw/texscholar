# 选择式交互与配置持久化执行记录

2026-11-22：按已批准计划接手 C1–C5。基线 dcdf947，master 跟踪 origin/master；真实论文及其状态、草稿、范围外暂存均受保护。产品、测试及隔离 UI 租约归执行者；总控负责计划和 C6。尚未验证或发行。

只读准备：实核本会话 gpt-6.1-terra/high/default，连续性 match/continue、4 次压缩。读取计划、索引与交付技能。尝试读取不存在的 src/mcp_setup.test.js 返回文件不存在；后续定位实际测试入口，不当作测试通过。

C1/C2 开发中：任务选项、项目和范围、区分指令、说明预览及成功类别记忆；配置引导分流。保留程序调用目标与写作选区入口。C3/C4 同一候选开发中，尚未冻结。C1 定向 src/writing.test.js：首次 c1-writing exit 1，新增测试夹具在查找元素时错误多次 shift，修正后 c1-writing-2 exit 0（11 项）；完整 cwd、argv、环境与 stdout/stderr 在 D:/latex-writing-checks/choice-settings-20261122 对应目录。非产品缺陷。两次未加引号的 node --check 因 PowerShell 将空格路径解析为 C:/Program 而 exit 1；改为调用运算符并引用路径后 backup.js 和 mcp_setup.js 语法检查 exit 0。当前仍需备份、配置、工作台受影响回归及规定 editor 组。

隔离 C3 取消测试 c3-cancel exit 0（1 项），实际 Git 状态、文件及模拟脏缓冲保存调用均未改变。editor-final-1 组 exit 1（163 项中 11 失败）：执行环境误设 LOCAL_LATEX_TEX_FMT 而非测试所需 LOCAL_LATEX_FORMATTER，真实 tex-fmt 无法启动，相关失败保留原日志；不是组通过，需以正确变量重跑规定组。

editor-final-2、editor-final-3 使用正确 LOCAL_LATEX_FORMATTER，均 exit 0、164 项；后续仍有 C1/C3/C4 产品修改，需最终候选重新验证。c1-integration-1 exit 0（11 项），含实际命令模拟附件和任务类别；setup-1 exit 0（7 项），含插件自有旧路径迁移、未托管路径拒绝和设置取消；c3-target-3 exit 0（3 项），含两入口取消不保存、确认后仅所选缓冲保存，所选目标因非 GitHub 远端被实际拒绝；c3-consumers exit 0（4 项），用真实隔离 Git 和模拟 GitHub 元数据核提交推送、暂存、隐私与 hook。命令、环境和完整输出各目录 process.txt/stdout.log/stderr.log。原 cleanup 后段及独立 PDF/translation 全组未跑。

工具设置的 package.json 现有 scope 为 machine，不能从工作区或论文目录指定可执行程序；选择界面只提供用户机器级设置，保留该安全边界。尚需总控 C6 真实跨进程、隔离版本路径和真实 UI 验证，不能将模拟 Memento 当持久化证明；用户原环境升级反复配置的具体根因仍未知。

最终产品候选的 editor-final-4 exit 0（164 项），完整命令与环境在目录 process.txt；后续仅修改 backup.js，故 editor 覆盖不失效。c3-final-stage exit 0（8 项），包括实际隔离 Git 正常推送、已暂存范围外文件逐字保留、所选文件与已有暂存重叠时拒绝、拒绝公开目标和 hook；同时覆盖两入口取消和仅保存选中脏缓冲。普通项目备份可保留范围外暂存；审核成果检查点沿用原有整暂存区非空拒绝，保护但不备份，不能声称此入口支持带范围外暂存完成推送。未运行真实 cleanup 后段，未做真实 UI 跨进程或原用户环境升级测试。

editor-final-5 对更新后的公共 backup 模块再次运行规定组 exit 0（164 项）。随后仅在备份按钮增加选择项与手动暂存重叠的提前拒绝，并扩展该按钮测试；c3-overlap-final exit 0（3 项），确认重叠在保存脏缓冲前拒绝。该后续变化不触及 editor 命令或共享后端；组合覆盖为 editor-final-5 与 c3-overlap-final。所有执行日志均保留，未将首败改为通过。
