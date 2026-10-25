import { describe, expect, it } from "vitest";
import { humanizeDuration, parseDuration } from "../src/utils/time";
import { parseArgs } from "../src/utils/args";
import { detectLink, detectZalgo, isForwarded } from "../src/core/detectors";

describe("parseDuration", () => {
  it("解析常见单位", () => {
    expect(parseDuration("30s")).toBe(30);
    expect(parseDuration("10m")).toBe(600);
    expect(parseDuration("2h")).toBe(7200);
    expect(parseDuration("1d")).toBe(86400);
  });

  it("纯数字按分钟", () => {
    expect(parseDuration("5")).toBe(300);
  });

  it("组合时长", () => {
    expect(parseDuration("1h30m")).toBe(5400);
  });

  it("非法输入返回 null", () => {
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("-5m")).toBeNull();
  });
});

describe("humanizeDuration", () => {
  it("可读化", () => {
    expect(humanizeDuration(600)).toBe("10 分");
    expect(humanizeDuration(5400)).toBe("1 小时 30 分");
    expect(humanizeDuration(86400)).toBe("1 天");
    expect(humanizeDuration(0)).toBe("0 秒");
  });
});

describe("parseArgs", () => {
  it("解析位置参数与选项", () => {
    const parsed = parseArgs("广告 --action mute --mute 10m");
    expect(parsed.positional).toEqual(["广告"]);
    expect(parsed.flags.action).toBe("mute");
    expect(parsed.flags.mute).toBe("10m");
  });

  it("支持引号包裹的短语", () => {
    const parsed = parseArgs("\"免费 领取\" --note 备注");
    expect(parsed.positional).toEqual(["免费 领取"]);
    expect(parsed.flags.note).toBe("备注");
  });

  it("支持 --key=value 与开关", () => {
    const parsed = parseArgs("词 --mode=regex --verbose");
    expect(parsed.flags.mode).toBe("regex");
    expect(parsed.switches.has("verbose")).toBe(true);
  });

  it("空输入安全", () => {
    expect(parseArgs(undefined).positional).toEqual([]);
  });
});

describe("detectors", () => {
  it("识别链接", () => {
    expect(detectLink("看这里 https://spam.example.com/x")).toBeDefined();
    expect(detectLink("加我 t.me/somechannel")).toBeDefined();
    expect(detectLink("裸域名 best-deal.top")).toBeDefined();
    expect(detectLink("今天天气不错")).toBeUndefined();
  });

  it("识别转发", () => {
    expect(isForwarded({ forward_origin: { type: "user" } })).toBe(true);
    expect(isForwarded({})).toBe(false);
  });

  it("识别乱码", () => {
    const zalgo = "a" + "\u0301".repeat(12) + "b";
    expect(detectZalgo(zalgo)).toBeDefined();
    expect(detectZalgo("正常文本")).toBeUndefined();
  });
});
