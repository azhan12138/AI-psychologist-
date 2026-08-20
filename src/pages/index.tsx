import Head from "next/head";
import {
  CSSProperties,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconCheck,
  IconChevronRight,
  IconLock,
  IconMessageCircle,
  IconMicrophone,
  IconPlayerStopFilled,
  IconPlus,
  IconRefresh,
  IconSend2,
  IconSettings,
  IconShieldLock,
  IconVolume,
  IconVolumeOff,
  IconWaveSine,
  IconX,
} from "@tabler/icons-react";

import PortraitCompanion, {
  MouthCue,
  PortraitPhase,
} from "@/features/psychologicalCompanion/PortraitCompanion";
import { playSpeechChunks } from "@/features/psychologicalCompanion/speechChunkQueue";
import { usePushToTalk } from "@/features/psychologicalCompanion/usePushToTalk";
import styles from "@/styles/psychologicalCompanionPrototype.module.css";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type DrawerTab = "session" | "settings";

type ApiResponse = {
  text?: string;
  emotion?: string;
  provider?: "demo" | "ollama" | "openai-compatible";
  error?: string;
};

type LocalVoiceInfo = {
  available?: boolean;
  engine?: string;
  voice?: string;
  privacy?: "reply-text-only" | "fully-local" | "unavailable";
  fallback?: string;
};

const INITIAL_MESSAGE: UiMessage = {
  id: "welcome",
  role: "assistant",
  text: "我在这里，慢慢说。",
};

const COMPANION_REFERENCES = [
  {
    id: "current",
    name: "温和倾听",
    note: "当前可动形象",
    src: "/companion-assets/companion-default-neutral-v2.png",
    active: true,
  },
  {
    id: "young",
    name: "年轻中性",
    note: "形象设定已保留",
    src: "/companion-assets/companion-young-reference.png",
    active: false,
  },
  {
    id: "mature",
    name: "成熟温和",
    note: "形象设定已保留",
    src: "/companion-assets/companion-mature-reference.png",
    active: false,
  },
] as const;

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random()}`;
}

function providerLabel(provider: ApiResponse["provider"]) {
  if (provider === "ollama") return "本地 Ollama";
  if (provider === "openai-compatible") return "已配置模型";
  return "本地演示回应";
}

function formatDuration(durationMs: number) {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function mouthCueForCharacter(character: string): MouthCue {
  if (!character || /[\s，。！？、；：“”‘’（）…,.!?;:]/u.test(character)) {
    return "rest";
  }
  return (character.codePointAt(0) ?? 0) % 3 === 0 ? "o" : "a";
}

function splitSpeechChunks(text: string) {
  const sentences =
    text.match(/[^。！？；\n]+[。！？；]?|\n+/gu)?.map((part) => part.trim()) ??
    [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences.filter(Boolean)) {
    if (current && current.length + sentence.length > 90) {
      chunks.push(current);
      current = "";
    }
    if (sentence.length <= 90) {
      current += sentence;
      continue;
    }
    if (current) {
      chunks.push(current);
      current = "";
    }
    for (let index = 0; index < sentence.length; index += 90) {
      chunks.push(sentence.slice(index, index + 90));
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text];
}

export default function PsychologicalCompanionPrototype() {
  const [messages, setMessages] = useState<UiMessage[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<PortraitPhase>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<DrawerTab>("session");
  const [newChatConfirmOpen, setNewChatConfirmOpen] = useState(false);
  const [provider, setProvider] = useState<ApiResponse["provider"]>("demo");
  const [error, setError] = useState("");
  const [mouthCue, setMouthCue] = useState<MouthCue>("rest");
  const [localVoice, setLocalVoice] = useState<LocalVoiceInfo>({});
  const [voiceError, setVoiceError] = useState("");

  const phaseRef = useRef<PortraitPhase>("idle");
  const speechTimerRef = useRef<number>();
  const speechRunRef = useRef(0);
  const speechRequestControllerRef = useRef<AbortController>();
  const speechFinishRef = useRef<() => void>();
  const voiceAudioContextRef = useRef<AudioContext>();
  const voiceSourceRef = useRef<AudioBufferSourceNode>();
  const requestControllerRef = useRef<AbortController>();
  const historyViewportRef = useRef<HTMLDivElement>(null);
  const historyShouldStickRef = useRef(true);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const ensureVoiceAudioContext = useCallback(async () => {
    const context =
      voiceAudioContextRef.current ??
      (voiceAudioContextRef.current = new AudioContext());
    if (context.state === "suspended") await context.resume();
    return context;
  }, []);

  const stopSpeaking = useCallback(() => {
    speechRunRef.current += 1;
    speechRequestControllerRef.current?.abort();
    speechRequestControllerRef.current = undefined;
    speechFinishRef.current?.();
    speechFinishRef.current = undefined;
    try {
      voiceSourceRef.current?.stop();
    } catch {
      // A source that has already ended cannot be stopped again.
    }
    voiceSourceRef.current?.disconnect();
    voiceSourceRef.current = undefined;
    if (typeof window !== "undefined") {
      window.clearInterval(speechTimerRef.current);
    }
    setMouthCue("rest");
    if (phaseRef.current === "speaking") setPhase("idle");
  }, []);

  useEffect(
    () => () => {
      stopSpeaking();
      requestControllerRef.current?.abort();
      void voiceAudioContextRef.current?.close();
    },
    [stopSpeaking],
  );

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      void navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) =>
                registration.active?.scriptURL.endsWith("/sw.js"),
              )
              .map((registration) => registration.unregister()),
          ),
        )
        .catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/local-voice", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Local voice unavailable");
        setLocalVoice((await response.json()) as LocalVoiceInfo);
      })
      .catch((caught) => {
        if (!(caught instanceof Error && caught.name === "AbortError")) {
          setLocalVoice({ available: false });
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/companion-chat", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return;
        const status = (await response.json()) as ApiResponse;
        if (status.provider) setProvider(status.provider);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const speak = useCallback(
    (text: string, force = false) => {
      if ((!voiceEnabled && !force) || typeof window === "undefined") {
        setPhase("idle");
        setMouthCue("rest");
        return;
      }

      stopSpeaking();
      setVoiceError("");
      const runId = speechRunRef.current;
      const chunks = splitSpeechChunks(text);
      if (localVoice.available !== true) {
        setVoiceError("中文语音还没有准备好，请稍后点击“试听”。");
        setMouthCue("rest");
        setPhase("idle");
        return;
      }

      const synthesizeChunk = async (chunk: string) => {
        const controller = new AbortController();
        speechRequestControllerRef.current = controller;
        try {
          const response = await fetch("/api/local-voice", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal,
            body: JSON.stringify({ text: chunk }),
          });
          if (!response.ok) {
            const payload = (await response
              .json()
              .catch(() => ({}))) as { error?: string };
            throw new Error(payload.error ?? "中文语音生成失败。");
          }

          const context = await ensureVoiceAudioContext();
          return context.decodeAudioData(await response.arrayBuffer());
        } finally {
          if (speechRequestControllerRef.current === controller) {
            speechRequestControllerRef.current = undefined;
          }
        }
      };

      const playChunk = async (audioBuffer: AudioBuffer, chunk: string) => {
        const context = await ensureVoiceAudioContext();
        if (runId !== speechRunRef.current) return;

        await new Promise<void>((resolve) => {
          const source = context.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(context.destination);
          voiceSourceRef.current = source;
          const startedAt = context.currentTime;
          let finished = false;

          const finish = () => {
            if (finished) return;
            finished = true;
            window.clearInterval(speechTimerRef.current);
            source.onended = null;
            try {
              source.stop();
            } catch {
              // It may have reached its natural end.
            }
            source.disconnect();
            if (voiceSourceRef.current === source) {
              voiceSourceRef.current = undefined;
            }
            speechFinishRef.current = undefined;
            setMouthCue("rest");
            resolve();
          };

          speechFinishRef.current = finish;
          source.onended = finish;
          setPhase("speaking");
          speechTimerRef.current = window.setInterval(() => {
            const elapsed = context.currentTime - startedAt;
            const progress = Math.min(
              1,
              elapsed / Math.max(audioBuffer.duration, 0.1),
            );
            const index = Math.min(
              chunk.length - 1,
              Math.floor(progress * chunk.length),
            );
            setMouthCue(mouthCueForCharacter(chunk[index] ?? ""));
          }, 90);
          source.start();
        });
      };

      void (async () => {
        try {
          await playSpeechChunks({
            chunks,
            synthesize: synthesizeChunk,
            play: playChunk,
            isCurrent: () => runId === speechRunRef.current,
          });
          if (runId === speechRunRef.current) {
            setMouthCue("rest");
            setPhase("idle");
          }
        } catch (caught) {
          if (
            runId !== speechRunRef.current ||
            (caught instanceof Error && caught.name === "AbortError")
          ) {
            return;
          }
          setMouthCue("rest");
          setPhase("idle");
          setVoiceError(
            caught instanceof Error
              ? caught.message
              : "中文声音没有成功播放，请点击“试听”重试。",
          );
          speechRequestControllerRef.current?.abort();
          speechRequestControllerRef.current = undefined;
        }
      })();
    },
    [
      ensureVoiceAudioContext,
      localVoice.available,
      stopSpeaking,
      voiceEnabled,
    ],
  );

  const handleCapture = useCallback(
    ({ transcript }: { transcript: string }) => {
      const cleanTranscript = transcript.trim();
      if (cleanTranscript) {
        setDraft(cleanTranscript.slice(0, 2000));
        setPhase("reviewing");
        return;
      }
      setError("没有识别到清晰的中文内容，请重试或直接输入文字。");
      setPhase("idle");
    },
    [],
  );

  const capture = usePushToTalk({
    onCapture: handleCapture,
    onError: (message) => {
      setError(message);
      setPhase("idle");
    },
  });

  useEffect(() => {
    if (capture.status === "requesting") setPhase("requesting");
    if (capture.status === "recording") setPhase("recording");
  }, [capture.status]);

  const latestAssistant = useMemo(
    () =>
      [...messages].reverse().find((message) => message.role === "assistant") ??
      INITIAL_MESSAGE,
    [messages],
  );
  const latestUser = useMemo(
    () => [...messages].reverse().find((message) => message.role === "user"),
    [messages],
  );
  const userTurnCount = useMemo(
    () => messages.filter((message) => message.role === "user").length,
    [messages],
  );

  const openDrawer = useCallback((tab: DrawerTab) => {
    setDrawerTab(tab);
    setNewChatConfirmOpen(false);
    setDrawerOpen(true);
    if (tab === "session") historyShouldStickRef.current = true;
  }, []);

  const selectDrawerTab = (tab: DrawerTab) => {
    setDrawerTab(tab);
    setNewChatConfirmOpen(false);
    if (tab === "session") historyShouldStickRef.current = true;
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setNewChatConfirmOpen(false);
  };

  const handleHistoryScroll = () => {
    const viewport = historyViewportRef.current;
    if (!viewport) return;
    historyShouldStickRef.current =
      viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 72;
  };

  useEffect(() => {
    if (
      !drawerOpen ||
      drawerTab !== "session" ||
      !historyShouldStickRef.current
    ) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const viewport = historyViewportRef.current;
      if (viewport) viewport.scrollTop = viewport.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawerOpen, drawerTab, messages, phase]);

  const statusText = useMemo(() => {
    if (phase === "requesting") return "等待麦克风权限";
    if (phase === "recording") {
      return capture.onDeviceRealtime ? "正在本地实时转写" : "正在听你说";
    }
    if (phase === "transcribing") {
      return "正在完成本地转写";
    }
    if (phase === "reviewing") return "说完后可以修改";
    if (phase === "thinking") return "正在整理回应";
    if (phase === "speaking") return "正在回应";
    return "点击麦克风后，我才会开始听";
  }, [capture.onDeviceRealtime, phase]);

  const sendMessage = useCallback(
    async (value = draft) => {
      const text = value.trim();
      if (!text || phase === "thinking") return;

      setError("");
      setDraft("");
      stopSpeaking();

      const userMessage: UiMessage = {
        id: createId(),
        role: "user",
        text: text.slice(0, 2000),
      };
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      setPhase("thinking");

      requestControllerRef.current?.abort();
      const requestController = new AbortController();
      requestControllerRef.current = requestController;

      try {
        const response = await fetch("/api/companion-chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          signal: requestController.signal,
          body: JSON.stringify({
            messages: nextMessages.map(({ role, text: content }) => ({
              role,
              content,
            })),
          }),
        });
        const data = (await response.json()) as ApiResponse;
        if (!response.ok || !data.text) {
          throw new Error(data.error ?? "暂时无法生成回应");
        }

        setProvider(data.provider ?? "demo");
        setMessages((current) => [
          ...current,
          {
            id: createId(),
            role: "assistant",
            text: data.text!,
          },
        ]);
        speak(data.text);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") {
          return;
        }
        setError(
          caught instanceof Error
            ? caught.message
            : "暂时无法处理这条消息；你的输入没有被保存。",
        );
        setPhase("idle");
      } finally {
        if (requestControllerRef.current === requestController) {
          requestControllerRef.current = undefined;
        }
      }
    },
    [draft, messages, phase, speak, stopSpeaking],
  );

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sendMessage();
  };

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  const handleMicClick = () => {
    if (capture.status === "recording") {
      setPhase("transcribing");
      void capture.stop();
      return;
    }
    if (
      capture.status !== "idle" ||
      phase === "thinking" ||
      phase === "transcribing"
    ) {
      return;
    }

    stopSpeaking();
    setDraft("");
    setError("");
    setPhase("requesting");
    void capture.start();
  };

  const startNewConversation = () => {
    requestControllerRef.current?.abort();
    requestControllerRef.current = undefined;
    stopSpeaking();
    setMessages([INITIAL_MESSAGE]);
    setDraft("");
    setError("");
    setPhase("idle");
    setProvider("demo");
    setNewChatConfirmOpen(false);
    setDrawerOpen(false);
    historyShouldStickRef.current = true;
  };

  const requestNewConversation = () => {
    const hasCurrentContent =
      userTurnCount > 0 ||
      Boolean(draft.trim()) ||
      phase === "thinking" ||
      Boolean(error);

    if (!hasCurrentContent) {
      startNewConversation();
      return;
    }
    setNewChatConfirmOpen(true);
  };

  const toggleVoice = () => {
    if (voiceEnabled) {
      stopSpeaking();
      setVoiceEnabled(false);
      return;
    }
    setVoiceError("");
    setVoiceEnabled(true);
    void ensureVoiceAudioContext()
      .then(() => {
        speak("语音回复已开启。", true);
      })
      .catch(() => {
        setVoiceError("浏览器没有成功启用声音，请点击“试听”重试。");
      });
  };

  const testVoice = () => {
    setVoiceEnabled(true);
    void ensureVoiceAudioContext()
      .then(() => {
        speak("你好。我会用温柔自然的中文声音，慢慢回应你。", true);
      })
      .catch(() => {
        setVoiceError("浏览器没有成功启用声音，请检查系统输出设备。");
      });
  };

  const isRecording = capture.status === "recording";
  const micDisabled =
    phase === "thinking" ||
    phase === "transcribing" ||
    capture.status === "requesting" ||
    capture.status === "stopping";
  const displayDraft =
    isRecording && capture.liveTranscript ? capture.liveTranscript : draft;
  const composerReadOnly =
    isRecording || phase === "transcribing" || capture.status === "requesting";
  const newConversationUnavailable =
    capture.status !== "idle" || phase === "transcribing";

  return (
    <>
      <Head>
        <title>心理陪伴 · 私人会谈原型</title>
        <meta
          name="description"
          content="主动录音、本地优先转写且不自动发送的心理陪伴数字人原型"
        />
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <main className={styles.page}>
        <div className={styles.backgroundImage} aria-hidden="true" />
        <div className={styles.backgroundVeil} aria-hidden="true" />

        <header className={styles.topBar}>
          <div className={styles.brand}>
            <span className={styles.brandMark}>心</span>
            <div>
              <strong>心理陪伴</strong>
              <span>私人会谈原型</span>
            </div>
          </div>
          <div className={styles.topActions}>
            <button
              className={`${styles.historyButton} ${
                drawerOpen && drawerTab === "session"
                  ? styles.topActionActive
                  : ""
              }`}
              type="button"
              onClick={() => openDrawer("session")}
              aria-label="打开本次会谈记录"
              aria-controls="companion-side-drawer"
              aria-expanded={drawerOpen && drawerTab === "session"}>
              <IconMessageCircle aria-hidden="true" />
              <span>会谈记录</span>
              {userTurnCount > 0 && (
                <i aria-label={`${userTurnCount}轮交流`}>{userTurnCount}</i>
              )}
            </button>
            <button
              className={`${styles.settingsButton} ${
                voiceEnabled ? styles.topActionActive : ""
              }`}
              type="button"
              onClick={toggleVoice}
              aria-label={
                voiceEnabled ? "关闭回答语音" : "开启回答语音"
              }
              aria-pressed={voiceEnabled}
              title={voiceEnabled ? "回答语音已开启" : "开启回答语音"}>
              {voiceEnabled ? (
                <IconVolume aria-hidden="true" />
              ) : (
                <IconVolumeOff aria-hidden="true" />
              )}
            </button>
            <button
              className={`${styles.settingsButton} ${
                drawerOpen && drawerTab === "settings"
                  ? styles.topActionActive
                  : ""
              }`}
              type="button"
              onClick={() => openDrawer("settings")}
              aria-label="打开陪伴者、语音和隐私设置"
              aria-controls="companion-side-drawer"
              aria-expanded={drawerOpen && drawerTab === "settings"}>
              <IconLock aria-hidden="true" />
            </button>
          </div>
        </header>

        <section className={styles.companionStage}>
          <PortraitCompanion
            phase={phase}
            mouthCue={mouthCue}
            shifted={drawerOpen}
          />

          <div
            className={`${styles.companionCopy} ${
              drawerOpen ? styles.companionCopyDrawerOpen : ""
            }`}
            aria-live="polite">
            <p
              key={phase === "thinking" ? "thinking" : latestAssistant.id}
              aria-label="心理陪伴的最新回复"
              tabIndex={0}
              className={`${styles.assistantLine} ${
                phase === "thinking" ? styles.assistantLineThinking : ""
              }`}>
              {phase === "thinking"
                ? "我在想怎样回应，才更贴近你刚才说的内容。"
                : latestAssistant.text}
            </p>
            {latestUser && phase !== "recording" && (
              <p className={styles.lastUserLine}>
                <span>你刚才说：</span>
                {latestUser.text}
              </p>
            )}
          </div>
        </section>

        <form
          className={`${styles.voiceComposer} ${
            drawerOpen ? styles.voiceComposerDrawerOpen : ""
          }`}
          onSubmit={submit}>
          <div
            className={`${styles.transcriptSurface} ${
              isRecording ? styles.transcriptSurfaceRecording : ""
            }`}>
            <div className={styles.transcriptStatus}>
              <IconWaveSine
                aria-hidden="true"
                style={
                  {
                    transform: `scaleY(${0.72 + capture.level * 0.7})`,
                  } as CSSProperties
                }
              />
              <span>{statusText}</span>
              {isRecording && <time>{formatDuration(capture.durationMs)}</time>}
            </div>

            <div className={styles.transcriptRow}>
              <textarea
                value={displayDraft}
                maxLength={2000}
                rows={2}
                readOnly={composerReadOnly}
                onChange={(event) => {
                  setDraft(event.target.value);
                  if (phase !== "thinking") {
                    setPhase(event.target.value.trim() ? "reviewing" : "idle");
                  }
                }}
                onKeyDown={handleDraftKeyDown}
                aria-label="待确认的会谈文字"
                placeholder={
                  isRecording
                    ? "正在听你说……"
                    : phase === "transcribing"
                      ? "正在本地生成文字……"
                      : "点击麦克风说话，也可以直接在这里输入。"
                }
              />

              <button
                className={`${styles.micButton} ${
                  isRecording ? styles.micButtonRecording : ""
                }`}
                type="button"
                disabled={micDisabled}
                onClick={handleMicClick}
                aria-label={isRecording ? "停止录音并开始转写" : "点击开始说话"}
                aria-pressed={isRecording}>
                {isRecording ? (
                  <IconPlayerStopFilled aria-hidden="true" />
                ) : (
                  <IconMicrophone aria-hidden="true" />
                )}
              </button>

              <button
                className={styles.sendButton}
                type="submit"
                disabled={
                  !draft.trim() || composerReadOnly || phase === "thinking"
                }
                aria-label="确认发送">
                <IconSend2 aria-hidden="true" />
              </button>
            </div>
          </div>

          <p className={styles.capturePromise}>
            {isRecording
              ? "再次点击即停止；录音只在内存中处理"
              : phase === "reviewing"
                ? "请先检查文字，再由你决定是否发送"
                : "不会后台监听 · 不保存录音 · 不会自动发送"}
          </p>

          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </form>

        <footer className={styles.footer}>
          这是 AI 心理陪伴，不进行诊断、处方或急救。
        </footer>

        <button
          className={`${styles.drawerScrim} ${
            drawerOpen ? styles.drawerScrimOpen : ""
          }`}
          type="button"
          aria-label="关闭会谈侧栏"
          aria-hidden="true"
          tabIndex={-1}
          onClick={closeDrawer}
        />

        <aside
          id="companion-side-drawer"
          className={`${styles.settingsDrawer} ${
            drawerOpen ? styles.settingsDrawerOpen : ""
          }`}
          aria-hidden={!drawerOpen}
          aria-label="本次会谈记录与设置">
          <div className={styles.drawerHeader}>
            <div>
              <span>私人会谈</span>
              <h2>{drawerTab === "session" ? "本次会谈" : "设置与隐私"}</h2>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
              aria-label="关闭会谈侧栏">
              <IconX aria-hidden="true" />
            </button>
          </div>

          <div
            className={styles.drawerTabs}
            role="tablist"
            aria-label="会谈侧栏内容">
            <button
              id="session-tab"
              type="button"
              role="tab"
              aria-selected={drawerTab === "session"}
              aria-controls="session-panel"
              onClick={() => selectDrawerTab("session")}>
              本次会谈
            </button>
            <button
              id="settings-tab"
              type="button"
              role="tab"
              aria-selected={drawerTab === "settings"}
              aria-controls="settings-panel"
              onClick={() => selectDrawerTab("settings")}>
              设置与隐私
            </button>
          </div>

          <div className={styles.drawerBody}>
            {drawerTab === "session" ? (
              <section
                id="session-panel"
                className={styles.sessionPanel}
                role="tabpanel"
                aria-labelledby="session-tab">
                <div className={styles.sessionToolbar}>
                  <div>
                    <strong>
                      {userTurnCount > 0
                        ? `${userTurnCount} 轮交流`
                        : "会谈尚未开始"}
                    </strong>
                    <span>仅保留在当前页面</span>
                  </div>
                  <button
                    className={styles.newConversationButton}
                    type="button"
                    disabled={newConversationUnavailable}
                    onClick={requestNewConversation}
                    title={
                      newConversationUnavailable
                        ? "请先结束当前录音或转写"
                        : "开始一段新的会谈"
                    }>
                    <IconPlus aria-hidden="true" />
                    新建对话
                  </button>
                </div>

                {newChatConfirmOpen && (
                  <div
                    className={styles.newConversationConfirm}
                    role="alertdialog"
                    aria-labelledby="new-conversation-title"
                    aria-describedby="new-conversation-description">
                    <strong id="new-conversation-title">开始新的对话？</strong>
                    <p id="new-conversation-description">
                      当前记录和未发送文字会被清空，且无法恢复。
                    </p>
                    <div>
                      <button
                        type="button"
                        onClick={() => setNewChatConfirmOpen(false)}>
                        继续当前会谈
                      </button>
                      <button type="button" onClick={startNewConversation}>
                        确认新建
                      </button>
                    </div>
                  </div>
                )}

                <div
                  ref={historyViewportRef}
                  className={styles.sessionHistory}
                  role="log"
                  aria-label="本次会谈消息"
                  onScroll={handleHistoryScroll}>
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={
                        message.role === "user"
                          ? styles.historyMessageUser
                          : styles.historyMessageAssistant
                      }>
                      <span>{message.role === "user" ? "你" : "心理陪伴"}</span>
                      <p>{message.text}</p>
                    </article>
                  ))}
                  {phase === "thinking" && (
                    <article
                      className={`${styles.historyMessageAssistant} ${styles.historyMessagePending}`}>
                      <span>心理陪伴</span>
                      <p>正在整理回应……</p>
                    </article>
                  )}
                </div>

                <div className={styles.sessionFoot}>
                  <IconRefresh aria-hidden="true" />
                  <span>刷新或关闭页面后清除；不会自动保存为长期记忆。</span>
                </div>
              </section>
            ) : (
              <section
                id="settings-panel"
                className={styles.settingsPanel}
                role="tabpanel"
                aria-labelledby="settings-tab">
                <h3>选择陪伴者</h3>

                <div className={styles.companionChoices}>
                  {COMPANION_REFERENCES.map((companion) => (
                    <div
                      key={companion.id}
                      className={`${styles.companionChoice} ${
                        companion.active ? styles.companionChoiceActive : ""
                      }`}>
                      <div className={styles.companionThumb}>
                        <img
                          src={companion.src}
                          alt={`${companion.name}陪伴者形象`}
                        />
                        {companion.active && (
                          <span aria-label="当前使用">
                            <IconCheck aria-hidden="true" />
                          </span>
                        )}
                      </div>
                      <strong>{companion.name}</strong>
                      <span>{companion.note}</span>
                    </div>
                  ))}
                </div>

                <p className={styles.modelNotice}>
                  后两位形象作为设计资产保留；接入各自可商用的可动模型后，才会开放切换。
                </p>

                <div className={styles.settingRows}>
                  <button
                    className={styles.settingRow}
                    type="button"
                    role="switch"
                    aria-checked={voiceEnabled}
                    onClick={toggleVoice}>
                    <span>
                      {voiceEnabled ? (
                        <IconVolume aria-hidden="true" />
                      ) : (
                        <IconVolumeOff aria-hidden="true" />
                      )}
                      自动朗读
                    </span>
                    <i
                      className={voiceEnabled ? styles.switchOn : undefined}
                      aria-hidden="true">
                      <b />
                    </i>
                  </button>

                  <div className={styles.voiceTestRow}>
                    <span>
                      {localVoice.available === true
                        ? `${
                            localVoice.engine === "siliconflow-cosyvoice2"
                              ? "温柔神经语音已就绪"
                              : "本机备用语音已就绪"
                          } · ${localVoice.voice || "中文声音"}`
                        : localVoice.available === false
                          ? "中文语音暂时不可用"
                          : "正在检查中文语音"}
                      {voiceError && <small>{voiceError}</small>}
                    </span>
                    <button
                      type="button"
                      disabled={localVoice.available !== true}
                      onClick={testVoice}>
                      试听
                    </button>
                  </div>

                  <details className={styles.privacyDetails}>
                    <summary>
                      <span>
                        <IconShieldLock aria-hidden="true" />
                        隐私说明
                      </span>
                      <IconChevronRight aria-hidden="true" />
                    </summary>
                    <div>
                      <p>
                        麦克风只在你主动点击后开启。录音在内存中处理，转写完成后释放，不写入文件。
                      </p>
                      <p>
                        语音由随产品安装的 sherpa-onnx
                        中文模型在本机流式识别；原始声音不会发送给硅基流动，也不会写入会谈记录。
                      </p>
                      <p>
                        高拟真朗读使用 CosyVoice2，只发送模型已经生成的回答文字，不发送你的原始录音；生成的音频只用于当前播放，不写入会谈记录。网络不可用时会退回本机系统声音。
                      </p>
                    </div>
                  </details>

                  <div className={styles.modelRow}>
                    <IconWaveSine aria-hidden="true" />
                    <span>
                      <small>语音输入</small>
                      sherpa-onnx · 本机流式识别
                    </span>
                  </div>

                  <div className={styles.modelRow}>
                    <IconSettings aria-hidden="true" />
                    <span>
                      <small>当前回应</small>
                      {providerLabel(provider)}
                    </span>
                  </div>
                </div>

                <div className={styles.drawerFoot}>
                  <IconRefresh aria-hidden="true" />
                  <span>页面关闭后，本次内存会话不会由本原型恢复。</span>
                </div>
              </section>
            )}
          </div>
        </aside>
      </main>
    </>
  );
}
