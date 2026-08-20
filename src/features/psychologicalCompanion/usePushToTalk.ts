import { useCallback, useEffect, useRef, useState } from "react";

import {
  LocalSpeechSession,
  StreamingAudioResampler,
} from "./localSpeechClient";

type CaptureStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping";

export type RecognitionEngine =
  | "none"
  | "sherpa-local"
  | "browser-local";

export type VoiceCapture = {
  audioBuffer?: AudioBuffer;
  recognitionEngine: RecognitionEngine;
  transcript: string;
  usedOnDeviceRealtime: boolean;
};

type Options = {
  maxDurationMs?: number;
  onCapture: (capture: VoiceCapture) => void | Promise<void>;
  onError: (message: string) => void;
};

type OnDeviceRecognition = SpeechRecognition & {
  processLocally?: boolean;
};

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/webm",
];

function preferredMimeType() {
  if (
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }

  return (
    MIME_CANDIDATES.find((mime) =>
      MediaRecorder.isTypeSupported(mime),
    ) ?? ""
  );
}

function getOnDeviceRecognition() {
  if (typeof window === "undefined") return undefined;

  const Recognition =
    window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Recognition) return undefined;

  const recognition = new Recognition() as OnDeviceRecognition;
  if (!("processLocally" in recognition)) return undefined;

  recognition.processLocally = true;
  recognition.lang = "zh-CN";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  return recognition;
}

function recognitionText(event: SpeechRecognitionEvent) {
  let text = "";
  for (let index = 0; index < event.results.length; index += 1) {
    text += event.results[index][0]?.transcript ?? "";
  }
  return text.trim();
}

export function usePushToTalk({
  maxDurationMs = 120_000,
  onCapture,
  onError,
}: Options) {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [level, setLevel] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [recognitionEngine, setRecognitionEngine] =
    useState<RecognitionEngine>("none");

  const statusRef = useRef<CaptureStatus>("idle");
  const streamRef = useRef<MediaStream>();
  const recorderRef = useRef<MediaRecorder>();
  const audioContextRef = useRef<AudioContext>();
  const audioSourceRef = useRef<MediaStreamAudioSourceNode>();
  const audioProcessorRef = useRef<ScriptProcessorNode>();
  const silentGainRef = useRef<GainNode>();
  const analyserRef = useRef<AnalyserNode>();
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const animationFrameRef = useRef(0);
  const durationTimerRef = useRef<number>();
  const maxTimerRef = useRef<number>();
  const recognitionRef = useRef<OnDeviceRecognition>();
  const liveTranscriptRef = useRef("");
  const browserTranscriptRef = useRef("");
  const localTranscriptRef = useRef("");
  const localSpeechSessionRef = useRef<LocalSpeechSession>();
  const captureCancelledRef = useRef(false);

  const updateStatus = useCallback((nextStatus: CaptureStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const stopMeters = useCallback(() => {
    cancelAnimationFrame(animationFrameRef.current);
    window.clearInterval(durationTimerRef.current);
    window.clearTimeout(maxTimerRef.current);
    setLevel(0);
  }, []);

  const closeInputDevices = useCallback(async () => {
    localSpeechSessionRef.current?.cancel();
    localSpeechSessionRef.current = undefined;

    try {
      recognitionRef.current?.stop();
    } catch {
      // The recognizer may already have stopped after an unsupported locale.
    }
    recognitionRef.current = undefined;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
    audioProcessorRef.current?.disconnect();
    if (audioProcessorRef.current) {
      audioProcessorRef.current.onaudioprocess = null;
    }
    audioProcessorRef.current = undefined;
    silentGainRef.current?.disconnect();
    silentGainRef.current = undefined;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = undefined;
    analyserRef.current = undefined;

    const context = audioContextRef.current;
    audioContextRef.current = undefined;
    if (context && context.state !== "closed") {
      await context.close().catch(() => undefined);
    }
  }, []);

  const stop = useCallback(async () => {
    if (
      statusRef.current !== "recording" ||
      !recorderRef.current
    ) {
      return;
    }

    updateStatus("stopping");
    stopMeters();

    const recorder = recorderRef.current;
    const audioContext = audioContextRef.current;
    if (audioProcessorRef.current) {
      audioProcessorRef.current.onaudioprocess = null;
      audioProcessorRef.current.disconnect();
      audioProcessorRef.current = undefined;
    }
    silentGainRef.current?.disconnect();
    silentGainRef.current = undefined;
    audioSourceRef.current?.disconnect();
    audioSourceRef.current = undefined;

    const localSpeechSession = localSpeechSessionRef.current;
    localSpeechSessionRef.current = undefined;
    const recorderStopped = new Promise<void>((resolve) => {
      recorder.addEventListener("stop", () => resolve(), {
        once: true,
      });
    });

    if (recorder.state !== "inactive") {
      recorder.requestData();
      recorder.stop();
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      // It may already be inactive; the recorded audio remains available.
    }
    await recorderStopped;

    let localTranscript = "";
    if (localSpeechSession) {
      try {
        localTranscript = (await localSpeechSession.stop()).trim();
      } catch {
        // The recorded audio remains available for the local Whisper fallback.
      }
    }

    // Give an on-device recognizer a brief chance to deliver its final phrase.
    await new Promise((resolve) => window.setTimeout(resolve, 220));

    const chunks = chunksRef.current;
    chunksRef.current = [];
    recorderRef.current = undefined;
    const browserTranscript = browserTranscriptRef.current.trim();
    const transcript = localTranscript || browserTranscript;
    const usedOnDeviceRealtime = Boolean(transcript);
    const captureEngine: RecognitionEngine = localTranscript
      ? "sherpa-local"
      : browserTranscript
        ? "browser-local"
        : "none";

    try {
      if (!usedOnDeviceRealtime) {
        throw new Error(
          "本地语音模型不可用或没有识别到清晰内容；请安装模型、重试或直接输入文字。",
        );
      }

      await closeInputDevices();
      updateStatus("idle");
      setDurationMs(0);

      if (!captureCancelledRef.current) {
        await onCapture({
          recognitionEngine: captureEngine,
          transcript,
          usedOnDeviceRealtime,
        });
      }
    } catch (caught) {
      await closeInputDevices();
      updateStatus("idle");
      setDurationMs(0);
      onError(
        caught instanceof Error
          ? caught.message
          : "这次录音没有成功转成文字，请再试一次。",
      );
    }
  }, [
    closeInputDevices,
    onCapture,
    onError,
    stopMeters,
    updateStatus,
  ]);

  const start = useCallback(async () => {
    if (statusRef.current !== "idle") return;

    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      onError("当前浏览器不支持麦克风录音，你仍然可以直接输入文字。");
      return;
    }

    captureCancelledRef.current = false;
    liveTranscriptRef.current = "";
    browserTranscriptRef.current = "";
    localTranscriptRef.current = "";
    setLiveTranscript("");
    setRecognitionEngine("none");
    updateStatus("requesting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      streamRef.current = stream;

      let audioContext: AudioContext;
      try {
        audioContext = new AudioContext({
          sampleRate: 16_000,
        });
      } catch {
        audioContext = new AudioContext();
      }
      audioContextRef.current = audioContext;
      await audioContext.resume();

      const source = audioContext.createMediaStreamSource(stream);
      audioSourceRef.current = source;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.76;
      source.connect(analyser);
      analyserRef.current = analyser;

      const localSpeechSession = new LocalSpeechSession((text) => {
        const normalized = text.trim();
        if (!normalized) return;
        localTranscriptRef.current = normalized;
        liveTranscriptRef.current = normalized;
        setLiveTranscript(normalized);
        setRecognitionEngine("sherpa-local");
      });
      localSpeechSessionRef.current = localSpeechSession;

      const resampler = new StreamingAudioResampler(
        audioContext.sampleRate,
        16_000,
      );
      const audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      audioProcessor.onaudioprocess = (event) => {
        if (
          statusRef.current !== "requesting" &&
          statusRef.current !== "recording"
        ) {
          return;
        }
        const samples = resampler.process(
          event.inputBuffer.getChannelData(0),
        );
        localSpeechSession.push(samples);
      };
      source.connect(audioProcessor);
      audioProcessor.connect(silentGain);
      silentGain.connect(audioContext.destination);
      audioProcessorRef.current = audioProcessor;
      silentGainRef.current = silentGain;

      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      });

      const recognition = getOnDeviceRecognition();
      if (recognition) {
        recognitionRef.current = recognition;
        recognition.addEventListener("result", (event) => {
          const text = recognitionText(
            event as SpeechRecognitionEvent,
          );
          browserTranscriptRef.current = text;
          if (localTranscriptRef.current) return;
          liveTranscriptRef.current = text;
          setLiveTranscript(text);
          if (text) setRecognitionEngine("browser-local");
        });
        recognition.addEventListener("error", () => {
          recognitionRef.current = undefined;
        });
        try {
          recognition.start();
        } catch {
          recognitionRef.current = undefined;
        }
      }

      recorder.start(250);
      startedAtRef.current = Date.now();
      setDurationMs(0);
      updateStatus("recording");

      const samples = new Uint8Array(analyser.fftSize);
      const updateLevel = () => {
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const normalized = (sample - 128) / 128;
          energy += normalized * normalized;
        }
        setLevel(Math.min(1, Math.sqrt(energy / samples.length) * 4.2));
        animationFrameRef.current =
          requestAnimationFrame(updateLevel);
      };
      updateLevel();

      durationTimerRef.current = window.setInterval(() => {
        setDurationMs(Date.now() - startedAtRef.current);
      }, 200);
      maxTimerRef.current = window.setTimeout(() => {
        void stop();
      }, maxDurationMs);
    } catch (caught) {
      await closeInputDevices();
      updateStatus("idle");
      onError(
        caught instanceof DOMException &&
          (caught.name === "NotAllowedError" ||
            caught.name === "PermissionDeniedError")
          ? "麦克风权限没有开启；你仍然可以直接输入文字。"
          : "暂时无法打开麦克风，请检查浏览器或系统的录音权限。",
      );
    }
  }, [
    closeInputDevices,
    maxDurationMs,
    onError,
    stop,
    updateStatus,
  ]);

  useEffect(
    () => () => {
      captureCancelledRef.current = true;
      stopMeters();
      if (
        recorderRef.current &&
        recorderRef.current.state !== "inactive"
      ) {
        recorderRef.current.stop();
      }
      void closeInputDevices();
    },
    [closeInputDevices, stopMeters],
  );

  return {
    status,
    level,
    durationMs,
    liveTranscript,
    recognitionEngine,
    onDeviceRealtime: recognitionEngine !== "none",
    start,
    stop,
  };
}
