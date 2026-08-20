import { describe, expect, jest, test } from "@jest/globals";

import { playSpeechChunks } from "../speechChunkQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("playSpeechChunks", () => {
  test("prepares the next sentence while the current sentence is playing", async () => {
    const firstPlayback = deferred();
    const synthesized: string[] = [];
    const play = jest.fn(async (_audio: string, chunk: string) => {
      if (chunk === "第一句。") await firstPlayback.promise;
    });

    const speaking = playSpeechChunks({
      chunks: ["第一句。", "第二句。"],
      synthesize: async (chunk) => {
        synthesized.push(chunk);
        return `audio:${chunk}`;
      },
      play,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(play).toHaveBeenCalledWith("audio:第一句。", "第一句。");
    expect(synthesized).toEqual(["第一句。", "第二句。"]);

    firstPlayback.resolve();
    await speaking;
  });
});
