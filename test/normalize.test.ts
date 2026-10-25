import { describe, expect, it } from "vitest";
import { combiningRatio, countCombining, normalizeText, squeezeText } from "../src/core/normalize";

describe("normalizeText", () => {
  it("全角转半角并小写", () => {
    expect(normalizeText("ＶＸ１２３ＡＢＣ")).toBe("vx123abc");
  });

  it("去掉零宽字符", () => {
    expect(normalizeText("广\u200b告")).toBe("广告");
  });

  it("合并空白并 trim", () => {
    expect(normalizeText("  广   告  ")).toBe("广 告");
  });

  it("空值安全", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("squeezeText", () => {
  it("去掉空格与标点", () => {
    expect(squeezeText("广 告-推*荐")).toBe("广告推荐");
  });

  it("保留中英文数字", () => {
    expect(squeezeText("vx: abc123，加我")).toBe("vxabc123加我");
  });
});

describe("zalgo 统计", () => {
  it("统计组合字符", () => {
    expect(countCombining("a\u0301\u0302\u0303")).toBe(3);
    expect(combiningRatio("a\u0301\u0302\u0303")).toBeGreaterThan(0.5);
  });

  it("普通文本为 0", () => {
    expect(countCombining("普通文本")).toBe(0);
  });
});
