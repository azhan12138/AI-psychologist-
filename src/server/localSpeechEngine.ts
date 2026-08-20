import fs from "node:fs";
import path from "node:path";

const SAMPLE_RATE = 16_000;
const SESSION_TTL_MS = 3 * 60_000;
const MAX_SESSIONS = 8;
const MODEL_NAME =
  "sherpa-onnx-streaming-zipformer-ctc-zh-int8-2025-06-30";

type SherpaResult = {
  text?: string;
};

type SherpaStream = {
  acceptWaveform: (sampleRate: number, samples: Float32Array) => void;
  inputFinished: () => void;
  free: () => void;
};

type SherpaRecognizer = {
  createStream: () => SherpaStream;
  decode: (stream: SherpaStream) => void;
  free: () => void;
  getResult: (stream: SherpaStream) => SherpaResult;
  isEndpoint: (stream: SherpaStream) => boolean;
  isReady: (stream: SherpaStream) => boolean;
  reset: (stream: SherpaStream) => void;
};

type SherpaModule = {
  createOnlineRecognizer: (config: object) => SherpaRecognizer;
  version?: string;
};

type SpeechSession = {
  stream: SherpaStream;
  segments: string[];
  updatedAt: number;
};

type SpeechRuntime = {
  recognizer?: SherpaRecognizer;
  sessions: Map<string, SpeechSession>;
  version?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __companionLocalSpeechRuntime: SpeechRuntime | undefined;
}

const runtime =
  globalThis.__companionLocalSpeechRuntime ??
  (globalThis.__companionLocalSpeechRuntime = {
    sessions: new Map<string, SpeechSession>(),
  });

function modelDirectory() {
  return (
    process.env.COMPANION_ASR_MODEL_DIR ??
    path.join(process.cwd(), "models", MODEL_NAME)
  );
}

function modelFiles() {
  const directory = modelDirectory();
  return {
    directory,
    ctcModel: path.join(directory, "model.int8.onnx"),
    decoder: path.join(directory, "decoder-epoch-99-avg-1.onnx"),
    encoder: path.join(directory, "encoder-epoch-99-avg-1.int8.onnx"),
    joiner: path.join(directory, "joiner-epoch-99-avg-1.int8.onnx"),
    tokens: path.join(directory, "tokens.txt"),
  };
}

function assertModelAvailable() {
  const files = modelFiles();
  const modelFilenames = fs.existsSync(files.ctcModel)
    ? [files.ctcModel, files.tokens]
    : [files.encoder, files.decoder, files.joiner, files.tokens];
  for (const filename of modelFilenames) {
    if (!fs.existsSync(filename)) {
      throw new Error(`本地语音模型缺少文件：${path.basename(filename)}`);
    }
  }
  return {
    ...files,
    kind: fs.existsSync(files.ctcModel)
      ? ("zipformer2-ctc" as const)
      : ("transducer" as const),
  };
}

function getRecognizer() {
  if (runtime.recognizer) return runtime.recognizer;

  const files = assertModelAvailable();
  // This package is server-only. Keeping require here prevents it from being
  // evaluated by the browser bundle.
  const sherpa = require("sherpa-onnx") as SherpaModule;
  runtime.version = sherpa.version;
  const modelConfig =
    files.kind === "zipformer2-ctc"
      ? {
          zipformer2Ctc: {
            model: files.ctcModel,
          },
          tokens: files.tokens,
          numThreads: 2,
          provider: "cpu",
          debug: 0,
          modelingUnit: "cjkchar",
        }
      : {
          transducer: {
            encoder: files.encoder,
            decoder: files.decoder,
            joiner: files.joiner,
          },
          tokens: files.tokens,
          numThreads: 2,
          provider: "cpu",
          debug: 0,
          modelType: "zipformer",
        };
  runtime.recognizer = sherpa.createOnlineRecognizer({
    featConfig: {
      sampleRate: SAMPLE_RATE,
      featureDim: 80,
    },
    modelConfig,
    decodingMethod: "greedy_search",
    maxActivePaths: 4,
    enableEndpoint: 1,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.0,
    rule3MinUtteranceLength: 20,
    hotwordsFile: "",
    hotwordsScore: 1.5,
    ctcFstDecoderConfig: {
      graph: "",
      maxActive: 3000,
    },
    ruleFsts: "",
    ruleFars: "",
  });
  return runtime.recognizer;
}

function cleanupExpiredSessions() {
  const expiry = Date.now() - SESSION_TTL_MS;
  for (const [sessionId, session] of runtime.sessions.entries()) {
    if (session.updatedAt < expiry) {
      session.stream.free();
      runtime.sessions.delete(sessionId);
    }
  }
}

function sessionFor(sessionId: string) {
  cleanupExpiredSessions();
  const session = runtime.sessions.get(sessionId);
  if (!session) {
    throw new Error("本地语音会话已经结束，请重新点击麦克风。");
  }
  session.updatedAt = Date.now();
  return session;
}

function decodeReady(recognizer: SherpaRecognizer, stream: SherpaStream) {
  let iterations = 0;
  while (recognizer.isReady(stream) && iterations < 128) {
    recognizer.decode(stream);
    iterations += 1;
  }
}

function appendSegment(session: SpeechSession, text: string) {
  const normalized = text.trim();
  if (!normalized) return;
  if (session.segments.at(-1) !== normalized) {
    session.segments.push(normalized);
  }
}

function joinSegments(segments: string[], partial = "") {
  const all = partial.trim() ? [...segments, partial.trim()] : segments;
  return all.join("").trim();
}

function decodePcm16(base64: string) {
  const bytes = Buffer.from(base64, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0) {
    throw new Error("收到的本地音频片段无效。");
  }
  if (bytes.byteLength > 128 * 1024) {
    throw new Error("单个本地音频片段过长。");
  }

  const samples = new Float32Array(bytes.byteLength / 2);
  for (let index = 0; index < samples.length; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2) / 32_768;
  }
  return samples;
}

export function localSpeechStatus() {
  const files = modelFiles();
  const available = fs.existsSync(files.ctcModel)
    ? fs.existsSync(files.tokens)
    : [files.encoder, files.decoder, files.joiner, files.tokens].every(
        (filename) => fs.existsSync(filename),
      );

  return {
    available,
    engine: "sherpa-onnx-wasm" as const,
    model: path.basename(files.directory),
    sampleRate: SAMPLE_RATE,
    version: runtime.version,
  };
}

export function startLocalSpeechSession(sessionId: string) {
  cleanupExpiredSessions();
  if (runtime.sessions.has(sessionId)) {
    const previous = runtime.sessions.get(sessionId)!;
    previous.stream.free();
    runtime.sessions.delete(sessionId);
  }
  if (runtime.sessions.size >= MAX_SESSIONS) {
    throw new Error("本机语音会话过多，请稍后再试。");
  }

  const recognizer = getRecognizer();
  runtime.sessions.set(sessionId, {
    stream: recognizer.createStream(),
    segments: [],
    updatedAt: Date.now(),
  });

  return {
    ...localSpeechStatus(),
    transcript: "",
  };
}

export function acceptLocalSpeechChunk(sessionId: string, pcm16: string) {
  const recognizer = getRecognizer();
  const session = sessionFor(sessionId);
  const samples = decodePcm16(pcm16);

  session.stream.acceptWaveform(SAMPLE_RATE, samples);
  decodeReady(recognizer, session.stream);

  let partial = recognizer.getResult(session.stream).text?.trim() ?? "";
  if (recognizer.isEndpoint(session.stream)) {
    appendSegment(session, partial);
    recognizer.reset(session.stream);
    partial = "";
  }

  return {
    transcript: joinSegments(session.segments, partial),
    final: false,
  };
}

export function stopLocalSpeechSession(sessionId: string) {
  const recognizer = getRecognizer();
  const session = sessionFor(sessionId);

  // Streaming models need a short quiet tail to flush the last tokens.
  session.stream.acceptWaveform(
    SAMPLE_RATE,
    new Float32Array(Math.round(SAMPLE_RATE * 0.8)),
  );
  session.stream.inputFinished();
  decodeReady(recognizer, session.stream);
  appendSegment(
    session,
    recognizer.getResult(session.stream).text?.trim() ?? "",
  );

  const transcript = joinSegments(session.segments);
  session.stream.free();
  runtime.sessions.delete(sessionId);

  return {
    transcript,
    final: true,
  };
}

export function cancelLocalSpeechSession(sessionId: string) {
  const session = runtime.sessions.get(sessionId);
  if (session) {
    session.stream.free();
    runtime.sessions.delete(sessionId);
  }
  return {
    transcript: "",
    final: true,
  };
}
