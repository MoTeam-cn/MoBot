import type { Bot, Context } from "grammy";
import type { BotDeps } from "../deps";
import type { Guards } from "../guards";
import { isPrivateContext } from "../guards";
import { pushCommandMenus } from "../menus";
import { requireTarget } from "../targets";
import { formatDateTime } from "../../utils/time";
import { maskProxy, parseProxy, proxyLabel } from "../../net/proxy";
import { escapeHtml } from "../../utils/telegram";
import { privateMenuKeyboard } from "../keyboards";

export function registerPrivateCommands(bot: Bot<Context>, deps: BotDeps, guards: Guards): void {
  // ---------- 初始化 ----------
  bot.command("setup", async (ctx) => {
    if (!isPrivateContext(ctx)) {
      await ctx.reply("⚠️ 初始化只能在私聊里完成。");
      return;
    }
    if (deps.repo.isInitialized()) {
      const owner = deps.repo.profile.superAdmins[0] ?? 0;
      await ctx.reply(
        "ℹ️ 机器人已完成初始化。\n超管：<code>" +
          deps.repo.profile.superAdmins.join(", ") +
          "</code>\n如需新增管理员，超管可执行 /addadmin &lt;ID&gt;。",
        { parse_mode: "HTML" },
      );
      void owner;
      return;
    }
    const token = (ctx.match ?? "").trim();
    if (!token) {
      await ctx.reply("⚠️ 用法：/setup <控制台打印的初始化 token>");
      return;
    }
    if (!deps.repo.consumeSetupToken(token)) {
      await ctx.reply("❌ token 不正确，请核对控制台输出。");
      return;
    }
    const userId = ctx.from!.id;
    deps.repo.completeSetup(userId);
    await deps.repo.flush();
    await pushCommandMenus(ctx.api, deps.logger);
    await ctx.reply(
      [
        "✅ 初始化完成！",
        "你已被设为<b>超级管理员</b>（ID：<code>" + userId + "</code>）。",
        "",
        "接下来：",
        "1. 把机器人拉进群并设为管理员（删除消息 + 封禁成员）",
        "2. 群里发 /id 拿群 ID",
        "3. 私聊我执行 /addgroup &lt;群ID&gt;",
        "4. 群内 /settings 打开面板，/captcha 配置入群验证",
        "",
        "其他管理员用 /addadmin &lt;ID&gt; 添加（普通管理员权限）。",
      ].join("\n"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
    deps.logger.info("初始化完成", { superAdmin: userId });
  });

  bot.command("init", guards.superAdminOnly, async (ctx) => {
    await pushCommandMenus(ctx.api, deps.logger);
    await ctx.reply("✅ 命令菜单已重新推送（私聊 / 群 / 群管理员）。");
  });

  // ---------- 控制台 ----------
  bot.command("menu", guards.botAdminOnly, async (ctx) => {
    const profile = deps.repo.profile;
    await ctx.reply(
      [
        "🤖 <b>控制台</b>",
        "• 受管群：" + deps.repo.listGroups().length + " 个",
        "• 管理员：" + (profile.admins.length + profile.superAdmins.length) + " 人",
        "• 全局封禁：" + deps.repo.listGlobalBans().length + " 人",
        "",
        guards.isSuperAdmin(ctx) ? "你是超级管理员，可管理一切。" : "你是普通管理员，可管理各群设置与成员。",
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: privateMenuKeyboard(), link_preview_options: { is_disabled: true } },
    );
  });

  // ---------- 管理员 ----------
  bot.command("admins", guards.botAdminOnly, async (ctx) => {
    const profile = deps.repo.profile;
    const lines = ["👤 <b>管理员列表</b>"];
    lines.push("", "<b>超级管理员</b>（可管理一切）");
    lines.push(profile.superAdmins.length ? profile.superAdmins.map((id) => "• <code>" + id + "</code>").join("\n") : "• 无");
    lines.push("", "<b>普通管理员</b>（管理各群）");
    lines.push(profile.admins.length ? profile.admins.map((id) => "• <code>" + id + "</code>").join("\n") : "• 无");
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
  });

  bot.command("addadmin", guards.superAdminOnly, async (ctx) => {
    const arg = (ctx.match ?? "").trim().split(/\s+/)[0];
    const target = await requireTarget(ctx, arg);
    if (!target) return;
    if (deps.repo.isBotAdmin(target.id)) {
      await ctx.reply("ℹ️ 该用户已是管理员。");
      return;
    }
    deps.repo.addAdmin(target.id);
    await ctx.reply(
      "✅ 已添加普通管理员：<code>" + target.id + "</code>\n他可管理各群设置与成员，但不能增删群/管理员，也不能全局封禁。",
      { parse_mode: "HTML" },
    );
  });

  bot.command("deladmin", guards.superAdminOnly, async (ctx) => {
    const arg = (ctx.match ?? "").trim().split(/\s+/)[0];
    const target = await requireTarget(ctx, arg);
    if (!target) return;
    if (deps.repo.isSuperAdmin(target.id)) {
      await ctx.reply("⚠️ 不能移除超级管理员。");
      return;
    }
    const removed = deps.repo.removeAdmin(target.id);
    await ctx.reply(removed ? "✅ 已移除管理员 " + target.id : "ℹ️ 该用户不是普通管理员。");
  });

  // ---------- 代理（热切换） ----------
  bot.command("proxy", guards.superAdminOnly, async (ctx) => {
    const arg = (ctx.match ?? "").trim();

    if (!arg) {
      const current = deps.transport.proxy;
      const source = deps.repo.profile.proxyUrl
        ? "数据库（/proxy 设置）"
        : deps.config.proxyUrl
          ? "环境变量"
          : "未设置";
      await ctx.reply(
        [
          "🌐 <b>Telegram API 代理</b>",
          "• 当前：" + proxyLabel(current),
          "• 来源：" + source,
          "",
          "<b>用法</b>",
          "/proxy http://127.0.0.1:10808",
          "/proxy https://user:pass@host:443",
          "/proxy socks5://user:pass@127.0.0.1:1080",
          "/proxy off",
          "",
          "切换立即生效，无需重启（下一条 API 调用即走新代理）。",
        ].join("\n"),
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
      );
      return;
    }

    if (["off", "none", "direct"].includes(arg.toLowerCase())) {
      deps.repo.setProxyUrl(undefined);
      deps.transport.setProxy(undefined);
      await ctx.reply("✅ 已关闭代理，Telegram API 走直连。");
      return;
    }

    const parsed = parseProxy(arg);
    if (!parsed) {
      await ctx.reply("⚠️ 代理地址无法解析。示例：/proxy http://127.0.0.1:10808");
      return;
    }

    deps.repo.setProxyUrl(parsed.uri);
    deps.transport.setProxy(parsed.uri);

    let probe = "";
    try {
      await ctx.api.getMe();
      probe = "\n✅ 连通性检测通过（getMe 成功）";
    } catch (error) {
      probe = "\n⚠️ 连通性检测失败：" + String((error as Error).message).slice(0, 120);
    }

    await ctx.reply("✅ 已切换代理：" + maskProxy(parsed) + "\n立即生效，无需重启。" + escapeHtml(probe), {
      parse_mode: "HTML",
    });
  });

  // ---------- 热加载 ----------
  bot.command("reload", guards.superAdminOnly, async (ctx) => {
    await ctx.reply("🔄 正在从磁盘热加载数据…");
    try {
      await deps.repo.reload();
      deps.transport.setProxy(deps.repo.profile.proxyUrl ?? deps.config.proxyUrl);
      const restored = await deps.captcha.rearm();
      await pushCommandMenus(ctx.api, deps.logger);
      await ctx.reply(
        "✅ 热加载完成\n• 受管群：" +
          deps.repo.listGroups().length +
          " 个\n• 未完成验证：" +
          restored +
          " 个\n• 代理：" +
          proxyLabel(deps.transport.proxy) +
          "\n\n命令菜单已重新推送。",
      );
    } catch (error) {
      await ctx.reply("❌ 热加载失败：" + String((error as Error).message));
    }
  });

  // ---------- 机器人配置 ----------
  bot.command("config", guards.superAdminOnly, async (ctx) => {
    const parsed = (ctx.match ?? "").trim();
    const [key, ...rest] = parsed.split(/\s+/);
    const value = rest.join(" ").trim();

    if (key && key.toLowerCase() === "publicurl") {
      if (!value) {
        await ctx.reply("⚠️ 用法：/config publicUrl https://your-domain.com（off 可清除）");
        return;
      }
      if (value.toLowerCase() === "off") {
        deps.repo.setPublicUrl(undefined);
        await ctx.reply("✅ 已清除 publicUrl，网页验证将降级为图像验证码。");
        return;
      }
      if (!/^https?:\/\//i.test(value)) {
        await ctx.reply("⚠️ 需要以 http:// 或 https:// 开头。");
        return;
      }
      deps.repo.setPublicUrl(value);
      await ctx.reply("✅ 已设置网页验证地址：" + deps.repo.profile.publicUrl);
      return;
    }

    const profile = deps.repo.profile;
    const publicUrl = profile.publicUrl ?? deps.config.publicUrl ?? "未设置";
    await ctx.reply(
      [
        "⚙️ <b>机器人配置</b>",
        "• 初始化：" + (profile.initializedAt ? formatDateTime(profile.initializedAt) : "未初始化"),
        "• 超管：" + (profile.superAdmins.join(", ") || "无"),
        "• 普通管理员：" + profile.admins.length + " 人",
        "• 受管群：" + deps.repo.listGroups().length + " 个",
        "• 网页验证地址：" + escapeHtml(publicUrl),
        "• Telegram 代理：" + proxyLabel(deps.transport.proxy),
        "• 网页验证端口：" + deps.config.webPort,
        "• 试运行：" + (deps.config.dryRun ? "是" : "否"),
        "• 数据目录：" + escapeHtml(deps.config.dataDir),
        "",
        "修改网页验证地址：/config publicUrl https://example.com",
        "修改代理：/proxy http://127.0.0.1:10808（或 /proxy off）",
        "热加载：/reload",
      ].join("\n"),
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } },
    );
  });
}
