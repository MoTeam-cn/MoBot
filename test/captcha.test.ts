import { afterEach, describe, expect, it } from "vitest";
import { randomCode, randomSetupToken, randomToken, CODE_ALPHABET } from "../src/captcha/code";
import { readPngSize, renderCaptcha } from "../src/captcha/png";
import { isValidProof, solveProof, startWebVerifyServer, proofNonce } from "../src/captcha/webServer";
import { GROUP_ID, cleanupEnv, createEnv, joinUpdate, textUpdate, type TestEnv } from "./helpers";
import type { ChallengeRecord } from "../src/types";
import { createLogger } from "../src/logger";

const envs: TestEnv[] = [];
afterEach(async () => {
  for (const item of envs.splice(0)) await cleanupEnv(item);
});

async function env(options: Parameters<typeof createEnv>[0] = {}): Promise<TestEnv> {
  const created = await createEnv(options);
  envs.push(created);
  return created;
}

describe("验证码生成", () => {
  it("长度与字符集正确", () => {
    for (let index = 0; index < 20; index += 1) {
      const code = randomCode(5);
      expect(code).toHaveLength(5);
      for (const char of code) expect(CODE_ALPHABET).toContain(char);
    }
  });

  it("token 与 setup token 可用", () => {
    expect(randomToken(10)).toHaveLength(20);
    expect(randomSetupToken()).toHaveLength(8);
    expect(randomSetupToken()).not.toBe(randomSetupToken());
  });
});

describe("图像验证码 PNG", () => {
  it("是合法 PNG 且尺寸随长度变化", () => {
    const short = renderCaptcha("AB2C", { seed: 1 });
    const long = renderCaptcha("AB2CD", { seed: 1 });
    expect(short.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const shortSize = readPngSize(short);
    const longSize = readPngSize(long);
    expect(shortSize.width).toBeGreaterThan(0);
    expect(longSize.width).toBeGreaterThan(shortSize.width);
    expect(shortSize.height).toBe(longSize.height);
  });

  it("相同 seed 输出稳定，不同 seed 不同", () => {
    const a = renderCaptcha("HELLO", { seed: 42 });
    const b = renderCaptcha("HELLO", { seed: 42 });
    const c = renderCaptcha("HELLO", { seed: 43 });
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });
});

describe("网页 JS 验证服务", () => {
  it("下发页面 → 客户端算 proof → 回调成功", async () => {
    const logger = createLogger("test", "error");
    const challenge: ChallengeRecord = {
      token: "abc123def456",
      chatId: GROUP_ID,
      userId: 1234,
      userName: "Tester",
      mode: "web",
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      promptMessageIds: {},
      dmSent: true,
      groupFallback: false,
    };
    const verified: ChallengeRecord[] = [];
    const server = await startWebVerifyServer({
      logger,
      port: 0,
      getChallenge: (token) => (token === challenge.token ? challenge : undefined),
      onVerified: async (record) => {
        verified.push(record);
      },
    });

    try {
      const pageRes = await fetch("http://127.0.0.1:" + server.port + "/verify/" + challenge.token);
      expect(pageRes.status).toBe(200);
      const html = await pageRes.text();
      expect(html).toContain(challenge.token);
      expect(html).toContain(proofNonce(challenge.token));
      expect(html).toContain("crypto.subtle");

      const counter = solveProof(challenge.token);
      expect(counter).not.toBeNull();
      expect(isValidProof(challenge.token, counter as number)).toBe(true);

      const bad = await fetch("http://127.0.0.1:" + server.port + "/verify/" + challenge.token + "/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ counter: (counter as number) + 1 }),
      });
      expect(bad.status).toBe(400);

      const ok = await fetch("http://127.0.0.1:" + server.port + "/verify/" + challenge.token + "/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ counter }),
      });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true });
      expect(verified).toHaveLength(1);
      expect(verified[0]?.userId).toBe(1234);

      const health = await fetch("http://127.0.0.1:" + server.port + "/healthz");
      expect(await health.text()).toBe("ok");

      const missing = await fetch("http://127.0.0.1:" + server.port + "/verify/unknown");
      expect(missing.status).toBe(410);
    } finally {
      await server.close();
    }
  });

  it("过期挑战返回 410", async () => {
    const logger = createLogger("test", "error");
    const expired: ChallengeRecord = {
      token: "expired01",
      chatId: GROUP_ID,
      userId: 1,
      userName: "x",
      mode: "web",
      attempts: 0,
      createdAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
      promptMessageIds: {},
      dmSent: false,
      groupFallback: false,
    };
    const server = await startWebVerifyServer({
      logger,
      port: 0,
      getChallenge: () => expired,
      onVerified: async () => undefined,
    });
    try {
      const res = await fetch("http://127.0.0.1:" + server.port + "/verify/" + expired.token);
      expect(res.status).toBe(410);
    } finally {
      await server.close();
    }
  });
});

describe("入群验证流程", () => {
  async function setupCaptcha(e: TestEnv, mode: "button" | "image" | "web", extra?: Partial<{ kickAfterMinutes: number; banSeconds: number; maxAttempts: number }>) {
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.updateGroup(GROUP_ID, (group) => {
      group.captcha = {
        enabled: true,
        mode,
        kickAfterMinutes: extra?.kickAfterMinutes ?? 5,
        banSeconds: extra?.banSeconds ?? 600,
        maxAttempts: extra?.maxAttempts ?? 3,
        welcomeAfterVerify: true,
      };
    });
    return e.repo.getGroup(GROUP_ID)!;
  }

  it("入群先禁言并私聊下发按钮验证", async () => {
    const e = await env();
    await setupCaptcha(e, "button");

    await e.bot.handleUpdate(
      joinUpdate({ userId: 800 }),
    );

    const restrict = e.calls.filter((call) => call.method === "restrictChatMember");
    expect(restrict.length).toBeGreaterThanOrEqual(1);
    expect(restrict[0]?.payload).toMatchObject({ user_id: 800 });

    const dm = e.calls.find(
      (call) => call.method === "sendMessage" && call.payload.chat_id === 800,
    );
    expect(dm).toBeDefined();

    const record = e.repo.getChallenge(GROUP_ID, 800);
    expect(record).toBeDefined();
    expect(record?.mode).toBe("button");

    const result = await e.deps.captcha.verifyByToken(record!.token, 800);
    expect(result.ok).toBe(true);
    expect(e.repo.getGroup(GROUP_ID)?.stats.captchaSolved).toBe(1);
    expect(e.repo.getChallenge(GROUP_ID, 800)).toBeUndefined();
  });

  it("图像验证码：错码累计、正确码通过", async () => {
    const e = await env();
    await setupCaptcha(e, "image");
    await e.bot.handleUpdate(joinUpdate({ userId: 801 }));

    const record = e.repo.getChallenge(GROUP_ID, 801);
    expect(record?.mode).toBe("image");
    expect(record?.code).toBeTruthy();
    expect(e.calls.some((call) => call.method === "sendPhoto")).toBe(true);

    const wrong = await e.deps.captcha.verifyByCode(801, "ZZZZZ");
    expect(wrong.ok).toBe(false);
    expect(e.repo.getChallenge(GROUP_ID, 801)?.attempts).toBe(1);

    const right = await e.deps.captcha.verifyByCode(801, (record!.code ?? "").toLowerCase());
    expect(right.ok).toBe(true);
    expect(e.repo.getGroup(GROUP_ID)?.stats.captchaSolved).toBe(1);
  });

  it("私聊失败时群里给按钮兜底", async () => {
    const e = await env({ dmBlocked: true });
    await setupCaptcha(e, "button");
    await e.bot.handleUpdate(joinUpdate({ userId: 802 }));

    const record = e.repo.getChallenge(GROUP_ID, 802);
    expect(record?.dmSent).toBe(false);
    expect(record?.groupFallback).toBe(true);
    const groupPrompt = e.calls.find(
      (call) => call.method === "sendMessage" && call.payload.chat_id === GROUP_ID,
    );
    expect(groupPrompt).toBeDefined();
  });

  it("超时踢出并按配置封禁（临时）", async () => {
    const e = await env();
    await setupCaptcha(e, "button", { banSeconds: 600 });
    await e.bot.handleUpdate(joinUpdate({ userId: 803 }));

    const record = e.repo.getChallenge(GROUP_ID, 803)!;
    await e.deps.captcha.expireNow(record, "验证超时");

    const bans = e.calls.filter((call) => call.method === "banChatMember");
    expect(bans).toHaveLength(1);
    expect(bans[0]?.payload).toMatchObject({ chat_id: GROUP_ID, user_id: 803 });
    expect(typeof bans[0]?.payload.until_date).toBe("number");
    expect(e.repo.getGroup(GROUP_ID)?.stats.captchaFailed).toBe(1);
    expect(e.repo.getChallenge(GROUP_ID, 803)).toBeUndefined();
  });

  it("超时踢出并永久封禁（banSeconds=0 时不带 until_date）", async () => {
    const e = await env();
    await setupCaptcha(e, "button", { banSeconds: 0 });
    await e.bot.handleUpdate(joinUpdate({ userId: 804 }));

    const record = e.repo.getChallenge(GROUP_ID, 804)!;
    await e.deps.captcha.expireNow(record, "验证超时");

    const bans = e.calls.filter((call) => call.method === "banChatMember");
    expect(bans).toHaveLength(1);
    expect(bans[0]?.payload.until_date).toBeUndefined();
  });

  it("输错达到上限直接踢出封禁", async () => {
    const e = await env();
    await setupCaptcha(e, "image", { maxAttempts: 2 });
    await e.bot.handleUpdate(joinUpdate({ userId: 805 }));

    await e.deps.captcha.verifyByCode(805, "AAAAA");
    const last = await e.deps.captcha.verifyByCode(805, "BBBBB");
    expect(last.ok).toBe(false);
    expect(e.calls.filter((call) => call.method === "banChatMember")).toHaveLength(1);
    expect(e.repo.getChallenge(GROUP_ID, 805)).toBeUndefined();
  });

  it("重启恢复：过期挑战立即处置，未过期重新挂表", async () => {
    const e = await env();
    await setupCaptcha(e, "button");
    const group = e.repo.getGroup(GROUP_ID)!;
    e.repo.putChallenge({
      token: "expiredtoken",
      chatId: GROUP_ID,
      userId: 806,
      userName: "Expired",
      mode: "button",
      attempts: 0,
      createdAt: Date.now() - 120_000,
      expiresAt: Date.now() - 1_000,
      promptMessageIds: {},
      dmSent: true,
      groupFallback: false,
    });
    e.repo.putChallenge({
      token: "livetoken",
      chatId: GROUP_ID,
      userId: 807,
      userName: "Alive",
      mode: "button",
      attempts: 0,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      promptMessageIds: {},
      dmSent: true,
      groupFallback: false,
    });

    const count = await e.deps.captcha.restore();
    expect(count).toBe(2);
    expect(e.repo.getChallenge(GROUP_ID, 806)).toBeUndefined();
    expect(e.repo.getChallenge(GROUP_ID, 807)).toBeDefined();
    expect(e.calls.filter((call) => call.method === "banChatMember")).toHaveLength(1);
    void group;
  });

  it("私聊回复验证码可完成验证（端到端）", async () => {
    const e = await env();
    await setupCaptcha(e, "image");
    await e.bot.handleUpdate(joinUpdate({ userId: 808 }));

    const record = e.repo.getChallenge(GROUP_ID, 808)!;
    await e.bot.handleUpdate(
      textUpdate({ userId: 808, chatType: "private", chatId: 808, text: record.code ?? "" }),
    );
    expect(e.repo.getGroup(GROUP_ID)?.stats.captchaSolved).toBe(1);
    expect(e.repo.getChallenge(GROUP_ID, 808)).toBeUndefined();
  });
});
