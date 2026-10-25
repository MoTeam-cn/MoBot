import { afterEach, describe, expect, it } from "vitest";
import { GROUP_ID, SUPER_ADMIN, cleanupEnv, createEnv, textUpdate, type TestEnv } from "./helpers";
import { pushCommandMenus, GROUP_COMMANDS, PRIVATE_COMMANDS } from "../src/bot/menus";

const envs: TestEnv[] = [];
afterEach(async () => {
  for (const item of envs.splice(0)) await cleanupEnv(item);
});

async function env(options: Parameters<typeof createEnv>[0] = {}): Promise<TestEnv> {
  const created = await createEnv(options);
  envs.push(created);
  return created;
}

function privateUpdate(userId: number, text: string) {
  return textUpdate({ userId, chatType: "private", chatId: userId, text });
}

describe("初始化 /setup", () => {
  it("未初始化时拒绝其它命令并提示 /setup", async () => {
    const e = await env({ initialize: false });
    await e.bot.handleUpdate(privateUpdate(42, "/groups"));

    const reply = e.calls.find((call) => call.method === "sendMessage");
    expect(String(reply?.payload.text)).toContain("/setup");
    expect(e.repo.isInitialized()).toBe(false);
  });

  it("token 错误时不授予权限", async () => {
    const e = await env({ initialize: false });
    e.repo.setSetupToken("ABCD1234");

    await e.bot.handleUpdate(privateUpdate(42, "/setup WRONG999"));
    expect(e.repo.isInitialized()).toBe(false);
    const reply = e.calls.find((call) => call.method === "sendMessage");
    expect(String(reply?.payload.text)).toContain("token 不正确");
  });

  it("token 正确：第一个用户成为超管并推送菜单", async () => {
    const e = await env({ initialize: false });
    e.repo.setSetupToken("ABCD1234");

    await e.bot.handleUpdate(privateUpdate(42, "/setup abcd1234"));

    expect(e.repo.isInitialized()).toBe(true);
    expect(e.repo.isSuperAdmin(42)).toBe(true);
    expect(e.repo.profile.setupToken).toBeUndefined();

    const menus = e.calls.filter((call) => call.method === "setMyCommands");
    expect(menus).toHaveLength(3);

    // 初始化后可执行管理命令
    e.repo.ensureGroup(GROUP_ID, "测试群");
    await e.bot.handleUpdate(textUpdate({ userId: 42, text: "/addword 广告" }));
    expect(e.repo.getGroup(GROUP_ID)?.keywords).toHaveLength(1);
  });

  it("已初始化后再 /setup 提示已完成", async () => {
    const e = await env();
    await e.bot.handleUpdate(privateUpdate(43, "/setup ANYTOKEN"));
    const reply = e.calls.find((call) => call.method === "sendMessage");
    expect(String(reply?.payload.text)).toContain("已完成初始化");
    expect(e.repo.isSuperAdmin(43)).toBe(false);
  });
});

describe("角色权限", () => {
  it("普通管理员不能增删管理员 / 不能加群", async () => {
    const e = await env();
    e.repo.addAdmin(50);

    await e.bot.handleUpdate(privateUpdate(50, "/addadmin 51"));
    await e.bot.handleUpdate(privateUpdate(50, "/addgroup -1005555555555"));
    await e.bot.handleUpdate(privateUpdate(50, "/gban 777"));

    expect(e.repo.isBotAdmin(51)).toBe(false);
    expect(e.repo.hasGroup(-1005555555555)).toBe(false);
    expect(e.repo.isGloballyBanned(777)).toBe(false);
  });

  it("普通管理员可以管理群设置与成员", async () => {
    const e = await env();
    e.repo.addAdmin(51);
    e.repo.ensureGroup(GROUP_ID, "测试群");

    await e.bot.handleUpdate(textUpdate({ userId: 51, text: "/addword 违规词 --action mute" }));
    expect(e.repo.getGroup(GROUP_ID)?.keywords).toHaveLength(1);

    await e.bot.handleUpdate(textUpdate({ userId: 51, text: "/set warnLimit 4" }));
    expect(e.repo.getGroup(GROUP_ID)?.warnLimit).toBe(4);
  });

  it("超管可以添加普通管理员", async () => {
    const e = await env();
    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/addadmin 52"));
    expect(e.repo.isBotAdmin(52)).toBe(true);
    expect(e.repo.isSuperAdmin(52)).toBe(false);

    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/deladmin 52"));
    expect(e.repo.isBotAdmin(52)).toBe(false);
  });

  it("超管可以登记与移除受管群", async () => {
    const e = await env();
    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/addgroup -1007777777777"));
    expect(e.repo.hasGroup(-1007777777777)).toBe(true);

    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/groups"));
    const listed = e.calls.filter((call) => call.method === "sendMessage").at(-1);
    expect(String(listed?.payload.text)).toContain("受管群");

    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/delgroup -1007777777777"));
    expect(e.repo.hasGroup(-1007777777777)).toBe(false);
  });

  it("超管可以全局封禁并同步到各群", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/gban 900 广告机器人"));

    expect(e.repo.isGloballyBanned(900)).toBe(true);
    const bans = e.calls.filter((call) => call.method === "banChatMember");
    expect(bans.length).toBeGreaterThanOrEqual(1);
  });
});

describe("私聊菜单与配置", () => {
  it("pushCommandMenus 推送私聊 / 群 / 群管理员三套作用域", async () => {
    const calls: { commands: unknown[]; scope: { type: string } }[] = [];
    const api = {
      setMyCommands: async (commands: unknown[], other: { scope: { type: string } }) => {
        calls.push({ commands, scope: other.scope });
        return true;
      },
    };
    const { logger } = await import("./helpers");
    await pushCommandMenus(api as never, logger);

    expect(calls).toHaveLength(3);
    expect(calls.map((item) => item.scope.type).sort()).toEqual([
      "all_chat_administrators",
      "all_group_chats",
      "all_private_chats",
    ]);
    const privateScope = calls.find((item) => item.scope.type === "all_private_chats");
    expect(privateScope?.commands).toHaveLength(PRIVATE_COMMANDS.length);
    const groupScope = calls.find((item) => item.scope.type === "all_group_chats");
    expect(groupScope?.commands).toHaveLength(GROUP_COMMANDS.length);
    // 命令名必须小写且不含空格
    for (const command of [...PRIVATE_COMMANDS, ...GROUP_COMMANDS]) {
      expect(command.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(command.description.length).toBeLessThanOrEqual(256);
    }
  });

  it("/config 设置 publicUrl 后网页验证可用", async () => {
    const e = await env();
    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/config publicUrl https://bot.example.com/"));

    expect(e.repo.profile.publicUrl).toBe("https://bot.example.com");

    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/config"));
    const reply = e.calls.filter((call) => call.method === "sendMessage").at(-1);
    expect(String(reply?.payload.text)).toContain("bot.example.com");
  });

  it("/config publicUrl off 清除地址", async () => {
    const e = await env();
    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/config publicUrl https://bot.example.com"));
    await e.bot.handleUpdate(privateUpdate(SUPER_ADMIN, "/config publicUrl off"));
    expect(e.repo.profile.publicUrl).toBeUndefined();
  });

  it("web 模式缺少 publicUrl 时降级为图像验证码", async () => {
    const e = await env();
    e.repo.ensureGroup(GROUP_ID, "测试群");
    e.repo.updateGroup(GROUP_ID, (group) => {
      group.captcha.enabled = true;
      group.captcha.mode = "web";
    });

    const group = e.repo.getGroup(GROUP_ID)!;
    const record = await e.deps.captcha.begin(group, {
      id: 810,
      is_bot: false,
      first_name: "Newbie",
    });
    expect(record?.mode).toBe("image");
  });
});
