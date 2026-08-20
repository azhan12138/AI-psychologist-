export type CompanionMode =
  | "companionship"
  | "clarification"
  | "assessment"
  | "action"
  | "safety";

export type CompanionRoute = {
  mode: CompanionMode;
  referenceFiles: string[];
  signals: string[];
};

type ConditionRule = {
  reference: string;
  signal: string;
  explicit: RegExp;
  contextual?: (text: string) => boolean;
};

const CONDITION_RULES: ConditionRule[] = [
  {
    reference: "condition-depression.md",
    signal: "depression",
    explicit: /抑郁症|重性抑郁|depression/i,
    contextual: (text) =>
      /(两周|半个月|一个月|几个月|持续).{0,12}(低落|没兴趣|没有兴趣|什么都不想做)/.test(
        text,
      ) ||
      /(低落|没兴趣|没有兴趣).{0,20}(工作|上学|生活|关系).{0,10}(影响|做不了|撑不住)/.test(
        text,
      ),
  },
  {
    reference: "condition-anxiety-panic.md",
    signal: "anxiety-or-panic",
    explicit: /焦虑症|惊恐障碍|惊恐发作|panic attack/i,
    contextual: (text) =>
      /(持续|反复|经常).{0,10}(心慌|恐慌|强烈焦虑).{0,20}(影响|不敢|无法)/.test(
        text,
      ),
  },
  {
    reference: "condition-ocd.md",
    signal: "ocd",
    explicit: /强迫症|\bOCD\b/i,
    contextual: (text) =>
      /反复.{0,8}(检查|清洗|确认|数数).{0,16}(停不下来|影响|耗费|几个小时)/.test(
        text,
      ),
  },
  {
    reference: "condition-bipolar.md",
    signal: "bipolar-or-mania",
    explicit: /双相情感障碍|双相障碍|躁狂发作|轻躁狂|\bmania\b/i,
    contextual: (text) =>
      /(连续|已经|这几天|好几天).{0,8}(没睡|睡.{0,4}小时).{0,12}(不困|精力很好|精力旺盛)/.test(
        text,
      ) && /(冲动|投资|花钱|话很多|停不下来|觉得自己无所不能)/.test(text),
  },
  {
    reference: "condition-psychosis.md",
    signal: "psychosis",
    explicit: /精神分裂|精神病性|幻听|幻视|妄想/,
    contextual: (text) =>
      /(声音|有人).{0,10}(命令|控制|监视|跟踪|要害我)/.test(text),
  },
  {
    reference: "condition-trauma-ptsd.md",
    signal: "trauma-or-ptsd",
    explicit: /\bPTSD\b|创伤后应激|创伤后压力/i,
    contextual: (text) =>
      /(闪回|反复噩梦|像又发生了一遍).{0,18}(创伤|事故|暴力|性侵|灾难|那件事)/.test(
        text,
      ),
  },
  {
    reference: "condition-eating-disorders.md",
    signal: "eating-disorder",
    explicit: /进食障碍|神经性厌食|神经性贪食|暴食症/,
    contextual: (text) =>
      /(暴食|不敢吃|限制进食).{0,14}(催吐|泻药|体重|发胖|失控)/.test(text),
  },
  {
    reference: "condition-substance-use.md",
    signal: "substance-use",
    explicit: /酒精依赖|药物依赖|物质使用障碍|毒品成瘾|戒断/,
    contextual: (text) =>
      /(酒|大麻|冰毒|毒品|镇静药|安眠药).{0,16}(停不下来|戒不掉|越用越多|戒断)/.test(
        text,
      ),
  },
  {
    reference: "condition-insomnia.md",
    signal: "insomnia",
    explicit: /失眠症|慢性失眠/,
    contextual: (text) =>
      /(两周|一个月|几个月|长期|持续).{0,12}(睡不着|早醒|睡眠很差|失眠)/.test(
        text,
      ),
  },
];

const SAFETY_PATTERN =
  /不想活|想结束生命|自杀|割腕|跳楼|上吊|伤害自己|杀了(他|她|他们|别人)|杀人|服药过量|吞了.{0,8}(药|药片)|声音.{0,12}(让我|命令我).{0,12}(伤害|杀)/;
const OVERDOSE_OR_POISONING_PATTERN =
  /(?:刚刚|刚才|已经|之前|昨晚|今天)?[^，。！？]{0,12}(?:吃|吞|服|喝)(?:了|下)?[^，。！？]{0,12}(?:很多|好多|大量|过量|一把|一瓶|整瓶|几十片|十几片|农药|毒药|清洁剂|消毒液)[^，。！？]{0,8}(?:药|药片|安眠药|镇静药|液|剂)?|(?:药|药片|安眠药|镇静药)[^，。！？]{0,8}(?:吃|吞|服)(?:多了|过量了)|(?:一把|一瓶|整瓶|几十片|十几片)[^，。！？]{0,8}(?:药|药片|安眠药|镇静药)[^，。！？]{0,6}(?:吃|吞|服)/;
const LISTEN_ONLY_PATTERN =
  /不要分析|别分析|不要建议|别给建议|只想说说|只想倾诉|只想有人听|你听我说|陪我聊聊/;
const ASSESSMENT_PATTERN =
  /帮我评估|心理评估|做个测评|做.*量表|是不是.{0,8}(抑郁|焦虑|强迫|双相|有病)|能不能诊断|症状判断/;
const ACTION_PATTERN =
  /怎么办|怎么做|有什么方法|给我.*建议|帮我.*计划|如何改善|怎么缓解|下一步/;
const CLARIFICATION_PATTERN = /帮我理清|帮我梳理|我很乱|不知道从哪里说|说不清/;
const LONGITUDINAL_PATTERN = /持续记录|长期跟踪|下次记住|复盘|趋势|这周比上周/;

export function routeCompanionMessage(input: string): CompanionRoute {
  const text = input.trim();
  const references = new Set<string>([
    "communication-and-companionship.md",
    "safety-and-boundaries.md",
  ]);
  const signals: string[] = [];

  let mode: CompanionMode = "companionship";

  if (SAFETY_PATTERN.test(text) || isOverdoseOrPoisoningSignal(text)) {
    mode = "safety";
    signals.push("direct-safety-signal");
    references.add("assessment-and-routing.md");
  } else if (LISTEN_ONLY_PATTERN.test(text)) {
    signals.push("listen-only");
  } else if (ASSESSMENT_PATTERN.test(text)) {
    mode = "assessment";
    signals.push("assessment-request");
    references.add("assessment-and-routing.md");
    references.add("formulation-and-care-plan.md");
  } else if (ACTION_PATTERN.test(text)) {
    mode = "action";
    signals.push("action-request");
    references.add("general-interventions.md");
  } else if (CLARIFICATION_PATTERN.test(text)) {
    mode = "clarification";
    signals.push("clarification-request");
    references.add("formulation-and-care-plan.md");
  }

  for (const rule of CONDITION_RULES) {
    if (rule.explicit.test(text) || rule.contextual?.(text)) {
      references.add(rule.reference);
      signals.push(rule.signal);
    }
  }

  if (LONGITUDINAL_PATTERN.test(text)) {
    references.add("longitudinal-monitoring.md");
    signals.push("longitudinal-request");
  }

  return {
    mode,
    referenceFiles: Array.from(references),
    signals,
  };
}

export function isOverdoseOrPoisoningSignal(input: string): boolean {
  return OVERDOSE_OR_POISONING_PATTERN.test(input.trim());
}

export type CompanionSessionState = {
  turnCount: number;
  mode: CompanionMode;
  consecutiveAssessmentTurns: number;
  lastSignals: string[];
  loadedReferences: string[];
  safetyInterrupted: boolean;
};

export const initialCompanionSessionState: CompanionSessionState = {
  turnCount: 0,
  mode: "companionship",
  consecutiveAssessmentTurns: 0,
  lastSignals: [],
  loadedReferences: [],
  safetyInterrupted: false,
};

export function advanceCompanionSession(
  state: CompanionSessionState,
  userMessage: string,
): CompanionSessionState {
  const route = routeCompanionMessage(userMessage);
  const assessmentLike =
    route.mode === "assessment" || route.mode === "clarification";

  return {
    turnCount: state.turnCount + 1,
    mode: route.mode,
    consecutiveAssessmentTurns: assessmentLike
      ? state.consecutiveAssessmentTurns + 1
      : 0,
    lastSignals: route.signals,
    loadedReferences: route.referenceFiles,
    safetyInterrupted: route.mode === "safety",
  };
}

export function deriveCompanionSessionState(
  userMessages: string[],
): CompanionSessionState {
  return userMessages.reduce(
    (state, message) => advanceCompanionSession(state, message),
    initialCompanionSessionState,
  );
}
