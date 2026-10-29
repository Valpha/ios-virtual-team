---
name: team-init
description: Set up (铺开/初始化) the standard iOS virtual team in the current workspace. Use whenever the user wants to start a new iOS app project, asks to 一键铺开/搭建/初始化虚拟团队 or 起一支团队 after discussing an app idea, or when .team is missing after cloning a repo (relink). Runs the scaffold script, links the global team layer, and pre-fills the project constitution from the discussed idea.
---

# team-init — 一键铺开 iOS 虚拟团队

把当前工作区变成一个配备完整虚拟团队的项目：团队层软链接、目录骨架、
项目宪法（AGENTS.md）、可选的项目级流水线参数。

## 前置

1. 先读 `~/.zcode/team/README.md`（团队章程）——编制、分层规则、差分格式都在那里，
   本技能不重复，以章程为准。
2. 团队层全局源固定在 `~/.zcode/team`；项目差异只进 `.team.local/`。

## 流程

### 1. 机械铺开（确定性步骤交给脚本）

```bash
bash ~/.zcode/team/scripts/scaffold.sh "$PWD"
```

脚本会：建 `.team` 软链接、建 `docs/ design/ reports/ releases/ .team.local/` 骨架、
gitignore 追加 `.team`、从模板生成 AGENTS.md。

### 2. 处理边界情况

- **`.team` 是实体目录**（旧式铺开）：不要直接删。先向用户提议迁移——把实体目录内容
  与 `~/.zcode/team` 比对合并（保留双方较新/较全版本），确认后删除实体目录并重跑脚本。
- **不是 git 仓库**：提议 `git init`（角色流水线依赖分支与 diff），用户同意后再做。
- **AGENTS.md 已存在**：脚本会跳过模板。此时必须手工把模板中
  "团队与分层规则（固定节，勿删）"一节合并进现有 AGENTS.md，缺了它分层纪律就没人守。
- **脚本输出 ERROR/WARN**：逐条处理完再继续，不要带病往下走。

### 3. 对话式预填（这是"讨论好 idea 后铺开"的价值所在）

从当前会话已讨论的内容提取，填入 AGENTS.md 的占位符：

- `{{应用名}}`、`{{一句话定位}}`、`{{技术栈}}`、`{{风格方向}}`
- 未讨论到的项保留占位符并在收尾时点名，**不要编造**。
- 若用户对流水线有明确要求（如 scheme 名、不要 UI 环节），写入项目级参数差分：
  `.team.local/workflows/feature-pipeline.config.json`（只写差异键，深合并，无需 bake）。
  用 `~/.zcode/team/scripts/resolve --config feature-pipeline` 验证合并结果。

### 4. 收尾汇报（固定格式）

```
✅ 团队已就绪
- 编制：产品 / 设计师 / 架构师 / iOS 工程师 / QA / 发布（6 张角色卡，团队层共享）
- 分层：.team(团队基底，全局) + .team.local(本项目差分)
- 待补占位：{列出未填项}
- 建议下一步：让产品角色出第一份 spec ——
  resolve --render roles/product.md 交给子 agent，附本次任务描述
```

## 纪律

- **绝不写 `.team/`**：铺开是只读团队层的操作；团队层修改走 team-edit 技能的确认门。
- 填 AGENTS.md 时不得删除或改写"团队与分层规则（固定节，勿删）"。
- `.gitkeep` 与骨架目录保留原样，角色按目录所有权各就各位。
