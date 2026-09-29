/* zcode-workflow
description: iOS 里程碑引导流水线（PRD 分层拆解 → 设计/架构/QA 三方评审 → UI 概念稿 → 架构选型与模块拆解并经用户亲自确认 → ∥ QA 测试用例 → 模块 git worktree 隔离并行 TDD（编译互不干扰）→ QA 串行单测验证 → 架构师逐分支评审并亲自合并 → QA 实机测试 → 完毕提示上架，未经用户确认绝不上传）
args:
  milestone: { type: string, required: true, description: 里程碑标识（kebab-case，用于分支与文档命名） }
  scheme: { type: string, required: false, description: xcodebuild scheme，默认 Main }
  destination: { type: string, required: false, description: 最终套件门禁的 xcodebuild -destination 参数（实机测试由 QA 自行选择设备） }
  prdRounds: { type: number, required: false, description: PRD 评审返工最大轮数，默认 2 }
  devRounds: { type: number, required: false, description: 架构审核打回最大轮数，默认 2 }
  qaRounds: { type: number, required: false, description: 实机测试缺陷修复最大轮数，默认 2 }
*/

interface PrdResult {
  /** PRD 文档路径（docs/prd/ 下） */
  path: string;
  /** 需求拆解的实际最大层级数（L1 起算，须 2–4） */
  maxDepth: number;
  /** L1 模块数 */
  l1Count: number;
  /** 一句话：本里程碑范围 */
  summary: string;
}
interface PrdReview {
  /** 是否同意：可实施、无无法解决的冲突 */
  approved: boolean;
  /** 异议清单（注明针对哪条 L1/L2 需求），通过时为空 */
  objections: string;
}
interface UiConcept {
  /** UI 概念稿路径（design/concepts/ 下） */
  path: string;
  /** 一句话：视觉与布局要点 */
  summary: string;
}
interface ArchPlan {
  /** 架构总览文档路径（docs/architecture/overview.md，含选型与 ADR 引用） */
  path: string;
  /** 拆解出的模块名清单（唯一、kebab-case，目录互不重叠） */
  modules: string[];
  /** 一句话：技术选型结论 */
  summary: string;
  /** 用户是否已亲自审阅并确认架构与模块划分（经升级机制获用户批准） */
  userApproved: boolean;
}
interface TestCaseSuite {
  /** 测试用例文档路径 */
  path: string;
  /** 用例条数 */
  caseCount: number;
  /** 一句话：覆盖情况 */
  summary: string;
}
interface ModuleDev {
  /** 模块名 */
  module: string;
  /** 是否按 TDD 完成（测试先行、build-for-testing 编译通过、改动已提交模块分支） */
  done: boolean;
  /** 本模块单元测试用例数（运行验证由 QA 串行执行，不由工程师自跑） */
  unitTests: number;
  /** 实现说明 */
  summary: string;
}
interface ModuleVerify {
  /** 模块名 */
  module: string;
  /** 该模块定向单元测试是否全部通过 */
  passed: boolean;
  /** 失败用例清单与原因（通过时为空） */
  feedback: string;
}
interface CodeReview {
  /** 是否通过架构代码审核 */
  approved: boolean;
  /** 审核报告路径 */
  reportPath: string;
  /** 打回时的修改建议，通过时为空 */
  feedback: string;
}
interface DeviceTest {
  /** 实机测试是否全部通过 */
  passed: boolean;
  /** 测试报告路径 */
  reportPath: string;
  /** 立案缺陷数 */
  defects: number;
  /** 打回时的缺陷清单摘要，通过时为空 */
  feedback: string;
  /** 是否需要用户配合（环境/设备/证书） */
  needsUser: boolean;
  /** SOP 文件路径（含环境要求、操作手顺、判断条件；不需要时为空） */
  sopPath: string;
}

const milestone = String(args.milestone ?? "").trim();
const scheme = String(args.scheme ?? "Main");
const destination = typeof args.destination === "string" ? args.destination.trim() : "";
const prdRounds = typeof args.prdRounds === "number" ? args.prdRounds : Number(args.prdRounds) || 2;
const devRounds = typeof args.devRounds === "number" ? args.devRounds : Number(args.devRounds) || 2;
const qaRounds = typeof args.qaRounds === "number" ? args.qaRounds : Number(args.qaRounds) || 2;
const branch = `bootstrap/${milestone}`;
const prdPath = `docs/prd/${milestone}.md`;

function depthOk(d: number): boolean {
  return d >= 2 && d <= 4;
}

const HONESTY =
  "如果某项检查客观上无法通过，或你的指令互相矛盾，如实上报并说明原因，不要绕过或伪造结果。" +
  "需要用户配合（环境、设备、决策）时，写清 SOP 与判断条件并通过升级机制询问，不要自作主张。";

artifact.table("stages", {
  title: "各阶段轮次结果",
  columns: [
    { field: "stage", label: "阶段" },
    { field: "round", label: "轮次" },
    { field: "result", label: "结果" },
    { field: "note", label: "备注" },
  ],
});

phase("准备里程碑分支");
const created = await world.run("git", ["checkout", "-b", branch]);
if (created.exitCode !== 0) {
  const resumed = await world.run("git", ["checkout", branch]);
  if (resumed.exitCode !== 0) {
    return {
      conclusion: `无法建立或切换到分支 ${branch}（当前目录可能不是 git 仓库）。请先初始化仓库再运行流水线。`,
      findings: [],
      verified: [],
      notCovered: ["git 分支准备失败，流水线未开始"],
    };
  }
}

const product = agent("产品", { system: HONESTY });
const designer = agent("设计师", { system: HONESTY });
const architect = agent("架构师", { system: HONESTY });
const qa = agent("QA", { system: HONESTY });

phase("产品输出分层 PRD");
let prd = await product.ask<PrdResult>(
  `先运行 python3 .team/scripts/resolve --render roles/product.md，读取你的生效角色卡并严格按其履职。` +
    `本次任务：为里程碑「${milestone}」产出 PRD，写入 ${prdPath}。` +
    `硬性要求：按模块拆解需求，至少两级（L1 模块 / L2 子需求），更细可拆 L3、L4，但最大层级不超过 4；` +
    `每条 L2 及以下需求必须可验证。输入：AGENTS.md 项目速览与既有 docs/。用中文工作与写文档。`,
);

let prdApproved = false;
let lastObjections = "";
for (let round = 1; round <= prdRounds; round++) {
  const depthIssue = depthOk(prd.maxDepth)
    ? ""
    : `层级不合规：当前最大 ${prd.maxDepth} 级，须在 2–4 级之间。`;
  if (round > 1 || depthIssue) {
    phase("产品按异议返工 PRD");
    prd = await product.ask<PrdResult>(
      `PRD 需要返工，逐条处理以下意见后更新 ${prdPath}：\n${lastObjections}${depthIssue ? "\n" + depthIssue : ""}`,
    );
  }
  phase("三方并行评审 PRD");
  const verdicts = await Promise.all([
    designer.ask<PrdReview>(
      `先运行 python3 .team/scripts/resolve --render roles/designer.md 读取生效角色卡。` +
        `以设计师身份评审 PRD（${prd.path}）：视觉与交互层面是否可实施、有无无法解决的冲突。只回答评审结论。`,
    ),
    architect.ask<PrdReview>(
      `先运行 python3 .team/scripts/resolve --render roles/architect.md 读取生效角色卡。` +
        `以架构师身份评审 PRD（${prd.path}）：技术可行性、模块边界合理性、有无无法解决的冲突。只回答评审结论。`,
    ),
    qa.ask<PrdReview>(
      `先运行 python3 .team/scripts/resolve --render roles/qa.md 读取生效角色卡。` +
        `以 QA 身份评审 PRD（${prd.path}）：每条 L2 及以下需求是否可验证、验收标准是否明确。只回答评审结论。`,
    ),
  ]);
  lastObjections = [
    ...verdicts.map((v, i) =>
      v.approved ? "" : `${["设计师", "架构师", "QA"][i]}异议：${v.objections}`,
    ),
    depthOk(prd.maxDepth) ? "" : `层级不合规：当前最大 ${prd.maxDepth} 级，须在 2–4 级之间。`,
  ]
    .filter(Boolean)
    .join("\n");
  prdApproved = depthOk(prd.maxDepth) && verdicts.every((v) => v.approved);
  report(
    {
      stage: "PRD 评审",
      round,
      result: prdApproved ? "通过" : "返工",
      note: lastObjections ? lastObjections.slice(0, 120) : "三方均同意",
    },
    "stages",
  );
  log(`PRD 第 ${round} 轮评审：${prdApproved ? "三方同意" : "存在异议，返工"}`);
  if (prdApproved) break;
}
if (!prdApproved) {
  return {
    conclusion: `PRD 经过 ${prdRounds} 轮仍未获三方一致同意，剩余异议：${lastObjections}。请人工介入澄清需求后重跑。`,
    findings: [{ where: prd.path, what: "PRD 未通过三方评审", evidence: lastObjections, status: "verified" as const, severity: "high" as const }],
    verified: [],
    notCovered: ["PRD 未定稿，后续阶段未开始"],
  };
}

phase("设计师产出 UI 概念稿");
const concept = await designer.ask<UiConcept>(
  `继续以设计师身份履职。PRD 已定稿（${prd.path}）。` +
    `本次任务：产出里程碑「${milestone}」的 UI 概念稿，写入 design/concepts/${milestone}.md，` +
    `基于现有 design/tokens（如无则提出方向建议并说明待定稿）。用中文工作。`,
);

phase("架构师技术选型与模块拆解");
const archP = architect.ask<ArchPlan>(
  `继续以架构师身份履职。输入：PRD（${prd.path}）与 UI 概念稿（${concept.path}）。` +
    `本次任务：完成技术架构选型与模块拆解——更新 docs/architecture/overview.md、` +
    `把必要决策落成 docs/architecture/adr/ 下的 ADR、搭好可编译的工程骨架（模块目录与协议占位）。` +
    `模块名唯一、kebab-case，且各模块的文件/目录互不重叠（下游将并行开发）。` +
    `完成后把骨架与文档改动 commit 到 ${branch}（各模块稍后从该提交拉出并行工作树）；` +
    `同时把 .worktrees/ 追加进 .gitignore（没有则创建）并一并提交——那是并行开发的工作树目录，绝不能被 git 跟踪。\n` +
    `提交完成、返回结果之前必须经过用户确认门：通过升级机制把方案摘要（技术选型结论、模块清单、ADR 清单、` +
    `docs/architecture/overview.md 路径）发给用户亲自审阅，明确询问"架构与模块划分是否批准、是否可以开始并行开发"；` +
    `用户批准后才返回 userApproved=true。用户提出异议就按意见修订、commit 后再次请求确认；` +
    `升级次数用尽仍未获用户确认时，如实返回 userApproved=false——绝不自行代表用户批准。用中文工作。`,
);
phase("QA 编写测试用例");
const tcP = qa.ask<TestCaseSuite>(
  `继续以 QA 身份履职。输入：PRD（${prd.path}）与 UI 概念稿（${concept.path}）。` +
    `本次任务：结合 PRD 需求与 UI 稿编写本里程碑的测试用例 TestCase，写入 Tests/${milestone}-testcases.md，` +
    `每条用例关联需求编号并给出判断条件。研发尚在开发，暂不执行测试。用中文工作。`,
);
const plan = await archP;
if (!plan.userApproved) {
  await tcP;
  return {
    conclusion: `架构与模块划分未获用户亲自确认，流水线在模块开发前停止。架构文档见 ${plan.path}（分支 ${branch}），可人工修订或调整意见后重跑流水线（已有产物与分支会被复用）。`,
    findings: [{ where: plan.path, what: "架构方案未获用户确认", evidence: "架构师经升级机制请求用户批准，未获通过", status: "verified" as const, severity: "high" as const }],
    verified: ["PRD 三方评审（已通过）"],
    notCovered: ["模块并行开发、实机测试与最终门禁未开始（测试用例文档已产出，见 Tests/）"],
  };
}

phase("为各模块创建并行开发的独立工作树");
await world.run("git", ["worktree", "prune"]);
const dirty = await world.run("git", ["status", "--porcelain"]);
if (dirty.stdout.split("\n").some((l) => l.trim() && !l.trim().startsWith("?? .worktrees"))) {
  await world.run("git", ["add", "-A", "--", ".", ":(exclude).worktrees"]);
  await world.run("git", ["commit", "-m", `checkpoint: ${milestone} 模块并行开发前基线`]);
}
const baseRev = await world.run("git", ["rev-parse", "HEAD"]);
const baselineSha = baseRev.stdout.trim();
const topRev = await world.run("git", ["rev-parse", "--show-toplevel"]);
const repoRoot = topRev.stdout.trim();

const moduleEngines = plan.modules.map((mod) => ({
  mod,
  eng: agent(`工程师-${mod}`, { system: HONESTY }),
  wtPath: `.worktrees/${milestone}/${mod}`,
  wtBranch: `${branch}-wt/${mod}`,
}));
for (const m of moduleEngines) {
  let added = (await world.run("git", ["worktree", "add", m.wtPath, "-b", m.wtBranch])).exitCode === 0;
  if (!added) added = (await world.run("git", ["worktree", "add", m.wtPath, m.wtBranch])).exitCode === 0;
  if (!added) {
    const listed = await world.run("git", ["worktree", "list", "--porcelain"]);
    added = listed.stdout.split("\n").some((l) => l.startsWith("worktree ") && l.includes(m.wtPath));
  }
  if (!added) {
    await tcP;
    return {
      conclusion: `无法为模块「${m.mod}」创建独立工作树（${m.wtPath}，分支 ${m.wtBranch}）。请检查 git worktree 状态后重跑流水线（已存在的分支与工作树会被复用）。`,
      findings: [{ where: m.wtPath, what: "模块工作树创建失败", evidence: `目标分支 ${m.wtBranch}`, status: "verified" as const, severity: "high" as const }],
      verified: [],
      notCovered: ["模块并行开发未开始"],
    };
  }
}
log(`已为 ${moduleEngines.length} 个模块建好独立工作树（DerivedData 按工程路径隔离，并行编译互不干扰），基线提交 ${baselineSha.slice(0, 8)}`);

const commitResidue = async (only?: { mod: string; wtPath: string }): Promise<void> => {
  for (const t of only ? [only] : moduleEngines) {
    const residue = await world.run("git", ["-C", t.wtPath, "status", "--porcelain"]);
    if (residue.exitCode === 0 && residue.stdout.trim()) {
      await world.run("git", ["-C", t.wtPath, "add", "-A"]);
      await world.run("git", ["-C", t.wtPath, "commit", "-m", `${t.mod}: 模块改动（流水线代提交）`]);
    }
  }
};

let devApproved = false;
let lastReviewFeedback = "";
let lastQaFeedback = "";
let devSummaries: ModuleDev[] = [];
for (let round = 1; round <= devRounds; round++) {
  phase("各模块工程师在独立工作树并行开发与修复");
  devSummaries = await Promise.all(
    moduleEngines.map(({ mod, eng, wtPath, wtBranch }) =>
      eng.ask<ModuleDev>(
        (round === 1
          ? `先在主工作树 ${repoRoot} 下运行 python3 .team/scripts/resolve --render roles/ios-engineer.md，读取你的生效角色卡并严格按其履职。\n` +
            `你负责模块「${mod}」。必读：PRD（${prd.path}）、UI 概念稿（${concept.path}）、架构总览与 ADR（${plan.path}）。\n` +
            `你在专属工作树 ${repoRoot}/${wtPath}（分支 ${wtBranch}，自基线 ${baselineSha.slice(0, 8)} 拉出）内开发：` +
            `所有文件编辑与编译都在该目录下进行，不碰主工作树，不动其他模块的文件。`
          : `上一轮验证或评审未通过，回到你的工作树 ${repoRoot}/${wtPath}（分支 ${wtBranch}），修复模块「${mod}」并逐条回应：\n${lastReviewFeedback}${lastQaFeedback ? `\nQA 单测验证反馈：${lastQaFeedback}` : ""}`) +
        `\n硬性要求：TDD——先写单元测试用例再实现；` +
        `编译自检只跑 xcodebuild build-for-testing（scheme=${scheme}，在你的工作树内运行，各工作树 DerivedData 相互独立）；` +
        `不要在模拟器上运行测试——单元测试的运行验证统一由 QA 串行执行（验证资源集中管理）；` +
        `新文件放进本模块目录（工程用文件夹同步组自动纳入，不要手改 project.pbxproj）；不要跑全量 xcodebuild test。` +
        `完成后把本模块全部改动 commit 到 ${wtBranch}（不要 push）。用中文工作与汇报。`,
      ),
    ),
  );
  await commitResidue();

  phase("QA 串行验证各模块单元测试");
  lastQaFeedback = "";
  let allVerified = true;
  for (const m of moduleEngines) {
    const verifyAsk =
      `继续以 QA 身份履职。你是验证资源的独占者，各模块验证必须串行逐个进行，一次只验一个：` +
      `现在只验证模块「${m.mod}」——工作树 ${repoRoot}/${m.wtPath}，工程师已用 build-for-testing 备好测试产物，` +
      `优先 xcodebuild test-without-building 定向运行该模块的单元测试（产物不可用则退回 xcodebuild test 定向运行；` +
      `scheme=${scheme}，模拟器自选——串行执行无争用）。只验证该模块，不跑全量。用中文汇报。`;
    let verify = await qa.ask<ModuleVerify>(verifyAsk);
    if (!verify.passed) {
      await m.eng.ask(
        `QA 串行验证你的模块「${m.mod}」未通过：\n${verify.feedback}\n` +
          `回到工作树 ${repoRoot}/${m.wtPath} 修复并 commit（不要自己跑模拟器测试，修完提交即可，QA 会复审）。用中文。`,
      );
      await commitResidue(m);
      verify = await qa.ask<ModuleVerify>(`复审模块「${m.mod}」（工作树 ${repoRoot}/${m.wtPath}）：${verifyAsk}`);
    }
    if (!verify.passed) {
      allVerified = false;
      lastQaFeedback += `模块 ${m.mod}：${verify.feedback}\n`;
    }
  }
  report(
    { stage: "QA 单测验证", round, result: allVerified ? "通过" : "存在失败", note: lastQaFeedback ? lastQaFeedback.slice(0, 120) : `${plan.modules.length} 个模块全部通过` },
    "stages",
  );
  log(`QA 串行验证第 ${round} 轮：${allVerified ? "全部通过" : "存在失败模块"}`);

  phase("架构师逐模块分支评审并合并");
  const review = await architect.ask<CodeReview>(
    `继续以架构师身份履职。各模块已在独立分支完成开发${allVerified ? "并通过 QA 单测验证" : "（注意：部分模块未通过 QA 单测验证，未通过的分支不要合并）"}。` +
      `逐分支评审：对每个模块分支（${moduleEngines.map((m) => m.wtBranch).join("、")}），` +
      `用 git diff ${baselineSha}..<该分支> 查看自基线以来的全部改动，对照你产出的 ${plan.path} 与 ADR 逐条给结论与依据。` +
      `评审通过且 QA 验证通过的分支，由你亲自执行 git merge --no-ff --no-edit 合并进 ${branch}` +
      `（合并冲突自行解决——你是模块边界的定义者；确实无法两全的分支不合并，在反馈中写明要求）。` +
      `全部模块处理完后，报告写入 reports/${milestone}-arch-review.md。用中文工作。`,
  );
  lastReviewFeedback = review.feedback;
  devApproved = review.approved && allVerified;
  report(
    {
      stage: "架构审核",
      round,
      result: devApproved ? "通过" : "打回",
      note: devApproved ? plan.modules.join("、") : review.feedback.slice(0, 120),
    },
    "stages",
  );
  log(`架构审核第 ${round} 轮：${devApproved ? "通过并合并" : "打回"}`);
  if (devApproved) break;
}
if (!devApproved) {
  await tcP; // 结清在途的测试用例子任务，其产物已落盘
  return {
    conclusion: `模块开发经过 ${devRounds} 轮审核未通过，剩余修改建议：${lastReviewFeedback}。各模块工作树与分支已保留（.worktrees/ 与 ${branch}-wt/ 前缀），人工介入后重跑流水线可续跑。`,
    findings: [{ where: branch, what: "架构代码审核未通过", evidence: lastReviewFeedback, status: "verified" as const, severity: "high" as const }],
    verified: [],
    notCovered: ["实机测试与最终门禁未开始（测试用例文档已产出，见 Tests/）"],
  };
}

const testCases = await tcP;

let qaPassed = false;
let lastDefects = "";
let device: DeviceTest | undefined;
for (let round = 1; round <= qaRounds; round++) {
  phase("QA 实机测试");
  device = await qa.ask<DeviceTest>(    `继续以 QA 身份履职。测试用例见 ${testCases.path}，研发已完成并通过架构审核（分支 ${branch}）。` +
      `本次任务：执行实机测试。若需要用户配合（连接真机、证书、账号等），先把 SOP 写入` +
      ` reports/${milestone}-qa-sop.md（含环境要求、逐步操作手顺、明确的测试判断条件），` +
      `再通过升级机制询问用户是否完成准备，确认后继续。不通过的缺陷逐条立案（编号/复现步骤/严重级），` +
      `报告写入 reports/${milestone}-qa.md。用中文工作。`,
  );
  qaPassed = device.passed;
  if (qaPassed) {
    report({ stage: "实机测试", round, result: "通过", note: `${testCases.caseCount} 条用例` }, "stages");
    log(`实机测试第 ${round} 轮：全部通过`);
    break;
  }
  lastDefects = device.feedback;
  report({ stage: "实机测试", round, result: "打回", note: lastDefects.slice(0, 120) }, "stages");
  log(`实机测试第 ${round} 轮：${device.defects} 项缺陷，已打回修复`);
  phase("工程师在各自工作树按缺陷并行修复");
  await Promise.all(
    moduleEngines.map(({ mod, eng, wtPath, wtBranch }) =>
      eng.ask(
        `实机测试发现缺陷，回到你的工作树 ${repoRoot}/${wtPath}（分支 ${wtBranch}）修复属于模块「${mod}」的部分并逐条回应：\n${lastDefects}\n` +
          `修复后补齐/更新对应单元测试并 commit 到 ${wtBranch}（不要在模拟器上跑测试，也不要跑全量 xcodebuild test——验证统一由 QA 与流水线执行）。`,
      ),
    ),
  );
  await commitResidue();
  phase("架构师复审缺陷修复分支并合并");
  const fixReview = await architect.ask<CodeReview>(
    `继续以架构师身份履职。工程师已按实机缺陷在各模块分支完成修复。` +
      `逐分支查看各模块分支相对 ${branch} 的增量（git log ${branch}..<分支> 与 git diff ${branch}..<分支>），` +
      `确认修复合理且不破坏架构约束后，把每个通过复审的分支 git merge --no-ff --no-edit 合并进 ${branch}` +
      `（冲突自行解决，无法两全的不合并并说明）。合并结果摘要写入 reports/${milestone}-fix-review.md。用中文工作。`,
  );
  if (!fixReview.approved) {
    return {
      conclusion: `缺陷修复未通过架构师复审：${fixReview.feedback}。流水线停止（各模块工作树与分支已保留，人工处理后续跑可复用）。`,
      findings: [{ where: branch, what: "缺陷修复合并未完成", evidence: fixReview.feedback, status: "verified" as const, severity: "high" as const }],
      verified: [`实机测试已发现缺陷并立案（报告 ${device?.reportPath ?? "未生成"}）`],
      notCovered: ["缺陷修复未全部合入主线，最终门禁未运行"],
    };
  }
}

phase("清理各模块工作树与分支");
for (const { wtPath, wtBranch } of moduleEngines) {
  await world.run("git", ["worktree", "remove", "--force", wtPath]);
  await world.run("git", ["branch", "-d", wtBranch]);
}
await world.run("git", ["worktree", "prune"]);

phase("运行完整测试套件做最终门禁");
let gateBlocked = false;
let suitePassed = false;
try {
  const suite = await world.run(
    "xcodebuild",
    ["test", "-scheme", scheme, ...(destination ? ["-destination", destination] : [])],
    { timeoutMs: 1_800_000 },
  );
  suitePassed = suite.exitCode === 0;
} catch {
  gateBlocked = true;
}

const allPassed = qaPassed && !gateBlocked && suitePassed;
const reportLines = [
  `# 里程碑引导报告：${milestone}`,
  "",
  `- 分支：${branch}`,
  `- 结果：${allPassed ? "✅ 全流程通过（PRD 三方评审 → UI 概念稿 → 模块 TDD 开发 → 架构审核 → 实机测试 → 套件门禁）" : "⚠️ 未完全通过，见下"}`,
  `- PRD：${prd.path}（${prd.l1Count} 个 L1 模块，最大 ${prd.maxDepth} 级拆解）`,
  `- UI 概念稿：${concept.path}`,
  `- 架构与模块拆解：${plan.path}（模块：${plan.modules.join("、")}）`,
  `- 并行开发：git worktree 隔离 + QA 串行单测验证 + 架构师评审合并（模块分支已并入 ${branch}，工作树已清理）`,
  `- 模块交付：${devSummaries.map((d) => `${d.module}（${d.unitTests} 个单测${d.done ? "" : "，未完成"}）`).join("、")}`,
  `- 测试用例：${testCases.path}（${testCases.caseCount} 条）`,
  `- 实机测试：${device?.reportPath ?? "未生成"}${device?.needsUser && device.sopPath ? `（需要用户配合，SOP：${device.sopPath}）` : ""}`,
  `- 最终套件门禁：${gateBlocked ? "无法运行（环境阻塞）" : suitePassed ? "通过" : "失败"}`,
  "",
  allPassed
    ? "**本里程碑开发流程已完毕，可以进入上架等发布操作。发布须由用户确认后启动，本流水线不会自动上传。**"
    : `**未完全通过：${!qaPassed ? `实机测试存在未解决缺陷（${lastDefects.slice(0, 200)}）` : ""}${gateBlocked ? "最终套件无法运行" : !suitePassed ? "最终测试套件未通过" : ""}。**`,
];
await artifact.markdown("report", reportLines.join("\n"), {
  title: `里程碑引导报告：${milestone}`,
  description: allPassed ? "全流程通过，等待用户决定发布" : "存在未解决项",
  primary: true,
});

return {
  conclusion: allPassed
    ? `里程碑「${milestone}」引导完成：PRD 三方评审通过、${plan.modules.length} 个模块 TDD 开发并过架构审核、实机测试与完整测试套件全部通过。可以进入发布流程——须你确认后才会执行，本流水线未做任何上传。`
    : `里程碑「${milestone}」未完全通过：${!qaPassed ? "实机测试仍有缺陷未解决" : gateBlocked ? "最终套件无法运行（环境阻塞）" : "最终测试套件未通过"}。相关报告见 reports/。`,
  findings: [
    ...(device && device.defects > 0
      ? [{ where: branch, what: `实机测试累计立案缺陷 ${device.defects} 项（${device.passed ? "已全部修复关闭" : "仍有未关闭项"}）`, evidence: device.reportPath, status: "verified" as const, severity: device.passed ? "low" as const : "high" as const }]
      : []),
  ],
  verified: gateBlocked
    ? ["PRD 三方评审、架构代码审核（报告落盘）"]
    : ["QA 串行单测验证（逐模块定向执行）", `完整测试套件 xcodebuild test -scheme ${scheme} 由脚本统一运行并以退出码判定`, "PRD 三方评审、架构代码审核（报告落盘）"],
  notCovered: [
    ...(gateBlocked ? ["完整测试套件无法运行（xcodebuild 不可用或超时），最终门禁未生效"] : []),
    "上架 / TestFlight 上传与提交审核（须用户确认后由发布流程执行，本流水线绝不自动进行）",
  ],
};
