import { afterEach, describe, expect, it } from "vitest";
import { createHtmlFallbackTransformer } from "../src/bot/htmlFallback";
import { isEntityParseError, stripTelegramHtml } from "../src/utils/html";
import { GROUP_ID, SUPER_ADMIN, cleanupEnv, createEnv, textUpdate, type TestEnv } from "./helpers";

const envs: TestEnv[] = [];
afterEach(async () => {
  for (const item of envs.splice(0)) await cleanupEnv(item);
});

async function env(options: Parameters<typeof createEnv>[0] = {}): Promise<TestEnv> {
  const created = await createEnv(options);
  envs.push(created);
  return created;
}

function privateCmd(userId: number, text: string) {
  return textUpdate({ userId, chatType: "private", chatId: userId, text });
}

function entityError(): Error {
  return Object.assign(new Error("Bad Request: can't parse entities: Unsupported start tag \"群id\""), {
    description: 'Bad Request: can\'t parse entities: Unsupported start tag "群id" at byte offset 244',
    error_code: 400,
  });
}

describe("HTML 文本工具", () => {
  it("stripTelegramHtml 去掉标签并还原实体", () => {
    expect(stripTelegramHtml("<b>粗</b> 与 <code>-100</code> &lt;群ID&gt; &amp; 其余")).toBe(
      "粗 与 -100 <群ID> & 其余",
    );
  });

  it("isEntityParseError 识别 Telegram 报错", () => {
    expect(isEntityParseError(entityError())).toBe(true);
    expect(isEntityParseError({ description: "Bad Request: chat not found" })).toBe(false);
    expect(isEntityParseError(new Error("boom"))).toBe(false);
  });
});

describe("HTML 解析失败兜底", () => {
  it("自动降级为纯文本重发（只重试一次）", async () => {
    const logger = (await import("../src/logger")).createLogger("test", "error");
    const transformer = createHtmlFallbackTransformer(logger);
    const calls: Record<string, unknown>[] = [];

    const prev = async (_method: string, payload: Record<string, unknown>) => {
      calls.push({ ...payload });
      if (payload.parse_mode) throw entityError();
      return { ok: true, result: {} };
    };

    const result = (await (transformer as never as (
      p: typeof prev,
      m: string,
      payload: Record<string, unknown>,
      s?: AbortSignal,
    ) => Promise<unknown>)(prev, "sendMessage", {
      chat_id: 1,
      text: "✅ 完成 <code>123</code> &lt;群ID&gt;",
      parse_mode: "HTML",
    })) as { ok: boolean };

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.parse_mode).toBe("HTML");
    expect(calls[1]?.parse_mode).toBeUndefined();
    expect(String(calls[1]?.text)).toBe("✅ 完成 123 <群ID>");
  });

  it("非实体错误不重试", async () => {
    const logger = (await import("../src/logger")).createLogger("test", "error");
    const transformer = createHtmlFallbackTransformer(logger);
    let attempts = 0;
    const prev = async () => {
      attempts += 1;
      throw Object.assign(new Error("forbidden"), { description: "Forbidden: bot was blocked by the user" });
    };
    await expect(
      (transformer as never as (p: typeof prev, m: string, payload: Record<string, unknown>) => Promise<unknown>)(
        prev,
        "sendMessage",
        { chat_id: 1, text: "x", parse_mode: "HTML" },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});

describe("消息里的尖括号已转义", () => {
  it("/setup 成功消息不含未转义的 <群ID>", async () => {
    const e = await env({ initialize: false });
    e.repo.setSetupToken("TOKEN1234");
    await e.bot.handleUpdate(privateCmd(42, "/setup TOKEN1234"));

    const reply = e.calls.filter((call) => call.method === "sendMessage").at(-1);
    const text = String(reply?.payload.text ?? "");
    expect(text).toContain("&lt;群ID&gt;");
    expect(text).not.toMatch(/<群ID>/);
    expect(text).not.toMatch(/<ID>/);
  });

  it("群名含 HTML 字符时 /addgroup 与 /id 都不报错", async () => {
    const e = await env();
    e.mock.chatTitle = "<b>坏</b>群 & 测试";

    await e.bot.handleUpdate(privateCmd(SUPER_ADMIN, "/addgroup -1007777777777"));
    const added = e.calls.filter((call) => call.method === "sendMessage").at(-1);
    expect(String(added?.payload.text)).toContain("&lt;b&gt;坏&lt;/b&gt;群 &amp; 测试");

    e.repo.ensureGroup(GROUP_ID, "<b>坏</b>群");
    const idUpdate = textUpdate({ userId: SUPER_ADMIN, text: "/id" }) as unknown as {
      message: { chat: { title?: string } };
    };
    idUpdate.message.chat.title = "<b>坏</b>群 & 测试";
    await e.bot.handleUpdate(idUpdate as never);
    const idReply = e.calls.filter((call) => call.method === "sendMessage").at(-1);
    expect(String(idReply?.payload.text)).toContain("&lt;b&gt;坏&lt;/b&gt;群 &amp; 测试");
  });
});
