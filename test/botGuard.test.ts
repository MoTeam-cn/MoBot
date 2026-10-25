import { afterEach, describe, expect, it } from "vitest";
import {
  GROUP_ID,
  SUPER_ADMIN,
  callbackUpdate,
  cleanupEnv,
  createEnv,
  joinUpdate,
  textUpdate,
  type TestEnv,
} from "./helpers";

const envs: TestEnv[] = [];

async function env(options: Parameters<typeof createEnv>[0] = {}): Promise<TestEnv> {
  const created = await createEnv(options);
  envs.push(created);
  return created;
}

afterEach(async () => {
  for (const item of envs.splice(0)) await cleanupEnv(item);
});

describe("关键词拦截", () => {
  it("命中关键词后删除消息并计数", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "广告", action: "delete" });

    await e.bot.handleUpdate(textUpdate({ userId: 555, text: "这里卖广告啦", messageId: 10 }));

    const deletes = e.calls.filter((call) => call.method === "deleteMessage");
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.payload).toMatchObject({ chat_id: GROUP_ID, message_id: 10 });

    const group = e.repo.getGroup(GROUP_ID);
    expect(group?.stats.deleted).toBe(1);
    expect(group?.stats.keywordHits).toBe(1);
    expect(group?.keywords[0]?.hits).toBe(1);
  });

  it("变形关键词同样拦截（空格 / 全角 / 零宽 / 标点）", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "广告", action: "delete" });

    for (const [index, text] of ["这 是 广 告", "广\u200b告", "广*告", "广-告"].entries()) {
      await e.bot.handleUpdate(textUpdate({ userId: 556, text, messageId: 20 + index }));
    }
    expect(e.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(4);
  });

  it("action=mute 时执行禁言", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "加群", action: "mute", muteSeconds: 600 });

    await e.bot.handleUpdate(textUpdate({ userId: 557, text: "快加群领福利" }));

    const restrict = e.calls.filter((call) => call.method === "restrictChatMember");
    expect(restrict).toHaveLength(1);
    expect(restrict[0]?.payload).toMatchObject({ chat_id: GROUP_ID, user_id: 557 });
  });

  it("action=warn 累计到上限后升级为禁言", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.updateGroup(GROUP_ID, (group) => {
      group.warnLimit = 2;
    });
    e.repo.addKeyword(GROUP_ID, { pattern: "刷屏词", action: "warn" });

    await e.bot.handleUpdate(textUpdate({ userId: 558, text: "刷屏词", messageId: 30 }));
    expect(e.calls.filter((call) => call.method === "restrictChatMember")).toHaveLength(0);

    await e.bot.handleUpdate(textUpdate({ userId: 558, text: "刷屏词", messageId: 31 }));
    expect(e.calls.filter((call) => call.method === "restrictChatMember")).toHaveLength(1);
    expect(e.repo.getWarning(GROUP_ID, 558)).toBeUndefined();
  });

  it("群管理员不会被过滤", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "广告", action: "delete" });
    e.mock.adminIds = [600];

    await e.bot.handleUpdate(textUpdate({ userId: 600, text: "我是管理员 广告" }));
    expect(e.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(0);
  });

  it("机器人管理员与信任用户不会被过滤", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "广告", action: "delete" });
    e.repo.addAdmin(601);
    e.repo.addTrusted(GROUP_ID, 602);

    await e.bot.handleUpdate(textUpdate({ userId: 601, text: "普通管理员 广告" }));
    await e.bot.handleUpdate(textUpdate({ userId: 602, text: "白名单 广告" }));
    expect(e.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(0);
  });

  it("未登记的群不处理", async () => {
    const e = await env();
    await e.bot.handleUpdate(textUpdate({ chatId: -1009999, userId: 603, text: "广告" }));
    expect(e.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(0);
  });

  it("试运行模式不真删但仍计数", async () => {
    const e = await env({ dryRun: true });
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "广告", action: "delete" });

    await e.bot.handleUpdate(textUpdate({ userId: 604, text: "广告" }));
    expect(e.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(0);
    expect(e.repo.getGroup(GROUP_ID)?.stats.deleted).toBe(1);
  });
});

describe("内置检测", () => {
  it("反链接默认开启", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    await e.bot.handleUpdate(textUpdate({ userId: 605, text: "看这个 https://spam.example.com" }));
    expect(e.calls.filter((call) => call.method === "deleteMessage")).toHaveLength(1);
  });

  it("全局封禁用户发言直接封禁", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addGlobalBan(606, SUPER_ADMIN, "广告机器人");

    await e.bot.handleUpdate(textUpdate({ userId: 606, text: "大家好" }));
    const bans = e.calls.filter((call) => call.method === "banChatMember");
    expect(bans).toHaveLength(1);
    expect(bans[0]?.payload).toMatchObject({ chat_id: GROUP_ID, user_id: 606 });
  });

  it("刷屏触发禁言", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.updateGroup(GROUP_ID, (group) => {
      group.antiflood = { enabled: true, maxMessages: 2, windowSeconds: 10, muteSeconds: 300 };
    });

    for (let index = 0; index < 3; index += 1) {
      await e.bot.handleUpdate(textUpdate({ userId: 607, text: "刷屏" + index, messageId: 40 + index }));
    }
    const restrict = e.calls.filter((call) => call.method === "restrictChatMember");
    expect(restrict).toHaveLength(1);
    expect(restrict[0]?.payload).toMatchObject({ user_id: 607 });
  });
});

describe("群内命令", () => {
  it("/addword 添加关键词规则", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(textUpdate({ userId: SUPER_ADMIN, text: "/addword 免费领取 --action mute --mute 10m" }));

    const group = e.repo.getGroup(GROUP_ID);
    expect(group?.keywords).toHaveLength(1);
    expect(group?.keywords[0]).toMatchObject({ pattern: "免费领取", action: "mute", muteSeconds: 600 });
  });

  it("/addword 拒绝非法正则", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(textUpdate({ userId: SUPER_ADMIN, text: "/addword ([ --mode regex" }));
    expect(e.repo.getGroup(GROUP_ID)?.keywords).toHaveLength(0);
    const reply = e.calls.find((call) => call.method === "sendMessage");
    expect(String(reply?.payload.text)).toContain("正则无效");
  });

  it("/captcha 打开设置并修改超时", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(textUpdate({ userId: SUPER_ADMIN, text: "/captcha timeout 10" }));
    expect(e.repo.getGroup(GROUP_ID)?.captcha.kickAfterMinutes).toBe(10);

    await e.bot.handleUpdate(textUpdate({ userId: SUPER_ADMIN, text: "/captcha ban permanent" }));
    expect(e.repo.getGroup(GROUP_ID)?.captcha.banSeconds).toBe(0);

    await e.bot.handleUpdate(textUpdate({ userId: SUPER_ADMIN, text: "/captcha mode image" }));
    expect(e.repo.getGroup(GROUP_ID)?.captcha.mode).toBe("image");
  });

  it("非管理员不能改设置", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    await e.bot.handleUpdate(textUpdate({ userId: 700, text: "/set warnLimit 5" }));
    expect(e.repo.getGroup(GROUP_ID)?.warnLimit).toBe(3);
  });

  it("群管理员可以通过 /set 修改设置", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.mock.memberStatus.set(701, "administrator");

    await e.bot.handleUpdate(textUpdate({ userId: 701, text: "/set warnLimit 5" }));
    expect(e.repo.getGroup(GROUP_ID)?.warnLimit).toBe(5);

    await e.bot.handleUpdate(textUpdate({ userId: 701, text: "/set welcome.text 欢迎 {name} 加入 {chat}" }));
    expect(e.repo.getGroup(GROUP_ID)?.welcome.text).toContain("{name}");
  });

  it("/testword 报告命中规则", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.addKeyword(GROUP_ID, { pattern: "广告" });

    await e.bot.handleUpdate(textUpdate({ userId: SUPER_ADMIN, text: "/testword 这里卖广告" }));
    const reply = e.calls.find((call) => call.method === "sendMessage");
    expect(String(reply?.payload.text)).toContain("命中关键词");
  });

  it("入群欢迎语渲染占位符（未开验证时）", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.updateGroup(GROUP_ID, (group) => {
      group.welcome.text = "欢迎 {name} 加入 {chat}";
      group.welcome.autoDeleteSeconds = 0;
    });

    await e.bot.handleUpdate(joinUpdate({ userId: 889 }));
    const welcome = e.calls.find(
      (call) => call.method === "sendMessage" && String(call.payload.text).includes("欢迎"),
    );
    expect(String(welcome?.payload.text)).toContain("Newbie889");
    expect(String(welcome?.payload.text)).toContain("测试群");
  });
});

describe("设置面板回调", () => {
  it("管理员点击按钮切换开关", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.mock.memberStatus.set(702, "administrator");

    expect(e.repo.getGroup(GROUP_ID)?.settings.antiForward).toBe(false);
    await e.bot.handleUpdate(
      callbackUpdate({ userId: 702, data: "cfg:" + GROUP_ID + ":t:antiForward" }),
    );
    expect(e.repo.getGroup(GROUP_ID)?.settings.antiForward).toBe(true);
  });

  it("非管理员点击按钮被拒绝", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(
      callbackUpdate({ userId: 703, data: "cfg:" + GROUP_ID + ":t:antiForward" }),
    );
    expect(e.repo.getGroup(GROUP_ID)?.settings.antiForward).toBe(false);
  });
});
