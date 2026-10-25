import type { Api } from "grammy";
import type { Logger } from "../logger";

/** 私聊命令菜单 */
export const PRIVATE_COMMANDS = [
  { command: "start", description: "开始 / 查看状态" },
  { command: "help", description: "私聊命令帮助" },
  { command: "menu", description: "打开控制台菜单" },
  { command: "setup", description: "首次初始化（输入控制台 token）" },
  { command: "groups", description: "受管群列表与设置" },
  { command: "addgroup", description: "添加受管群 /addgroup <群ID>" },
  { command: "delgroup", description: "移除受管群 /delgroup <群ID>" },
  { command: "admins", description: "管理员列表" },
  { command: "addadmin", description: "添加普通管理员" },
  { command: "deladmin", description: "移除普通管理员" },
  { command: "gban", description: "全局封禁用户" },
  { command: "ungban", description: "解除全局封禁" },
  { command: "glist", description: "全局封禁名单" },
  { command: "config", description: "机器人配置（含 publicUrl）" },
  { command: "stats", description: "全局统计" },
  { command: "id", description: "查看 ID" },
  { command: "init", description: "重新推送命令菜单" },
];

/** 群内命令菜单 */
export const GROUP_COMMANDS = [
  { command: "settings", description: "群设置面板" },
  { command: "captcha", description: "入群验证设置" },
  { command: "addword", description: "添加关键词 /addword 词 --action mute" },
  { command: "delword", description: "删除关键词" },
  { command: "words", description: "关键词列表" },
  { command: "clearwords", description: "清空关键词" },
  { command: "testword", description: "测试文本会命中哪条规则" },
  { command: "warn", description: "警告成员" },
  { command: "warns", description: "警告记录" },
  { command: "unwarn", description: "清除某人警告" },
  { command: "mute", description: "禁言 /mute 10m" },
  { command: "unmute", description: "解除禁言" },
  { command: "kick", description: "踢出成员" },
  { command: "ban", description: "封禁成员" },
  { command: "unban", description: "解封成员" },
  { command: "purge", description: "清理最近消息" },
  { command: "pin", description: "置顶消息" },
  { command: "unpin", description: "取消置顶" },
  { command: "trust", description: "加入信任名单" },
  { command: "untrust", description: "移出信任名单" },
  { command: "report", description: "举报违规消息" },
  { command: "stats", description: "本群统计" },
  { command: "id", description: "查看 ID" },
  { command: "help", description: "群管命令帮助" },
];

/** 把命令菜单推到 Telegram（私聊 / 群 / 群管理员三套作用域） */
export async function pushCommandMenus(api: Api, logger: Logger): Promise<void> {
  const scopes = [
    { type: "all_private_chats" as const, commands: PRIVATE_COMMANDS },
    { type: "all_group_chats" as const, commands: GROUP_COMMANDS },
    { type: "all_chat_administrators" as const, commands: GROUP_COMMANDS },
  ];
  for (const scope of scopes) {
    try {
      await api.setMyCommands(scope.commands, { scope: { type: scope.type } });
    } catch (error) {
      logger.warn("推送命令菜单失败", { scope: scope.type, error: String(error) });
    }
  }
  logger.info("命令菜单已推送", { private: PRIVATE_COMMANDS.length, group: GROUP_COMMANDS.length });
}
