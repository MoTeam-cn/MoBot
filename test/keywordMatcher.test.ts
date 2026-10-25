import { describe, expect, it } from "vitest";
import { compileRules, findKeywordMatch, validatePattern } from "../src/core/keywordMatcher";
import type { KeywordRule } from "../src/types";

function rule(partial: Partial<KeywordRule> & Pick<KeywordRule, "pattern">): KeywordRule {
  return {
    id: "r1",
    mode: "contains",
    action: "delete",
    enabled: true,
    createdAt: Date.now(),
    hits: 0,
    ...partial,
  };
}

function match(text: string, rules: KeywordRule[]) {
  return findKeywordMatch(text, compileRules(rules));
}

describe("contains 模式", () => {
  it("命中普通关键词", () => {
    expect(match("这里卖广告啦", [rule({ pattern: "广告" })])?.rule.pattern).toBe("广告");
  });

  it("命中带空格的变形", () => {
    expect(match("这 是 广 告 吗", [rule({ pattern: "广告" })])?.rule.pattern).toBe("广告");
  });

  it("命中全角字母", () => {
    expect(match("加我ＶＸ领福利", [rule({ pattern: "vx" })])?.rule.pattern).toBe("vx");
  });

  it("命中零宽字符穿插", () => {
    expect(match("广\u200b告", [rule({ pattern: "广告" })])?.rule.pattern).toBe("广告");
  });

  it("命中带标点穿插", () => {
    expect(match("广*告", [rule({ pattern: "广告" })])?.rule.pattern).toBe("广告");
  });

  it("不命中无关文本", () => {
    expect(match("今天天气不错", [rule({ pattern: "广告" })])).toBeUndefined();
  });

  it("返回上下文片段", () => {
    const hit = match("前文很长很长的铺垫然后卖广告最后收尾", [rule({ pattern: "广告" })]);
    expect(hit?.fragment).toContain("广告");
  });
});

describe("whole 模式", () => {
  it("整词命中", () => {
    expect(match("这是 ad 测试", [rule({ pattern: "ad", mode: "whole" })])?.rule.pattern).toBe("ad");
  });

  it("词内不命中", () => {
    expect(match("这是 adsl 测试", [rule({ pattern: "ad", mode: "whole" })])).toBeUndefined();
  });

  it("中文整词命中", () => {
    expect(match("广告太多了", [rule({ pattern: "广告", mode: "whole" })])?.rule.pattern).toBe("广告");
  });
});

describe("regex 模式", () => {
  it("命中正则", () => {
    const rules = [rule({ pattern: "(加|私)\\s*我.*领", mode: "regex" })];
    expect(match("私我领红包", rules)?.rule.pattern).toBe("(加|私)\\s*我.*领");
  });

  it("非法正则被忽略而不是崩溃", () => {
    const rules = [rule({ pattern: "([", mode: "regex" })];
    expect(match("任意文本", rules)).toBeUndefined();
  });
});

describe("规则链", () => {
  it("按顺序返回首个命中", () => {
    const rules = [rule({ id: "a", pattern: "广告" }), rule({ id: "b", pattern: "红包" })];
    expect(match("广告和红包", rules)?.rule.id).toBe("a");
  });

  it("停用的规则被跳过", () => {
    const rules = [rule({ pattern: "广告", enabled: false }), rule({ id: "b", pattern: "红包" })];
    expect(match("广告和红包", rules)?.rule.id).toBe("b");
  });
});

describe("validatePattern", () => {
  it("拒绝空关键词", () => {
    expect(validatePattern("   ", "contains")).not.toBeNull();
  });

  it("拒绝只有符号的关键词", () => {
    expect(validatePattern("***", "contains")).not.toBeNull();
  });

  it("拒绝非法正则", () => {
    expect(validatePattern("([", "regex")).not.toBeNull();
  });

  it("接受合法输入", () => {
    expect(validatePattern("广告", "contains")).toBeNull();
    expect(validatePattern("加我.*领", "regex")).toBeNull();
  });
});
