export type SpeechChunkQueueOptions<Audio> = {
  chunks: string[];
  synthesize: (chunk: string) => Promise<Audio>;
  play: (audio: Audio, chunk: string) => Promise<void>;
  isCurrent?: () => boolean;
};

export async function playSpeechChunks<Audio>({
  chunks,
  synthesize,
  play,
  isCurrent = () => true,
}: SpeechChunkQueueOptions<Audio>) {
  type Prepared =
    | { ok: true; audio: Audio }
    | { ok: false; error: unknown };

  const prepare = (chunk: string) =>
    synthesize(chunk).then<Prepared, Prepared>(
      (audio) => ({ ok: true, audio }),
      (error: unknown) => ({ ok: false, error }),
    );

  let index = 0;
  let current:
    | { chunk: string; audio: Promise<Prepared> }
    | undefined;

  if (chunks.length > 0 && isCurrent()) {
    current = {
      chunk: chunks[index],
      audio: prepare(chunks[index]),
    };
    index += 1;
  }

  while (current) {
    const prepared = await current.audio;
    if (!isCurrent()) return;
    if (!prepared.ok) throw prepared.error;

    const following =
      index < chunks.length && isCurrent()
        ? {
            chunk: chunks[index],
            audio: prepare(chunks[index]),
          }
        : undefined;
    index += following ? 1 : 0;

    await play(prepared.audio, current.chunk);
    if (!isCurrent()) return;
    current = following;
  }
}
