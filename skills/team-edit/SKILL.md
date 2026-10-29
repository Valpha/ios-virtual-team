---
name: team-edit
description: Modify iOS virtual team definitions with correct layering (分层修改). Use whenever the user wants to change role definitions (角色/角色卡), team architecture, pipeline logic or pipeline params (流水线/workflow 参数), make a change affect all projects (团队级/全局) or only the current project (项目级/本项目), resolve a layer conflict, or asks which layer (团队层还是项目层) a definition currently comes from. Announces the target layer and gets confirmation before any write.
---

# team-edit — 分层修改路由

核心职责：任何对角色/流水线定义的修改，**先判定层级、向用户声明、确认后写入、
事后汇报**。层级判定必须基于 `resolve` 的确定性输出，不靠猜。

## 前置

1. 读 `~/.zcode/team/README.md`（章程）——差分格式规范与合并规则以它为准。
2. 工具：`~/.zcode/team/scripts/resolve`（下文简称 `resolve`，需在项目根目录运行）。

## 第一步：路由分类

| 用户请求指向 | 路由 |
|---|---|
| specs / tokens / ADR / 报告等项目工件 | 不是 team-edit 的事，直接改项目文件即可 |
| 角色卡内容（职责/边界/流程…） | 本文「角色卡修改」 |
| 流水线参数（scheme、maxRounds、hasUI…） | 本文「流水线参数修改」 |
| 流水线逻辑（阶段/门禁/顺序） | 仅团队层可改（v1 约束），走「团队层写入」并提醒：项目差异应表达为参数或团队层新开关 |

## 第二步：层级判定与声明（写前强制）

先跑 `resolve <relpath>`（或 `resolve --list`）看现状，然后向用户声明：

> 即将修改【团队层基底 / 本项目差分】
> 影响范围【全部并行项目立即生效 / 仅本项目】
> 确认目标层级？

判定依据：用户明确说"团队/全部项目/全局/其他项目也要" → 团队层；
明确说"就这个项目/本项目" → 项目层；**未明说 → 必须问**，默认建议项目层（影响面小）。
团队层写入未获确认前，一个字节都不能写 `.team/`。

## 角色卡修改

### 项目层（默认）

1. 写差分 `.team.local/roles/<name>.md`，操作集只有三种，节名必须与基底**完全一致**
   （含括号，先 `resolve --render roles/<name>.md` 对照节名）：

   ```markdown
   ## 替换:工作流程
   1. …（整节换成这里的内容，冲突时以本项目为准）

   ## 追加:边界（禁止事项）
   - …（叠加到团队当前版本之后）

   ## 删除:工具
   ```

2. `resolve --bake roles/<name>.md` —— 记录基线指纹，**必跑**，否则将来团队层更新无法检出冲突。
3. `resolve --render roles/<name>.md` 人工核对合并结果。

### 团队层

1. 获用户确认后直接编辑 `.team/roles/<name>.md`（经软链接写入全局源，立即对全部项目生效）。
2. 冲突扫描：本项目跑 `resolve --check`；其他并行项目尽力扫描：

   ```bash
   for d in ~/.zcode/workspace/*/ ; do
     [ -d "${d}.team.local" ] && (cd "$d" && ~/.zcode/team/scripts/resolve --check)
   done
   ```

3. 汇报里列出所有 CONFLICT（哪些项目的哪些节保持项目版）。

## 流水线参数修改

项目差异写 `.team.local/workflows/<name>.config.json`（只写差异键，深合并，项目键覆盖）；
团队默认改 `.team/workflows/<name>.config.json`（团队层，需确认）。
验证：`resolve --config <name>`。

## 事后汇报（固定格式）

```
✅ 修改完成
- 层级：团队层基底 / 本项目差分
- 路径：{文件}
- 影响范围：{全部 N 个项目 / 仅本项目}
- 冲突：{无 / 清单（项目保持项目版的节）}
```

## 纪律

- 一次请求只动一层；两层都要动时拆成两次声明确认。
- 团队层改动的汇报必须附冲突报告（哪怕是"无"）。
- 删除项目差分 = 恢复继承团队版，删后重跑 `resolve --check` 确认无残留。
- **绝不 rm/mv `.team/` 下的路径**：软链接穿透，删项目内路径 = 删全局文件。
  团队层回退走 `git -C ~/.zcode/team checkout -- <file>`。
