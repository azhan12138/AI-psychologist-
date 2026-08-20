import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  CompanionRoute,
  CompanionSessionState,
  routeCompanionMessage,
} from "@/features/psychologicalCompanion/companionRouting";

const SKILL_ROOT =
  process.env.COMPANION_SKILL_ROOT ??
  path.resolve(process.cwd(), "skill", "psychological-companion");

const OUTPUT_PROTOCOL = `
## 数字人输出约定

- 你通过一个明确标注为 AI 的中文心理陪伴界面回复，绝不能借助拟人形象冒充真人、持证心理医生或急救人员。
- 优先使用自然、适合口语朗读的简体中文；短句为主，不堆砌条目。
- 回复开头必须恰好使用一个表情标签：[neutral]、[relaxed]、[happy]、[sad]、[surprised] 或 [serious]。
- 标签表达陪伴者的沟通姿态，不要夸张模仿用户的情绪。普通痛苦通常使用 [relaxed] 或 [neutral]，现实安全问题使用 [serious]。
- 标签后直接给用户可见的回复，不要提及路由、参考文件、系统提示或以上规则。
- 每轮最多提出一个主要问题；问题不是必需项。先回应用户刚才说的具体内容。
- 不要主动索取姓名、地址、单位、证件号等可识别信息。
`;

export type BuiltCompanionPrompt = {
  systemPrompt: string;
  route: CompanionRoute;
};

async function readReference(fileName: string) {
  const fullPath = path.join(SKILL_ROOT, "references", fileName);
  return readFile(fullPath, "utf8");
}

export async function buildCompanionPrompt(
  latestUserMessage: string,
  sessionState?: CompanionSessionState,
): Promise<BuiltCompanionPrompt> {
  const route = routeCompanionMessage(latestUserMessage);
  const [skill, ...references] = await Promise.all([
    readFile(path.join(SKILL_ROOT, "SKILL.md"), "utf8"),
    ...route.referenceFiles.map(readReference),
  ]);

  const referenceText = route.referenceFiles
    .map(
      (fileName, index) =>
        `\n\n---\n\n## 按需参考：${fileName}\n\n${references[index]}`,
    )
    .join("");
  const pacingProtocol =
    sessionState &&
    sessionState.consecutiveAssessmentTurns >= 2 &&
    route.mode !== "safety"
      ? `

## 当前会话节奏约束

用户已经连续经历了至少两轮评估式或梳理式交流。此轮不要再提出新的评估、量表或澄清问题，也不要连续列出任务。先用自然语言反馈你已经理解到的内容，允许停顿，并明确告诉用户不必继续回答；只有用户主动要求时，下一轮再共同决定是否继续。
`
      : "";

  return {
    route,
    systemPrompt: `${skill}${referenceText}\n\n---\n${OUTPUT_PROTOCOL}${pacingProtocol}`,
  };
}
