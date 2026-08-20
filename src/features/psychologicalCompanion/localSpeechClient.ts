const TARGET_SAMPLE_RATE = 16_000;

type LocalSpeechResponse = {
  available?: boolean;
  error?: string;
  final?: boolean;
  transcript?: string;
};

function createSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `speech_${crypto.randomUUID().replaceAll("-", "")}`;
  }
  return `speech_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function postSpeech(
  body: Record<string, string>,
): Promise<LocalSpeechResponse> {
  const response = await fetch("/api/local-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as LocalSpeechResponse;
  if (!response.ok) {
    throw new Error(payload.error ?? "本地语音识别暂时不可用。");
  }
  return payload;
}

function pcm16Base64(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      index * 2,
      sample < 0 ? sample * 32_768 : sample * 32_767,
      true,
    );
  }

  let binary = "";
  const stride = 8_192;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, Math.min(offset + stride, bytes.length)),
    );
  }
  return window.btoa(binary);
}

export class StreamingAudioResampler {
  private previousSample: number | undefined;
  private sourcePosition = 0;

  constructor(
    private readonly sourceSampleRate: number,
    private readonly targetSampleRate = TARGET_SAMPLE_RATE,
  ) {}

  process(input: Float32Array) {
    if (input.length === 0) return new Float32Array();
    if (this.sourceSampleRate === this.targetSampleRate) {
      return new Float32Array(input);
    }

    const hasPrevious = this.previousSample !== undefined;
    const source = new Float32Array(input.length + (hasPrevious ? 1 : 0));
    if (hasPrevious) {
      source[0] = this.previousSample!;
      source.set(input, 1);
    } else {
      source.set(input);
    }

    const ratio = this.sourceSampleRate / this.targetSampleRate;
    const output: number[] = [];
    let position = this.sourcePosition;
    while (position + 1 < source.length) {
      const left = Math.floor(position);
      const fraction = position - left;
      output.push(
        source[left] * (1 - fraction) + source[left + 1] * fraction,
      );
      position += ratio;
    }

    this.previousSample = source.at(-1);
    this.sourcePosition = position - (source.length - 1);
    return Float32Array.from(output);
  }
}

export class LocalSpeechSession {
  private readonly sessionId = createSessionId();
  private readonly ready: Promise<void>;
  private sequence: Promise<void> = Promise.resolve();
  private failure: Error | undefined;
  private closed = false;
  private latestTranscript = "";

  constructor(private readonly onTranscript: (text: string) => void) {
    this.ready = postSpeech({
      action: "start",
      sessionId: this.sessionId,
    }).then((payload) => {
      if (payload.available === false) {
        throw new Error("本地语音模型还没有准备好。");
      }
    });
  }

  push(samples: Float32Array) {
    if (this.closed || samples.length === 0 || this.failure) return;
    const pcm16 = pcm16Base64(samples);
    this.sequence = this.sequence
      .then(async () => {
        await this.ready;
        const payload = await postSpeech({
          action: "chunk",
          sessionId: this.sessionId,
          pcm16,
        });
        if (payload.transcript) {
          this.latestTranscript = payload.transcript;
          this.onTranscript(payload.transcript);
        }
      })
      .catch((caught) => {
        this.failure =
          caught instanceof Error
            ? caught
            : new Error("本地语音识别暂时不可用。");
      });
  }

  async stop() {
    if (this.closed) return this.latestTranscript;
    this.closed = true;
    await this.sequence;
    try {
      await this.ready;
    } catch (caught) {
      this.failure =
        caught instanceof Error
          ? caught
          : new Error("本地语音识别暂时不可用。");
    }
    if (this.failure) throw this.failure;

    const payload = await postSpeech({
      action: "stop",
      sessionId: this.sessionId,
    });
    if (payload.transcript) {
      this.latestTranscript = payload.transcript;
      this.onTranscript(payload.transcript);
    }
    return this.latestTranscript;
  }

  cancel() {
    if (this.closed) return;
    this.closed = true;
    void this.sequence
      .then(() => this.ready)
      .then(() =>
        postSpeech({
          action: "cancel",
          sessionId: this.sessionId,
        }),
      )
      .catch(() => undefined);
  }
}
