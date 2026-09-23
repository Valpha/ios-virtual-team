/* zcode-workflow
description: iOS 里程碑引导流水线（PRD 分层拆解 → 设计/架构/QA 三方评审 → UI 概念稿 → 架构选型与模块拆解 ∥ QA 测试用例 → 模块并行 TDD 开发 → 架构代码审核循环 → QA 实机测试 → 完毕提示上架，未经用户确认绝不上传）
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
  /** 是否按 TDD 完成（测试先行且模块单元测试通过） */
  done: boolean;
  /** 本模块单元测试数 */
  unitTests: number;
  /** 实现说明 */
  summary: string;
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
  `先运行 bash .team/scripts/resolve --render roles/product.md，读取你的生效角色卡并严格按其履职。` +
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
      `先运行 bash .team/scripts/resolve --render roles/designer.md 读取生效角色卡。` +
        `以设计师身份评审 PRD（${prd.path}）：视觉与交互层面是否可实施、有无无法解决的冲突。只回答评审结论。`,
    ),
    architect.ask<PrdReview>(
      `先运行 bash .team/scripts/resolve --render roles/architect.md 读取生效角色卡。` +
        `以架构师身份评审 PRD（${prd.path}）：技术可行性、模块边界合理性、有无无法解决的冲突。只回答评审结论。`,
    ),
    qa.ask<PrdReview>(
      `先运行 bash .team/scripts/resolve --render roles/qa.md 读取生效角色卡。` +
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
    `模块名唯一、kebab-case，且各模块的文件/目录互不重叠（下游将并行开发）。用中文工作。`,
);
phase("QA 编写测试用例");
const tcP = qa.ask<TestCaseSuite>(
  `继续以 QA 身份履职。输入：PRD（${prd.path}）与 UI 概念稿（${concept.path}）。` +
    `本次任务：结合 PRD 需求与 UI 稿编写本里程碑的测试用例 TestCase，写入 Tests/${milestone}-testcases.md，` +
    `每条用例关联需求编号并给出判断条件。研发尚在开发，暂不执行测试。用中文工作。`,
);
const plan = await archP;

const moduleEngines = plan.modules.map((mod) => ({
  mod,
  eng: agent(`工程师-${mod}`, { system: HONESTY }),
}));

let devApproved = false;
let lastReviewFeedback = "";
let devSummaries: ModuleDev[] = [];
for (let round = 1; round <= devRounds; round++) {
  phase("各模块工程师并行 TDD 开发与按建议修复");
  devSummaries = await Promise.all(
    moduleEngines.map(({ mod, eng }) =>
      eng.ask<ModuleDev>(
        (round === 1
          ? `先运行 bash .team/scripts/resolve --render roles/ios-engineer.md，读取你的生效角色卡并严格按其履职。\n` +
            `你负责模块「${mod}」。必读：PRD（${prd.path}）、UI 概念稿（${concept.path}）、` +
            `架构总览与 ADR（${plan.path}）。在分支 ${branch} 上开发，只改动本模块目录内外的自有文件，不动其他模块。`
          : `架构师审核未通过，按以下建议修复模块「${mod}」并逐条回应：\n${lastReviewFeedback}`) +
        `\n硬性要求：TDD——先写单元测试用例再实现，本模块单元测试必须通过（可定向运行）。` +
        `不要跑全量 xcodebuild test（流水线统一跑）。用中文工作与汇报。`,
      ),
    ),
  );
  phase("架构师代码审核");
  const review = await architect.ask<CodeReview>(
    `继续以架构师身份履职。审核分支 ${branch} 上里程碑「${milestone}」的全部模块改动` +
      `（git status 与 git diff），对照你产出的 ${plan.path} 与 ADR，逐条给结论与依据。` +
      `报告写入 reports/${milestone}-arch-review.md。用中文工作。`,
  );
  lastReviewFeedback = review.feedback;
  devApproved = review.approved;
  report(
    {
      stage: "架构审核",
      round,
      result: devApproved ? "通过" : "打回",
      note: devApproved ? plan.modules.join("、") : review.feedback.slice(0, 120),
    },
    "stages",
  );
  log(`架构审核第 ${round} 轮：${devApproved ? "通过" : "打回"}`);
  if (devApproved) break;
}
if (!devApproved) {
  await tcP; // 结清在途的测试用例子任务，其产物已落盘
  return {
    conclusion: `模块开发经过 ${devRounds} 轮审核未通过，剩余修改建议：${lastReviewFeedback}。请人工介入后重跑或续跑。`,
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
  phase("工程师按缺陷并行修复");
  await Promise.all(
    moduleEngines.map(({ mod, eng }) =>
      eng.ask(
        `实机测试发现缺陷，修复属于模块「${mod}」的部分并逐条回应：\n${lastDefects}\n` +
          `修复后补齐/更新对应单元测试。不要跑全量 xcodebuild test（流水线统一跑）。`,
      ),
    ),
  );
}

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
    : [`完整测试套件 xcodebuild test -scheme ${scheme} 由脚本统一运行并以退出码判定`, "PRD 三方评审、架构代码审核（报告落盘）"],
  notCovered: [
    ...(gateBlocked ? ["完整测试套件无法运行（xcodebuild 不可用或超时），最终门禁未生效"] : []),
    "上架 / TestFlight 上传与提交审核（须用户确认后由发布流程执行，本流水线绝不自动进行）",
  ],
};
