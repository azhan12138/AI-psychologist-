import {
  advanceCompanionSession,
  deriveCompanionSessionState,
  initialCompanionSessionState,
  isOverdoseOrPoisoningSignal,
  routeCompanionMessage,
} from "../companionRouting";

describe("psychological companion routing", () => {
  it("keeps ordinary emotional conversation in companionship mode", () => {
    const route = routeCompanionMessage("今天工作很累，想随便聊聊");

    expect(route.mode).toBe("companionship");
    expect(route.referenceFiles).toEqual(
      expect.arrayContaining([
        "communication-and-companionship.md",
        "safety-and-boundaries.md",
      ]),
    );
    expect(route.referenceFiles).not.toContain("condition-depression.md");
  });

  it("honours listen-only intent before assessment or advice", () => {
    const route = routeCompanionMessage(
      "我确诊过抑郁症，但今天不要分析，也别给建议，只想有人听",
    );

    expect(route.mode).toBe("companionship");
    expect(route.signals).toContain("listen-only");
    expect(route.referenceFiles).toContain("condition-depression.md");
  });

  it("loads condition knowledge only when a condition signal is present", () => {
    const ordinary = routeCompanionMessage("我今天有一点低落");
    const explicit = routeCompanionMessage("我确诊过抑郁症，想聊聊最近的状态");
    const persistent = routeCompanionMessage(
      "我已经持续一个月没兴趣做任何事，也影响工作了",
    );

    expect(ordinary.referenceFiles).not.toContain("condition-depression.md");
    expect(explicit.referenceFiles).toContain("condition-depression.md");
    expect(persistent.referenceFiles).toContain("condition-depression.md");
  });

  it("routes an assessment request without treating the score as diagnosis", () => {
    const route = routeCompanionMessage("能帮我评估一下是不是抑郁症吗");

    expect(route.mode).toBe("assessment");
    expect(route.referenceFiles).toEqual(
      expect.arrayContaining([
        "assessment-and-routing.md",
        "formulation-and-care-plan.md",
        "condition-depression.md",
      ]),
    );
  });

  it.each([
    "我刚刚吃了很多药，已经有点不舒服了",
    "我把一瓶安眠药都吞了",
    "昨晚服了几十片药",
    "药吃多了，现在想吐",
    "我刚才喝了农药",
  ])("interrupts the normal flow for overdose wording: %s", (message) => {
    expect(isOverdoseOrPoisoningSignal(message)).toBe(true);
    expect(routeCompanionMessage(message).mode).toBe("safety");
  });

  it("does not classify routine medication as overdose", () => {
    const message = "今天吃了一片维生素";

    expect(isOverdoseOrPoisoningSignal(message)).toBe(false);
    expect(routeCompanionMessage(message).mode).toBe("companionship");
  });

  it("interrupts immediately when a direct suicide signal appears", () => {
    const route = routeCompanionMessage("我不想活了，已经准备好了药");

    expect(route.mode).toBe("safety");
    expect(route.signals).toContain("direct-safety-signal");
  });

  it("tracks assessment-question fatigue across turns", () => {
    const first = advanceCompanionSession(
      initialCompanionSessionState,
      "帮我评估一下最近的状态",
    );
    const second = advanceCompanionSession(first, "我还是说不清，帮我理清");

    expect(first.consecutiveAssessmentTurns).toBe(1);
    expect(second.consecutiveAssessmentTurns).toBe(2);
  });

  it("derives pacing state from the messages sent with a stateless API request", () => {
    const state = deriveCompanionSessionState([
      "帮我评估一下最近的状态",
      "我还是说不清，帮我理清",
    ]);

    expect(state.turnCount).toBe(2);
    expect(state.consecutiveAssessmentTurns).toBe(2);
  });
});
