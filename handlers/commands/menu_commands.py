from telegram import Update, BotCommand
from telegram.ext import ContextTypes
from utils.decorators import CommandRegistry
from utils.logger import setup_logger

logger = setup_logger()

# 定义菜单命令列表
COMMANDS = [
    ("start", "启动机器人"),
    ("help", "显示帮助信息"),
    ("menu", "设置机器人菜单"),
    ("id", "查看ID信息"),
    ("hello", "打个招呼"),
    ("weather", "查看天气"),
    ("ping", "Ping指定域名"),
    ("cookie", "获取百度网盘Cookie"),
    ("bd", "解析百度网盘链接"),
    ("bmcl", "查看BMCLAPI节点统计"),
]

@CommandRegistry.register(command="menu", description="设置机器人菜单")
async def menu_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /menu 命令 - 设置机器人的命令菜单"""
    try:
        user = update.effective_user
        logger.info(f"📋 用户 {user.first_name} 请求设置菜单")
        
        # 创建命令列表
        commands = [
            BotCommand(command, description) 
            for command, description in COMMANDS
        ]
        
        # 设置机器人的命令菜单
        await context.bot.set_my_commands(commands)
        
        # 发送确认消息
        response = (
            "✅ 菜单设置成功！\n\n"
            "为了使菜单生效，请：\n"
            "1. 退出当前对话页面\n"
            "2. 重新进入对话\n"
            "3. 点击输入框左边的 / 符号即可看到所有命令\n\n"
            "💡 小提示：\n"
            "• 输入 / 后等待命令提示\n"
            "• 使用 /help 查看详细命令说明"
        )
        await update.message.reply_text(response)
        
        logger.info(f"✨ 已为用户 {user.first_name} 设置菜单")
        
    except Exception as e:
        error_msg = f"设置菜单时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}") 

@CommandRegistry.register(
    command="stop", 
    description="关闭机器人", 
    is_admin=True,
    enabled=True  # 命令可用，但不在菜单中显示
)
async def stop_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /stop 命令 - 关闭机器人"""
    try:
        user = update.effective_user
        logger.info(f"🛑 收到来自用户 {user.first_name} 的停止命令")
        
        # 发送关闭确认消息
        await update.message.reply_text(
            "🔄 正在关闭机器人...\n"
            "请稍候，这可能需要几秒钟。"
        )
        
        # 获取应用实例并触发关闭
        application = context.application
        if hasattr(application, '_stop_event') and application._stop_event:
            application._stop_event.set()
        
        logger.info("🛑 通过命令触发关闭流程")
        
    except Exception as e:
        error_msg = f"执行停止命令时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}") 