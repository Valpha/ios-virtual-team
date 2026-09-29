/* zcode-workflow
description: 需求变更流水线（产品定位变更落入选哪本 PRD 并更新文档 → 设计/架构/QA 三方评审照旧 → 设计师评估设计影响（可结论为无需变更）→ 架构师评估架构影响并圈定实现范围 → 工程师实现 → QA 与架构师并行评审 → 完整测试套件门禁 → 发布交接，未经用户确认绝不上传）
args:
  change: { type: string, required: true, description: 变更标识（kebab-case，用于分支与报告命名） }
  description: { type: string, required: true, description: 需求变更描述（背景、期望行为、验收期望） }
  scheme: { type: string, required: false, description: xcodebuild scheme，默认 Main }
  destination: { type: string, required: false, description: xcodebuild -destination 参数，如 "platform=iOS Simulator,name=iPhone 16" }
  prdRounds: { type: number, required: false, description: PRD 三方评审返工最大轮数，默认 2 }
  maxRounds: { type: number, required: false, description: 实现评审打回后最大重试轮数，默认 2 }
*/

interface ChangePlan {
  /** 受影响并已更新的 PRD 文档路径（docs/prd/ 下，一条变更可能落入多本） */
  prdPaths: string[];
  /** 落位说明：变更落入选哪本 PRD 的哪一节（L1/L2），为什么 */
  placement: string;
  /** 一句话：本次变更内容 */
  summary: string;
}
interface PrdReview {
  /** 是否同意：变更落位合理、更新后的 PRD 无冲突可实施 */
  approved: boolean;
  /** 异议清单（注明针对哪条需求/哪处更新），通过时为空 */
  objections: string;
}
interface DesignImpact {
  /** 是否发生设计变更（false = 评估后确认无需设计变更） */
  designChanged: boolean;
  /** 本次更新的设计文档路径（无变更时为空数组） */
  docsUpdated: string[];
  /** 一句话：设计影响结论，或无需变更的理由 */
  summary: string;
}
interface ChangeArchPlan {
  /** 是否发生架构文档变更（false = 评估后确认无需变更） */
  archChanged: boolean;
  /** 本次更新的架构文档路径（无变更时为空数组） */
  docsUpdated: string[];
  /** 受影响、需要代码改动的模块名清单（空数组 = 纯文档变更，跳过实现） */
  modules: string[];
  /** 给工程师的实现要点与边界约束 */
  implementationNotes: string;
}
interface ImplResult {
  /** 实现说明（做了什么、落在哪些文件） */
  summary: string;
  /** 自测记录（build-for-testing 编译自检等） */
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

const change = String(args.change ?? "").trim();
const description = String(args.description ?? "").trim();
const scheme = String(args.scheme ?? "Main");
const prdRounds = typeof args.prdRounds === "number" ? args.prdRounds : Number(args.prdRounds) || 2;
const maxRounds = typeof args.maxRounds === "number" ? args.maxRounds : Number(args.maxRounds) || 2;
const destination = typeof args.destination === "string" ? args.destination.trim() : "";
const branch = `change/${change}`;

function tail(text: string): string {
  return text.length > 4000 ? "…" + text.slice(-4000) : text;
}

const HONESTY = "如果某项检查客观上无法通过，或你的指令互相矛盾，如实上报并说明原因，不要绕过或伪造结果。需要用户配合（环境、设备、决策）时，写清理由并通过升级机制询问，不要自作主张。";

artifact.table("rounds", {
  title: "实现评审与门禁各轮结果",
  columns: [
    { field: "round", label: "轮次" },
    { field: "qaPassed", label: "QA 评审" },
    { field: "archPassed", label: "架构评审" },
    { field: "suitePassed", label: "测试套件" },
  ],
  key: "round",
});

phase("准备变更分支");
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
const engineer = agent("工程师", { system: HONESTY });

phase("产品分析变更落位并更新 PRD");
let plan = await product.ask<ChangePlan>(
  `先运行 python3 .team/scripts/resolve --render roles/product.md，读取你的生效角色卡并严格按其履职。` +
    `本次任务：处理一条需求变更——变更描述如下：\n${description}\n` +
    `先通读 docs/prd/ 下全部既有 PRD，判断该变更应落入选哪一本 PRD 的哪一节（L1 模块 / L2 子需求），` +
    `然后调整对应描述、更新文档，并在受影响 PRD 的变更记录节追加本次条目（无该节则创建）。` +
    `若变更无法落入任何既有 PRD，或需要新建 PRD，先通过升级机制向用户说明选项并请求裁决，不要自行新建。` +
    `完成后把文档改动 commit 到 ${branch}。用中文工作与汇报。`,
);

let prdApproved = false;
let lastObjections = "";
for (let round = 1; round <= prdRounds; round++) {
  if (round > 1) {
    phase("产品按异议返工 PRD");
    plan = await product.ask<ChangePlan>(
      `三方评审对变更落位与 PRD 更新有异议，逐条处理后更新 ${plan.prdPaths.join("、")} 并 commit：\n${lastObjections}`,
    );
  }
  phase("三方并行评审变更后的 PRD");
  const verdicts = await Promise.all([
    designer.ask<PrdReview>(
      `先运行 python3 .team/scripts/resolve --render roles/designer.md 读取生效角色卡。` +
        `以设计师身份评审需求变更后的 PRD（${plan.prdPaths.join("、")}，落位：${plan.placement}）：` +
        `视觉与交互层面是否可实施、变更是否引入无法解决的冲突。只回答评审结论。`,
    ),
    architect.ask<PrdReview>(
      `先运行 python3 .team/scripts/resolve --render roles/architect.md 读取生效角色卡。` +
        `以架构师身份评审需求变更后的 PRD（${plan.prdPaths.join("、")}，落位：${plan.placement}）：` +
        `技术可行性、对既有模块边界的影响、有无无法解决的冲突。只回答评审结论。`,
    ),
    qa.ask<PrdReview>(
      `先运行 python3 .team/scripts/resolve --render roles/qa.md 读取生效角色卡。` +
        `以 QA 身份评审需求变更后的 PRD（${plan.prdPaths.join("、")}，落位：${plan.placement}）：` +
        `变更后的需求是否可验证、验收标准是否明确。只回答评审结论。`,
    ),
  ]);
  lastObjections = verdicts
    .map((v, i) => (v.approved ? "" : `${["设计师", "架构师", "QA"][i]}异议：${v.objections}`))
    .filter(Boolean)
    .join("\n");
  prdApproved = verdicts.every((v) => v.approved);
  log(`PRD 变更评审第 ${round} 轮：${prdApproved ? "三方同意" : "存在异议，返工"}`);
  if (prdApproved) break;
}
if (!prdApproved) {
  return {
    conclusion: `需求变更的 PRD 更新经过 ${prdRounds} 轮三方评审仍未通过，剩余异议：${lastObjections}。请人工澄清后重跑（分支 ${branch} 与已更新文档保留）。`,
    findings: [{ where: plan.prdPaths.join("、"), what: "PRD 变更未通过三方评审", evidence: lastObjections, status: "verified" as const, severity: "high" as const }],
    verified: [],
    notCovered: ["设计影响评估与后续实现未开始"],
  };
}

phase("设计师评估设计影响");
const designImpact = await designer.ask<DesignImpact>(
  `继续以设计师身份履职。输入：变更落位说明（${plan.placement}）与更新后的 PRD（${plan.prdPaths.join("、")}）。` +
    `本次任务：评估本次需求变更是否涉及设计变更。涉及则更新对应设计文档（design/ui-specs/、design/tokens/ 等）并 commit 到 ${branch}；` +
    `评估后确认无需任何设计改动时，如实返回 designChanged=false 并给出理由——"无需变更"是合法结论，不要为了改而改。用中文工作。`,
);

phase("架构师评估架构影响并确定实现范围");
const archPlan = await architect.ask<ChangeArchPlan>(
  `继续以架构师身份履职。输入：更新后的 PRD（${plan.prdPaths.join("、")}）与设计影响结论（${designImpact.summary}）。` +
    `本次任务：评估本次变更对架构的影响。涉及选型/模块边界/ADR 变化则更新 docs/architecture/ 下的文档并 commit 到 ${branch}` +
    `（确认无需架构变更时如实返回 archChanged=false）；同时圈定实现范围：列出受影响、需要代码改动的模块清单` +
    `（纯文档变更则返回空数组），并给出实现要点与边界约束。用中文工作。`,
);

let passed = false;
let gateBlocked = false;
let lastQa: QaResult | undefined;
let lastArch: ArchResult | undefined;
let lastSuiteTail = "";
let impl: ImplResult | undefined;
const codeChange = archPlan.modules.length > 0;

if (codeChange) {
  phase("工程师实现需求变更");
  impl = await engineer.ask<ImplResult>(
    `先运行 python3 .team/scripts/resolve --render roles/ios-engineer.md，读取你的生效角色卡并严格按其履职。` +
      `本次任务：在分支 ${branch} 上实现需求变更「${change}」。` +
      `必读输入：更新后的 PRD（${plan.prdPaths.join("、")}）、设计影响（${designImpact.summary}${designImpact.docsUpdated.length ? `，文档：${designImpact.docsUpdated.join("、")}` : "，无需设计变更"}）、` +
      `架构影响与实现要点（${archPlan.implementationNotes}，受影响模块：${archPlan.modules.join("、")}）。` +
      `按 TDD 补齐/更新对应单元测试；编译自检只跑 xcodebuild build-for-testing（scheme=${scheme}）；` +
      `不要在模拟器上运行测试——定向单测验证由 QA 统一执行；完整测试套件由流水线统一运行，不要自己跑全量。` +
      `完成后把全部改动 commit 到 ${branch}（不要 push）。用中文工作与汇报。`,
  );

  for (let round = 1; round <= maxRounds; round++) {
    if (round > 1) {
      phase("工程师按评审反馈修复变更");
      await engineer.ask(
        `上一轮未通过，逐条修复并回应：\n` +
          (lastQa?.feedback ? `QA 反馈：${lastQa.feedback}\n` : "") +
          (lastArch?.feedback ? `架构评审反馈：${lastArch.feedback}\n` : "") +
          (lastSuiteTail ? `完整测试套件输出（末尾）：\n${lastSuiteTail}\n` : "") +
          `修复后 commit 到 ${branch}，不要自己跑全量测试。`,
      );
    }
    phase("QA 与架构师并行评审");
    const [qaRes, archRes] = await Promise.all([
      qa.ask<QaResult>(
        `继续以 QA 身份履职。本次任务：验证分支 ${branch} 上的需求变更「${change}」。` +
          `输入：更新后的 PRD（${plan.prdPaths.join("、")}）与分支改动（git status 与 git diff）。` +
          `验收标准逐条映射到测试；定向验证变更相关单元测试（工程师已 build-for-testing 备好产物，` +
          `优先 xcodebuild test-without-building，不可用则退回 xcodebuild test；scheme=${scheme}，串行执行无争用）。` +
          `不要跑全量（流水线统一跑）。报告写入 reports/${change}-qa.md。用中文工作与写报告。`,
      ),
      architect.ask<ArchResult>(
        `继续以架构师身份履职。本次任务：对分支 ${branch} 的全部改动（git status 与 git diff）做架构一致性评审，` +
          `对照 docs/architecture/overview.md、docs/architecture/adr/ 与角色卡中的依赖规则，` +
          `重点核对本次变更未破坏既有模块边界。评审报告写入 reports/${change}-arch-review.md，每条结论注明依据的规则条目。用中文工作。`,
      ),
    ]);
    lastQa = qaRes;
    lastArch = archRes;

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
    const suitePassed = !gateBlocked && suiteExit === 0;
    report(
      { round, qaPassed: qaRes.passed, archPassed: archRes.passed, suitePassed },
      "rounds",
    );
    log(`第 ${round} 轮：QA ${qaRes.passed ? "通过" : "打回"}，架构 ${archRes.passed ? "通过" : "打回"}，套件 ${gateBlocked ? "无法运行" : suitePassed ? "通过" : "失败"}`);
    passed = qaRes.passed && archRes.passed && suitePassed;
    if (passed) break;
  }
} else {
  phase("运行完整测试套件做回归门禁");
  try {
    const suite = await world.run(
      "xcodebuild",
      ["test", "-scheme", scheme, ...(destination ? ["-destination", destination] : [])],
      { timeoutMs: 1_800_000 },
    );
    passed = suite.exitCode === 0;
    lastSuiteTail = tail(suite.stderr || suite.stdout);
  } catch {
    gateBlocked = true;
  }
  log(`纯文档变更：跳过实现与评审，仅跑回归套件（${gateBlocked ? "无法运行" : passed ? "通过" : "失败"}）`);
}

phase("发布角色准备交接说明");
const handoff = await agent("发布", { system: HONESTY }).ask<HandoffResult>(
  `先运行 python3 .team/scripts/resolve --render roles/release.md，读取你的生效角色卡并严格按其履职。` +
    `本次任务：为需求变更「${change}」（分支 ${branch}，${passed ? "已通过评审与测试门禁" : "未完全通过，见反馈"}）` +
    `准备交接说明，写入 reports/${change}-release-handoff.md：合入建议、版本与渠道建议、需要用户亲自执行的边界操作清单。` +
    `不执行任何上传或外部操作。用中文工作与写报告。`,
);

const reportLines = [
  `# 需求变更流水线报告：${change}`,
  "",
  `- 分支：${branch}`,
  `- 结果：${passed ? "✅ 通过评审与完整测试套件门禁" : gateBlocked ? "⚠️ 测试套件无法运行（环境阻塞）" : `❌ ${codeChange ? maxRounds : 1} 轮内未通过，需要人工介入`}`,
  `- 变更摘要：${plan.summary}`,
  `- PRD 落位：${plan.placement}（${plan.prdPaths.join("、")}）`,
  `- 设计影响：${designImpact.designChanged ? `已更新（${designImpact.docsUpdated.join("、")}）` : "无需设计变更"}——${designImpact.summary}`,
  `- 架构影响：${archPlan.archChanged ? `已更新（${archPlan.docsUpdated.join("、")}）` : "无需架构变更"}；实现范围：${codeChange ? archPlan.modules.join("、") : "纯文档变更，无代码改动"}`,
  ...(impl ? [`- 实现摘要：${impl.summary}`] : []),
  `- QA 报告：${codeChange ? lastQa?.reportPath ?? "未生成" : "不适用（纯文档变更）"}`,
  `- 架构评审：${codeChange ? lastArch?.reportPath ?? "未生成" : "不适用（纯文档变更）"}`,
  `- 发布交接：${handoff.path}`,
];
await artifact.markdown("report", reportLines.join("\n"), {
  title: `需求变更流水线报告：${change}`,
  description: `${passed ? "已通过" : "未通过"}——${plan.summary}`,
  primary: true,
});

return {
  conclusion: passed
    ? `需求变更「${change}」在 ${branch} 分支完成：PRD 三方评审、${codeChange ? "实现评审与完整测试套件" : "回归测试套件"}全部通过，交接说明见 ${handoff.path}，等待合入与发布决策。`
    : `需求变更「${change}」未通过${gateBlocked ? "（测试套件无法运行，属环境阻塞）" : ""}。剩余反馈：QA「${lastQa?.feedback ?? "无"}」；架构「${lastArch?.feedback ?? "无"}」。`,
  findings: [
    ...(lastQa && lastQa.defects > 0
      ? [{ where: branch, what: `QA 立案缺陷 ${lastQa.defects} 项（详见 ${lastQa.reportPath}）`, evidence: lastQa.reportPath, status: "verified" as const, severity: "medium" as const }]
      : []),
    ...(lastArch && !lastArch.passed
      ? [{ where: branch, what: `架构评审未通过（详见 ${lastArch.reportPath}）`, evidence: lastArch.feedback, status: "verified" as const, severity: "high" as const }]
      : []),
  ],
  verified: gateBlocked
    ? ["PRD 三方评审（报告落盘）"]
    : [`完整测试套件 xcodebuild test -scheme ${scheme} 由脚本统一运行并以退出码判定`, "PRD 三方评审（报告落盘）", ...(codeChange ? ["QA 定向单测验证（test-without-building 优先）"] : [])],
  notCovered: [
    ...(gateBlocked ? ["完整测试套件无法运行（xcodebuild 不可用或超时），质量门禁未生效"] : []),
    "TestFlight / App Store 上传与提交审核（发布角色边界，见交接说明）",
    ...(codeChange ? [] : ["纯文档变更，未做实机测试（无代码改动）"]),
  ],
};
