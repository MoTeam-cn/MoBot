import { afterEach, describe, expect, it } from "vitest";
import { ANONYMOUS_BOT_ID, GROUP_ID, SUPER_ADMIN, cleanupEnv, createEnv, textUpdate, type TestEnv } from "./helpers";

const envs: TestEnv[] = [];
afterEach(async () => {
  for (const item of envs.splice(0)) await cleanupEnv(item);
});

async function env(): Promise<TestEnv> {
  const created = await createEnv();
  envs.push(created);
  return created;
}

/** 匿名管理员：以群组身份发言 */
function anonymousUpdate(text: string, options: { messageId?: number; replyToSenderChat?: { id: number; type: string; title?: string }; replyToUserId?: number } = {}) {
  return textUpdate({
    userId: ANONYMOUS_BOT_ID,
    text,
    messageId: options.messageId ?? 200,
    senderChat: { id: GROUP_ID, type: "supergroup", title: "测试群" },
    replyToSenderChat: options.replyToSenderChat,
    replyToUserId: options.replyToUserId,
  });
}

function lastMessage(e: TestEnv): string {
  const reply = e.calls.filter((call) => call.method === "sendMessage" || call.method === "editMessageText").at(-1);
  return String(reply?.payload.text ?? "");
}

describe("匿名管理员", () => {
  it("/settings 能打开面板（不再提示不是管理员）", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(anonymousUpdate("/settings"));

    const text = lastMessage(e);
    expect(text).toContain("群设置");
    expect(text).not.toContain("只有群管理员");
  });

  it("匿名管理员可以改设置", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(anonymousUpdate("/set warnLimit 5"));
    expect(e.repo.getGroup(GROUP_ID)?.warnLimit).toBe(5);

    await e.bot.handleUpdate(anonymousUpdate("/addword 匿名测试词", { messageId: 201 }));
    expect(e.repo.getGroup(GROUP_ID)?.keywords.some((rule) => rule.pattern === "匿名测试词")).toBe(true);
  });

  it("匿名管理员的消息不会被关键词过滤", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "广告", action: "delete" });

    await e.bot.handleUpdate(anonymousUpdate("这是管理员发的广告说明", { messageId: 202 }));
    expect(e.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(0);
  });

  it("频道身份发言同样视为管理员", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(
      textUpdate({
        userId: ANONYMOUS_BOT_ID,
        text: "/settings",
        messageId: 203,
        senderChat: { id: -1009999888877, type: "channel", title: "关联频道" },
      }),
    );
    expect(lastMessage(e)).toContain("群设置");
  });

  it("普通成员仍然被拒绝（回归）", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(textUpdate({ userId: 777, text: "/settings", messageId: 204 }));
    expect(lastMessage(e)).toContain("只有群管理员");
  });

  it("回复匿名管理员消息时提示无法定位用户", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(
      textUpdate({
        userId: SUPER_ADMIN,
        text: "/warn 刷屏",
        messageId: 205,
        replyToSenderChat: { id: GROUP_ID, type: "supergroup", title: "测试群" },
      }),
    );

    expect(lastMessage(e)).toContain("匿名管理员");
    expect(e.calls.filter((call) => call.method === "restrictChatMember")).toHaveLength(0);
  });

  it("/id 会标出匿名管理员身份", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(anonymousUpdate("/id", { messageId: 206 }));
    expect(lastMessage(e)).toContain("匿名管理员");
  });
});
