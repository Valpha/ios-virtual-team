# iOS 虚拟团队 · 团队章程（团队层）

本目录是**团队层全局源**：角色卡基底、流水线基底、合并工具、铺开模板。
各项目仓库通过软链接 `.team` 引用本目录；项目差异存放在各仓库的 `.team.local/`（差分）。

## 编制

| 角色 | 卡片 | 一句话定义 |
|---|---|---|
| 产品 | roles/product.md | 模糊想法 → 冻结的 spec |
| 设计师 | roles/designer.md | 视觉方向 → tokens + UI 规格 + 截图走查 |
| 架构师 | roles/architect.md | 定骨架（ADR + 依赖规则）→ 评审一致性 |
| iOS 工程师 | roles/ios-engineer.md | spec + UI 规格 → 代码 |
| QA | roles/qa.md | 代码 → 测试 + 报告 |
| 发布 | roles/release.md | 合入 → 渠道投放 + 人工交接卡 |

```
产品(spec) → 设计师(tokens/ui-spec) → 工程师(实现)
    → [ QA(测试) ∥ 架构师(评审) ] → 合入 → 发布(渠道+交接卡) → 人(边界操作)
```

角色全部无状态：状态活在工件（文档/代码/git）里。角色之间只通过文件交接。

## 分层模型（两层，差分合并）

- **团队层基底** = 本目录（经项目内 `.team` 软链接访问）。改动全局生效（需确认门）。
- **项目层差分** = 项目仓库 `.team.local/`，只存差异，冲突以项目为准。
- **生效定义 = 基底 + 差分**，由 `scripts/resolve` 确定性合成。

| 场景 | 结果 |
|---|---|
| 团队层改了项目未差分的节 | 更新自动流入本项目 |
| 团队层改了项目已"替换"的节 | 冲突 → 项目为准，`resolve --check` 检出 |
| 项目"追加" | 叠加在团队当前版本之后 |
| 项目"删除"节 | 该节不出现于生效定义 |

## 差分格式规范（.team.local/roles/<name>.md）

卡片按 `## 节名` 分节；差分文件是对同名基底的操作序列，节名必须与基底**完全一致**
（含括号，如 `边界（禁止事项）`）：

```markdown
# 项目差分：qa（此行任意，仅备注）
## 替换:工作流程
1. 本项目须先跑 UI 快照基线 …

## 追加:边界
- 本项目禁止修改 SnapshotTests 目录

## 删除:工具
```

- 操作集刻意最小：`替换` / `追加` / `删除`，按整节生效；差分正文内不支持二级标题。
- 差分引用了基底不存在的节 → `--check`/`--render` 报错。
- 写完差分**必须**跑 `resolve --bake <relpath>` 记录基线指纹，否则后续冲突无法判定。

## resolve 工具手册（scripts/resolve）

```
resolve roles/qa.md            # 状态：生效来源与各节归属
resolve --render roles/qa.md   # 输出生效卡（委派子 agent / 流水线消费此产物）
resolve --config feature-pipeline   # 流水线参数深合并结果
resolve --check                # 全部差分 + 冲突检出（退出码 2 = 有冲突）
resolve --list                 # 差分清单
resolve --bake roles/qa.md     # 记录当前基底指纹（写差分后必跑）
```

无差分时 `--render` 直接输出基底（快路径）。跨机器克隆后 `.team` 缺失 → 跑 `/team-init` 恢复。

## 分发与更新（发给同事）

**打包形态**：本仓库整体即分发物——数据层（roles/workflows/scripts/scaffold）+
机制层（skills/）+ `install.sh`。动态工作流**不能**随 ZCode 插件分发（插件清单无
workflows 组件），它们以文件形态随本仓库走；`install.sh` 把流水线软链进
`~/.zcode/workflows/<name>.dwf.ts`，实现**按名运行**且保持单一事实源（已实测软链可被发现）。

**接收方三步**：
```
git clone <仓库地址> ~/任意位置 && cd 仓库
bash install.sh          # 团队层软链 + 技能注册 + 流水线按名注册（幂等）
# 在项目里跑 /team-init 铺开
```

**更新纪律**（维护者 → 接收方）：
- 维护者改团队层后打 tag（如 v1.1）；**破坏性变更（角色卡节名、差分格式、流水线 args
  契约）必须在 tag 说明中显式标注**。
- 接收方 `git pull && bash install.sh`（软链自动跟随，无需重装），随后在各项目跑
  `resolve --check`——基线指纹会报出"团队更新了你替换过的节"与"差分引用了不存在的节"。
- 接收方**不改基底**：个人差异走项目 `.team.local/` 差分；全局性改进 fork/PR 回上游。
 守住这条，pull 永远是干净快进。

## 与通用流程技能的共存（路由裁决）

本项目体系（角色卡 + 流水线）是需求与实现的**默认路由**。其他通用流程技能
（如 superpowers 的 brainstorming / writing-plans / subagent-driven-development）
不在团队项目的主流程中触发，避免双路由抢管；其调试、验证类纪律
（systematic-debugging、verification-before-completion）仍适用于主会话的临时工作。
各项目宪法以"流程路由裁决"节声明此规则（用户指令 > 技能，宪法即用户指令）。
superpowers 的微观纪律已编译进角色卡：需求三档分级（产品卡）、TDD 红绿与根因调试
（工程师卡）、评审分级与超限裁决（架构师卡）、缺陷立案纪律（QA 卡）。

## 修改纪律（agent 必须遵守）

1. **动手前**：跑 resolve 确定现状 → 向用户声明"即将修改【团队层基底/本项目差分】，
   影响范围【全部 N 个项目 / 仅本项目】" → 用户确认目标层级后才写入。
2. 项目层默认动作 = 写/改 `.team.local/` 差分（首次覆盖由工具或 agent 从基底拷节起步），
   随后 `--bake`。
3. 团队层动作 = 写 `.team/`（穿透全局），改完跑各项目 `--check` 出冲突报告。
4. **动手后**：汇报层级、路径、影响范围、是否新增遮蔽/冲突。
5. **绝不 rm/mv `.team/` 下的任何路径**：软链接穿透，删项目内路径 = 删全局文件。
   团队层的回退一律走 `git -C ~/.zcode/team checkout -- <file>`。

## 流水线运行手册

### feature-pipeline（单 feature 交付）

1. `resolve --config feature-pipeline` 得到本项目生效参数。
2. 以**团队层源码路径**启动（不复制逻辑）：
   CreateWorkflow `path` = `<本项目>/.team/workflows/feature-pipeline.ts`，
   args = 上一步合并参数 + `feature`（本次 feature 名）。
3. 子 agent 由流水线按渲染后的生效角色卡履职；门禁 = `qa.passed && archReview.passed`。

### bootstrap（里程碑引导：PRD → 实机测试完毕）

1. `resolve --config bootstrap` 得到本项目生效参数（prdRounds / devRounds / qaRounds 等）。
2. CreateWorkflow `path` = `<本项目>/.team/workflows/bootstrap.ts`，
   args = 合并参数 + `milestone`（里程碑名，kebab-case）。
3. 流程：产品产出分层 PRD（L1/L2 至少两级，最多 4 级）→ 设计/架构/QA 三方并行评审
   （任一异议打回产品返工）→ 设计师出 UI 概念稿 → 架构师选型+模块拆解+可编译骨架
   ∥ QA 编写 TestCase → 各模块工程师并行 TDD 开发 → 架构师代码审核（不通过带建议打回循环）
   → QA 实机测试（需要用户配合时出 SOP 并升级询问；缺陷打回工程师修复循环）
   → 脚本统一跑完整测试套件做最终门禁 → 报告**提示可上架，未经用户确认绝不自动上传**。
4. 两条流水线逻辑改动只发生在团队层；项目差异一律走参数差分（config.json 深合并）。

## 目录结构

```
roles/          角色卡基底（6 张）
workflows/      feature-pipeline.ts + .config.json（团队默认参数）
scripts/        resolve（合并解析）、scaffold.sh（铺开机械步骤）
scaffold/       AGENTS.md.tmpl（项目宪法模板）
```
