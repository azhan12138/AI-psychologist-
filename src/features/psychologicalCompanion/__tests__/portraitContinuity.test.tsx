import { describe, expect, test } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

import PortraitCompanion from "../PortraitCompanion";

describe("PortraitCompanion frame continuity", () => {
  test("keeps one stable full-frame portrait during facial motion", () => {
    const markup = renderToStaticMarkup(
      <PortraitCompanion mouthCue="a" phase="speaking" />,
    );
    const document = new DOMParser().parseFromString(markup, "text/html");
    const fullFramePortraits = document.querySelectorAll("img");

    expect(fullFramePortraits).toHaveLength(1);
  });
});
