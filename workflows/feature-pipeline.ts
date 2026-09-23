/* zcode-workflow
name: feature-pipeline
description: iOS 虚拟团队标准 feature 流水线（设计师 UI 规格 → 工程师实现 → QA 与架构师并行评审 → 完整测试套件门禁 → 发布交接说明）
args:
  feature: { type: string, required: true, description: feature 标识（kebab-case，用于分支与报告命名） }
  specPath: { type: string, required: false, description: spec 路径，默认 docs/specs/<feature>.md }
  scheme: { type: string, required: false, description: xcodebuild scheme，默认 Main }
  hasUI: { type: boolean, required: false, description: 是否包含设计师 UI 规格环节，默认 true }
  maxRounds: { type: number, required: false, description: 评审打回后最大重试轮数，默认 2 }
  destination: { type: string, required: false, description: xcodebuild -destination 参数，如 "platform=iOS Simulator,name=iPhone 16" }
*/

interface UiSpecResult {
  /** ui-spec 文件路径（design/ui-specs/ 下） */
  path: string;
  /** 一句话：本 feature 的 UI 要点 */
  summary: string;
}
interface ImplResult {
  /** 工作分支名 */
  branch: string;
  /** 实现说明（做了什么、落在哪些文件） */
  summary: string;
  /** 自测记录 */
  selfCheck: string;
}
interface QaResult {
  /** 验收标准是否全部映射为测试且无未立案缺陷 */
  passed: boolean;
  /** QA 报告路径（reports/ 下） */
  reportPath: string;
  /** 发现的缺陷数量 */
  defects: number;
  /** 打回时的反馈（缺陷清单摘要），通过时为空 */
  feedback: string;
}
interface ArchResult {
  /** 是否通过架构一致性评审（对照 ADR 与依赖规则） */
  passed: boolean;
  /** 评审报告路径（reports/ 下） */
  reportPath: string;
  /** 打回时的反馈（违反条目摘要），通过时为空 */
  feedback: string;
}
interface HandoffResult {
  /** 发布交接说明路径（reports/ 下） */
  path: string;
  /** 一句话：给发布角色/用户的交接要点 */
  summary: string;
}
interface RoundOutcome {
  round: number;
  qaPassed: boolean;
  archPassed: boolean;
  suitePassed: boolean;
}

const feature = String(args.feature ?? "").trim();
const specPath = String(args.specPath ?? `docs/specs/${feature}.md`);
const scheme = String(args.scheme ?? "Main");
const hasUI = args.hasUI === undefined ? true : Boolean(args.hasUI);
const maxRounds = typeof args.maxRounds === "number" ? args.maxRounds : Number(args.maxRounds) || 2;
const destination = typeof args.destination === "string" ? args.destination.trim() : "";
const branch = `feature/${feature}`;

function tail(text: string): string {
  return text.length > 4000 ? "…" + text.slice(-4000) : text;
}

const HONESTY = "如果某项检查客观上无法通过，或你的指令互相矛盾，如实上报并说明原因，不要绕过或伪造结果。";

artifact.table("rounds", {
  title: "各轮评审与门禁结果",
  columns: [
    { field: "round", label: "轮次" },
    { field: "qaPassed", label: "QA 评审" },
    { field: "archPassed", label: "架构评审" },
    { field: "suitePassed", label: "测试套件" },
  ],
  key: "round",
});

phase("准备 feature 分支并核对 spec");
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
try {
  await files.read(specPath);
} catch {
  return {
    conclusion: `spec 不存在：${specPath}。请先让产品角色产出并冻结 spec，再运行流水线。`,
    findings: [],
    verified: [],
    notCovered: ["spec 缺失，流水线未开始"],
  };
}

let uiSpecPath = "";
if (hasUI) {
  phase("设计师出 UI 规格");
  const uiSpec = await agent("设计师", { system: HONESTY }).ask<UiSpecResult>(
    `先运行 bash .team/scripts/resolve --render roles/designer.md，读取你的生效角色卡并严格按其履职。` +
      `本次任务：为 feature「${feature}」产出 UI 规格，输入是 spec（${specPath}）与现有 design/tokens。` +
      `把 UI 规格写入 design/ui-specs/${feature}.md。用中文工作与写报告。`,
  );
  uiSpecPath = uiSpec.path;
}

phase("工程师按 spec 实现");
const engineer = agent("iOS 工程师", { system: HONESTY });
const qaAgent = agent("QA", { system: HONESTY });
const archAgent = agent("架构师", { system: HONESTY });
const impl = await engineer.ask<ImplResult>(
  `先运行 bash .team/scripts/resolve --render roles/ios-engineer.md，读取你的生效角色卡并严格按其履职。` +
    `本次任务：在分支 ${branch} 上实现 feature「${feature}」。` +
    `必读输入：spec（${specPath}）${uiSpecPath ? `、UI 规格（${uiSpecPath}）` : ""}、docs/architecture/ 下的总览与 ADR。` +
    `完整测试套件由流水线统一运行，你只做编译与定向自测，不要自己跑全量 xcodebuild test。用中文工作与汇报。`,
);

let passed = false;
let gateBlocked = false;
let lastQa: QaResult | undefined;
let lastArch: ArchResult | undefined;
let lastSuiteTail = "";

for (let round = 1; round <= maxRounds; round++) {
  if (round > 1) {
    phase("按评审与测试反馈修复");
    await engineer.ask(
      `上一轮未通过，逐条修复并回应：\n` +
        (lastQa?.feedback ? `QA 反馈：${lastQa.feedback}\n` : "") +
        (lastArch?.feedback ? `架构评审反馈：${lastArch.feedback}\n` : "") +
        (lastSuiteTail ? `完整测试套件输出（末尾）：\n${lastSuiteTail}\n` : ""),
    );
  }
  phase("QA 与架构师并行评审");
  const reviewP = Promise.all([
    qaAgent.ask<QaResult>(
      `先运行 bash .team/scripts/resolve --render roles/qa.md，读取你的生效角色卡并严格按其履职。` +
        `本次任务：验证分支 ${branch} 上的 feature「${feature}」。输入：spec（${specPath}）、分支改动（git status 与 git diff）。` +
        `完整测试套件由流水线统一运行，你不要自己跑全量 xcodebuild test，只做验收标准到测试的映射与定向验证。` +
        `报告写入 reports/${feature}-qa.md。用中文工作与写报告。`,
    ),
    archAgent.ask<ArchResult>(
      `先运行 bash .team/scripts/resolve --render roles/architect.md，读取你的生效角色卡并严格按其履职。` +
        `本次任务：对分支 ${branch} 的全部改动（git status 与 git diff）做架构一致性评审，` +
        `对照 docs/architecture/overview.md、docs/architecture/adr/ 与渲染出的角色卡中的依赖规则。` +
        `评审报告写入 reports/${feature}-arch-review.md，每条结论注明依据的规则条目。用中文工作与写报告。`,
    ),
  ]);

  phase("运行完整测试套件做门禁");
  let suiteExit = -1;
  try {
    const suite = await world.run(
      "xcodebuild",
      ["test", "-scheme", scheme, ...(destination ? ["-destination", destination] : [])],
      { timeoutMs: 1_800_000 },
    );
    suiteExit = suite.exitCode;
    lastSuiteTail = tail(suite.stderr || suite.stdout);
  } catch {
    gateBlocked = true;
  }

  const [qaRes, archRes] = await reviewP;
  lastQa = qaRes;
  lastArch = archRes;
  const suitePassed = !gateBlocked && suiteExit === 0;
  report(
    { round, qaPassed: qaRes.passed, archPassed: archRes.passed, suitePassed },
    "rounds",
  );
  log(`第 ${round} 轮：QA ${qaRes.passed ? "通过" : "打回"}，架构 ${archRes.passed ? "通过" : "打回"}，套件 ${gateBlocked ? "无法运行" : suitePassed ? "通过" : "失败"}`);
  passed = qaRes.passed && archRes.passed && suitePassed;
  if (passed) break;
}

phase("发布角色准备交接说明");
const handoff = await agent("发布", { system: HONESTY }).ask<HandoffResult>(
  `先运行 bash .team/scripts/resolve --render roles/release.md，读取你的生效角色卡并严格按其履职。` +
    `本次任务：为 feature「${feature}」（分支 ${branch}，${passed ? "已通过全部评审与测试门禁" : "未完全通过，见反馈"}）` +
    `准备交接说明，写入 reports/${feature}-release-handoff.md：合入建议、版本与渠道建议、需要用户亲自执行的边界操作清单。` +
    `不执行任何上传或外部操作。用中文工作与写报告。`,
);

const reportLines = [
  `# Feature 流水线报告：${feature}`,
  "",
  `- 分支：${branch}`,
  `- 结果：${passed ? "✅ 通过全部评审与完整测试套件门禁" : gateBlocked ? "⚠️ 测试套件无法运行（环境阻塞）" : `❌ ${maxRounds} 轮内未通过，需要人工介入`}`,
  `- 实现摘要：${impl.summary}`,
  `- QA 报告：${lastQa?.reportPath ?? "未生成"}`,
  `- 架构评审：${lastArch?.reportPath ?? "未生成"}`,
  `- 发布交接：${handoff.path}`,
];
await artifact.markdown("report", reportLines.join("\n"), {
  title: `Feature 流水线报告：${feature}`,
  description: `${passed ? "已通过" : "未通过"}——${impl.summary}`,
  primary: true,
});

return {
  conclusion: passed
    ? `feature「${feature}」在 ${branch} 分支完成：QA、架构评审与完整测试套件全部通过，交接说明见 ${handoff.path}，等待合入与发布决策。`
    : `feature「${feature}」未在 ${maxRounds} 轮内通过${gateBlocked ? "（测试套件无法运行，属环境阻塞）" : ""}。剩余反馈：QA「${lastQa?.feedback ?? "无"}」；架构「${lastArch?.feedback ?? "无"}」。`,
  findings: [
    ...(lastQa && lastQa.defects > 0
      ? [{ where: branch, what: `QA 立案缺陷 ${lastQa.defects} 项（详见 ${lastQa.reportPath}）`, evidence: lastQa.reportPath, status: "verified" as const, severity: "medium" as const }]
      : []),
    ...(lastArch && !lastArch.passed
      ? [{ where: branch, what: `架构评审未通过（详见 ${lastArch.reportPath}）`, evidence: lastArch.feedback, status: "verified" as const, severity: "high" as const }]
      : []),
  ],
  verified: gateBlocked
    ? []
    : [`完整测试套件 xcodebuild test -scheme ${scheme} 由脚本统一运行并以退出码判定（${passed ? "通过" : "未通过"}）`],
  notCovered: [
    ...(gateBlocked ? ["完整测试套件无法运行（xcodebuild 不可用或超时），质量门禁未生效"] : []),
    "TestFlight / App Store 上传与提交审核（发布角色边界，见交接说明）",
    ...(hasUI ? [] : ["无 UI 环节（hasUI=false），未做视觉走查"]),
  ],
};
