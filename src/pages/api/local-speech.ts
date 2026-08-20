import type { NextApiRequest, NextApiResponse } from "next";

import {
  acceptLocalSpeechChunk,
  cancelLocalSpeechSession,
  localSpeechStatus,
  startLocalSpeechSession,
  stopLocalSpeechSession,
} from "@/server/localSpeechEngine";

type SpeechResponse = {
  available?: boolean;
  engine?: string;
  error?: string;
  final?: boolean;
  model?: string;
  sampleRate?: number;
  transcript?: string;
  version?: string;
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "256kb",
    },
  },
};

function validSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= 100 &&
    /^[a-zA-Z0-9_-]+$/.test(value)
  );
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse<SpeechResponse>,
) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method === "GET") {
    return res.status(200).json(localSpeechStatus());
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action, sessionId } = req.body ?? {};
  if (!validSessionId(sessionId)) {
    return res.status(400).json({ error: "本地语音会话标识无效。" });
  }

  try {
    if (action === "start") {
      return res.status(200).json(startLocalSpeechSession(sessionId));
    }
    if (action === "chunk") {
      if (
        typeof req.body?.pcm16 !== "string" ||
        req.body.pcm16.length > 180_000
      ) {
        return res.status(400).json({ error: "本地音频片段无效。" });
      }
      return res
        .status(200)
        .json(acceptLocalSpeechChunk(sessionId, req.body.pcm16));
    }
    if (action === "stop") {
      return res.status(200).json(stopLocalSpeechSession(sessionId));
    }
    if (action === "cancel") {
      return res.status(200).json(cancelLocalSpeechSession(sessionId));
    }
    return res.status(400).json({ error: "未知的本地语音操作。" });
  } catch (caught) {
    return res.status(503).json({
      error:
        caught instanceof Error
          ? caught.message
          : "本地语音识别暂时不可用。",
    });
  }
}
