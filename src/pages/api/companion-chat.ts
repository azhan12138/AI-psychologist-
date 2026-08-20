import type { NextApiRequest, NextApiResponse } from "next";

import {
  CompanionRoute,
  CompanionSessionState,
  deriveCompanionSessionState,
  isOverdoseOrPoisoningSignal,
} from "@/features/psychologicalCompanion/companionRouting";
import { buildCompanionPrompt } from "@/server/companionPrompt";

type ClientMessage = {
  role: "user" | "assistant";
  content: string;
};

type CompanionResponse = {
  text: string;
  emotion: AvatarEmotion;
  provider: "demo" | "ollama" | "openai-compatible";
  route?: {
    mode: CompanionRoute["mode"];
    references: string[];
  };
};

type CompanionStatus = {
  provider: CompanionResponse["provider"];
};

type AvatarEmotion =
  | "neutral"
  | "relaxed"
  | "happy"
  | "sad"
  | "surprised"
  | "serious";

const EMOTION_PATTERN =
  /^\s*\[(neutral|relaxed|happy|sad|surprised|serious)\]\s*/i;
export const config = {
  api: {
    bodyParser: {
      sizeLimit: "64kb",
    },
  },
};

function normalizeMessages(value: unknown): ClientMessage[] {
  if (!Array.isArray(value)) {
    throw new Error("messages must be an array");
  }

  return value.slice(-20).map((item) => {
    if (
      !item ||
      (item.role !== "user" && item.role !== "assistant") ||
      typeof item.content !== "string"
    ) {
      throw new Error("invalid message");
    }

    return {
      role: item.role,
      content: item.content.trim().slice(0, 2000),
    };
  });
}

function parseTaggedText(raw: string): {
  text: string;
  emotion: AvatarEmotion;
} {
  const match = raw.match(EMOTION_PATTERN);
  const emotion = (match?.[1]?.toLowerCase() ?? "relaxed") as AvatarEmotion;
  const text = raw.replace(EMOTION_PATTERN, "").trim();
  return {
    emotion,
    text:
      text ||
      "我还在这里。你不用马上把事情讲清楚，可以从此刻最明显的一点开始。",
  };
}

function demoReply(
  input: string,
  route: CompanionRoute,
  sessionState: CompanionSessionState,
): string {
  if (route.mode === "safety") {
    if (isOverdoseOrPoisoningSignal(input)) {
      return "[serious]这可能是需要立即处理的医疗紧急情况。请不要等待症状变化，也不要自行催吐；如果你在中国大陆，请现在拨打 120 或立即前往急诊，并让一个可信任的人陪在身边、带上药物或物品包装；不在中国大陆时请联系当地急救。心理援助热线不能替代急救。我无法定位你或主动派出救援。你现在能否立刻拨打急救电话，或把手机交给身边的人代为联系？";
    }

    return "[serious]我很在意你刚才说的内容。先不处理其他事情，我需要直接确认：你现在是否已经伤害了自己或他人，或者有准备马上实施的计划和手段？如果已经发生或危险迫近，在中国大陆请立即拨打 120 或 110；也请让一个可信任的人现在来到你身边，先不要独处，并远离可能造成伤害的东西。若危险并非迫近但你需要真人支持，可拨打全国心理援助热线 12356。我无法定位你或主动派出救援。你可以只回答“已经发生”“可能马上发生”或“目前没有”。";
  }

  if (
    sessionState.consecutiveAssessmentTurns >= 2 &&
    (route.mode === "assessment" || route.mode === "clarification")
  ) {
    return "[relaxed]我们先暂停继续评估，不再往下追问。到目前为止，我听见的是这件事已经持续占据你不少精力，而你正在努力弄明白自己怎么了。你现在不必再回答问题，也可以只在这里缓一缓；等你主动想继续时，我们再一起决定下一小步。";
  }

  if (/不要分析|别分析|不要建议|别给建议|只想.*(说|倾诉|有人听)/.test(input)) {
    return "[relaxed]好，我先不分析，也不急着把它变成一个需要解决的问题。听起来你已经把很多东西撑在心里了；你想从哪里说都可以，停一会儿也可以。";
  }

  if (/累|撑不住|精疲力尽|没力气/.test(input)) {
    return "[relaxed]听起来你已经撑了很久。那种累可能不只是身体上的，也像是一直需要应付、解释或保持正常带来的消耗。现在不用急着解决什么，我们可以先把节奏慢下来。";
  }

  if (/分手|失恋|离开我|想念.*(他|她)/.test(input)) {
    return "[sad]失去一段重要关系以后，想念、委屈和空下来常常会一起出现。你不需要现在就逼自己放下；这份难受也说明那段关系对你确实很重要。";
  }

  if (/焦虑|心慌|担心|害怕/.test(input)) {
    return "[relaxed]我听到的是，你的身体和脑子都像还停在警戒状态里。我们先不急着给它下结论；如果你愿意，可以只挑此刻最让你不安的那一件事说。";
  }

  if (route.mode === "assessment") {
    return "[neutral]可以一起做初步梳理，但这不会替代诊断。为了不让它变成连续做题，我们先只看一个最有用的信息：这些变化大约持续多久了，又是否已经明显影响睡眠、工作或关系？";
  }

  if (route.mode === "action") {
    return "[neutral]可以，我们先不铺开很多方法。眼下更合适的是找一个足够小、今天做得到的动作；在给建议前，我想先确认你更希望缓解此刻的难受，还是处理造成它的现实问题？";
  }

  if (route.mode === "clarification") {
    return "[relaxed]没关系，不需要一次讲清楚。我们可以先把它拆得很小：此刻最占地方的是一种情绪、一个人，还是一件具体发生的事？";
  }

  if (/谢谢|好一些|好多了|开心|终于/.test(input)) {
    return "[happy]能感觉到这里有了一点松动。先不用把它放大成“必须一直好下去”；这一点点变化本身就值得被看见。";
  }

  const companionshipReplies = [
    "[relaxed]我在听。你说的这件事对你应该不只是表面上的那一点，它可能还牵着一些委屈、在意或没有被看见的需要。你不必讲得完整，我会跟着你的节奏。",
    "[relaxed]我还跟得上。你刚才补充的这一点，让我感觉这件事可能比一开始更复杂。我们先不急着归纳；你可以沿着最想说的部分继续。",
    "[relaxed]听见了。这里好像既有发生的事情，也有它留在你心里的感受。你不用同时处理两边，先停在对你最重要的一处就好。",
    "[relaxed]我在。你不必担心说得重复或不够有条理；有些感受本来就是在慢慢说的过程中，才一点点显出轮廓。",
  ];
  return companionshipReplies[
    Math.max(sessionState.turnCount - 1, 0) % companionshipReplies.length
  ];
}

function openAiEndpoint(baseUrl: string) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1")
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
}

function configuredProvider(): CompanionResponse["provider"] {
  const configured = (
    process.env.COMPANION_LLM_PROVIDER ?? "demo"
  ).toLowerCase();
  return configured === "ollama"
    ? "ollama"
    : configured === "openai-compatible"
      ? "openai-compatible"
      : "demo";
}

async function callConfiguredModel(
  provider: CompanionResponse["provider"],
  systemPrompt: string,
  messages: ClientMessage[],
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  try {
    if (provider === "ollama") {
      const baseUrl =
        process.env.COMPANION_LLM_BASE_URL ?? "http://127.0.0.1:11434";
      const model = process.env.COMPANION_LLM_MODEL;
      if (!model) {
        throw new Error("COMPANION_LLM_MODEL is required for Ollama");
      }

      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: false,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
        }),
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }
      const data = await response.json();
      return String(data.message?.content ?? "");
    }

    const baseUrl = process.env.COMPANION_LLM_BASE_URL;
    const model = process.env.COMPANION_LLM_MODEL;
    if (!baseUrl || !model) {
      throw new Error(
        "COMPANION_LLM_BASE_URL and COMPANION_LLM_MODEL are required",
      );
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (process.env.COMPANION_LLM_API_KEY) {
      headers.Authorization = `Bearer ${process.env.COMPANION_LLM_API_KEY}`;
    }

    const response = await fetch(openAiEndpoint(baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        stream: false,
        enable_thinking: false,
        temperature: 0.6,
        max_tokens: 500,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`OpenAI-compatible endpoint returned ${response.status}`);
    }
    const data = await response.json();
    return String(data.choices?.[0]?.message?.content ?? "");
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<
    CompanionResponse | CompanionStatus | { error: string }
  >,
) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "GET") {
    return res.status(200).json({ provider: configuredProvider() });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const messages = normalizeMessages(req.body?.messages);
    const latestUserMessage =
      [...messages].reverse().find((message) => message.role === "user")
        ?.content ?? "";
    if (!latestUserMessage) {
      return res.status(400).json({ error: "A user message is required" });
    }

    const sessionState = deriveCompanionSessionState(
      messages
        .filter((message) => message.role === "user")
        .map((message) => message.content),
    );
    const { systemPrompt, route } = await buildCompanionPrompt(
      latestUserMessage,
      sessionState,
    );
    const provider = configuredProvider();

    let raw: string;
    let effectiveProvider = provider;
    if (provider === "demo") {
      raw = demoReply(latestUserMessage, route, sessionState);
    } else {
      try {
        raw = await callConfiguredModel(provider, systemPrompt, messages);
      } catch {
        raw = demoReply(latestUserMessage, route, sessionState);
        effectiveProvider = "demo";
      }
    }

    const parsed = parseTaggedText(raw);
    return res.status(200).json({
      ...parsed,
      provider: effectiveProvider,
      ...(process.env.NODE_ENV === "development"
        ? {
            route: {
              mode: route.mode,
              references: route.referenceFiles,
            },
          }
        : {}),
    });
  } catch {
    return res.status(400).json({
      error: "暂时无法处理这条消息；你的输入没有被保存，请稍后再试。",
    });
  }
}
