import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { NextApiRequest, NextApiResponse } from "next";

const run = promisify(execFile);
const SAY_PATH = "/usr/bin/say";
const AFCONVERT_PATH = "/usr/bin/afconvert";
const DEFAULT_SYSTEM_VOICE = "Shelley (中文（中国大陆）)";
const DEFAULT_NEURAL_MODEL = "FunAudioLLM/CosyVoice2-0.5B";
const DEFAULT_NEURAL_VOICE = `${DEFAULT_NEURAL_MODEL}:anna`;
const DEFAULT_STYLE =
  "请用温柔、平静、自然的年轻女声说话，语速稍慢，停顿自然，像在安静的私人会谈中陪伴一个人；保持真诚克制，不要播音腔，也不要过度表演。";

type VoiceStatus = {
  available: boolean;
  engine: "siliconflow-cosyvoice2" | "macos-system-voice" | "unavailable";
  voice: string;
  privacy: "reply-text-only" | "fully-local" | "unavailable";
  fallback?: string;
};

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "16kb",
    },
    responseLimit: "8mb",
  },
};

function neuralVoiceConfig() {
  const provider = process.env.COMPANION_TTS_PROVIDER?.toLowerCase();
  const apiKey =
    process.env.COMPANION_TTS_API_KEY ??
    process.env.COMPANION_LLM_API_KEY ??
    "";
  const baseUrl =
    process.env.COMPANION_TTS_BASE_URL ??
    process.env.COMPANION_LLM_BASE_URL ??
    "https://api.siliconflow.cn";
  const explicitlyEnabled = provider === "siliconflow";
  const inheritedSiliconFlow =
    !provider && /(^|\.)siliconflow\.cn(?=\/|$)/i.test(new URL(baseUrl).host);

  return {
    enabled: Boolean(apiKey) && (explicitlyEnabled || inheritedSiliconFlow),
    apiKey,
    baseUrl: baseUrl.replace(/\/v1\/?$/, "").replace(/\/$/, ""),
    model: process.env.COMPANION_TTS_MODEL ?? DEFAULT_NEURAL_MODEL,
    voice: process.env.COMPANION_TTS_VOICE ?? DEFAULT_NEURAL_VOICE,
    style: process.env.COMPANION_TTS_STYLE ?? DEFAULT_STYLE,
    speed: Number(process.env.COMPANION_TTS_SPEED ?? 0.96),
  };
}

async function systemVoiceAvailable() {
  if (process.platform !== "darwin") return false;
  try {
    await Promise.all([access(SAY_PATH), access(AFCONVERT_PATH)]);
    return true;
  } catch {
    return false;
  }
}

async function voiceStatus(): Promise<VoiceStatus> {
  const neural = neuralVoiceConfig();
  const systemAvailable = await systemVoiceAvailable();
  if (neural.enabled) {
    return {
      available: true,
      engine: "siliconflow-cosyvoice2",
      voice: "Anna · 温柔神经语音",
      privacy: "reply-text-only",
      ...(systemAvailable
        ? {
            fallback:
              process.env.COMPANION_TTS_SYSTEM_VOICE ?? DEFAULT_SYSTEM_VOICE,
          }
        : {}),
    };
  }
  if (systemAvailable) {
    return {
      available: true,
      engine: "macos-system-voice",
      voice: process.env.COMPANION_TTS_SYSTEM_VOICE ?? DEFAULT_SYSTEM_VOICE,
      privacy: "fully-local",
    };
  }
  return {
    available: false,
    engine: "unavailable",
    voice: "",
    privacy: "unavailable",
  };
}

function neuralEndpoint(baseUrl: string) {
  return `${baseUrl}/v1/audio/speech`;
}

async function generateNeuralVoice(text: string) {
  const neural = neuralVoiceConfig();
  if (!neural.enabled) throw new Error("神经语音尚未配置。");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(neuralEndpoint(neural.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${neural.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: neural.model,
        voice: neural.voice,
        input: `${neural.style}<|endofprompt|>${text}`,
        response_format: "wav",
        sample_rate: 32_000,
        stream: false,
        speed: Number.isFinite(neural.speed) ? neural.speed : 0.96,
        gain: 0,
      }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`温柔神经语音暂时不可用（${response.status}）。`);
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (
      audio.length <= 4_096 ||
      audio.subarray(0, 4).toString("ascii") !== "RIFF"
    ) {
      throw new Error("神经语音没有返回有效音频。");
    }
    return {
      audio,
      engine: "siliconflow-cosyvoice2",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function generateSystemVoice(text: string) {
  if (!(await systemVoiceAvailable())) {
    throw new Error("本机备用中文语音暂时不可用。");
  }

  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "companion-local-voice-"),
  );
  const aiffPath = path.join(temporaryDirectory, "voice.aiff");
  const wavePath = path.join(temporaryDirectory, "voice.wav");
  try {
    await run(
      SAY_PATH,
      [
        "-v",
        process.env.COMPANION_TTS_SYSTEM_VOICE ?? DEFAULT_SYSTEM_VOICE,
        "-r",
        "165",
        "-o",
        aiffPath,
        text,
      ],
      {
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      },
    );
    await run(
      AFCONVERT_PATH,
      [
        "-f",
        "WAVE",
        "-d",
        "LEI16@22050",
        "-c",
        "1",
        aiffPath,
        wavePath,
      ],
      {
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      },
    );

    const audio = await readFile(wavePath);
    if (
      audio.length <= 4_096 ||
      audio.subarray(0, 4).toString("ascii") !== "RIFF"
    ) {
      throw new Error("本机备用语音没有生成有效音频。");
    }
    return {
      audio,
      engine: "macos-system-voice",
    };
  } finally {
    await rm(temporaryDirectory, {
      force: true,
      recursive: true,
    }).catch(() => undefined);
  }
}

async function generateVoice(text: string) {
  if (neuralVoiceConfig().enabled) {
    try {
      return await generateNeuralVoice(text);
    } catch (neuralError) {
      try {
        return await generateSystemVoice(text);
      } catch {
        throw neuralError;
      }
    }
  }
  return generateSystemVoice(text);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  const status = await voiceStatus();
  if (req.method === "GET") {
    return res.status(200).json(status);
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!status.available) {
    return res.status(503).json({ error: "中文语音暂时不可用。" });
  }

  const text =
    typeof req.body?.text === "string" ? req.body.text.trim() : "";
  if (!text || text.length > 500) {
    return res
      .status(400)
      .json({ error: "需要提供 1 至 500 字的朗读内容。" });
  }

  try {
    const { audio, engine } = await generateVoice(text);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(audio.length));
    res.setHeader("Content-Disposition", 'inline; filename="voice.wav"');
    res.setHeader("X-Companion-Voice-Engine", engine);
    return res.status(200).send(audio);
  } catch (caught) {
    return res.status(503).json({
      error:
        caught instanceof Error
          ? caught.message
          : "温柔中文语音生成失败。",
    });
  }
}
