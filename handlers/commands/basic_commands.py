from telegram import Update
from telegram.ext import ContextTypes
from utils.decorators import CommandRegistry
from utils.logger import setup_logger

logger = setup_logger()

@CommandRegistry.register(command="start", description="启动机器人")
async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /start 命令"""
    try:
        user = update.effective_user
        welcome_message = (
            f'👋 你好 {user.first_name}！\n'
            f'我是一个功能强大的 Telegram 机器人。\n\n'
            f'💡 使用提示：\n'
            f'• 发送 /menu 设置快捷命令菜单\n'
            f'• 发送 /help 查看所有可用命令\n'
            f'• 点击输入框左边的 / 可以快速选择命令'
        )
        await update.message.reply_text(welcome_message)
        logger.info(f"🎉 已发送欢迎消息给用户 {user.first_name}")
    except Exception as e:
        logger.error(f"处理start命令时出错: {str(e)}")

@CommandRegistry.register(command="help", description="显示帮助信息")
async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /help 命令"""
    try:
        user = update.effective_user
        logger.info(f"📖 正在生成帮助信息给用户 {user.first_name}")
        
        commands = CommandRegistry.get_commands()
        help_text = "📝 可用命令列表：\n\n"
        
        for cmd in commands:
            if not cmd['is_admin']:  # 只显示非管理员命令
                help_text += f"/{cmd['command']} - {cmd['description']}\n"
        
        await update.message.reply_text(help_text)
        logger.info(f"📚 已发送帮助信息给用户 {user.first_name}")
    except Exception as e:
        logger.error(f"处理help命令时出错: {str(e)}") 

@CommandRegistry.register(command="id", description="查看ID信息")
async def id_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /id 命令 - 显示用户和群组ID"""
    try:
        user = update.effective_user
        chat = update.effective_chat
        
        # 构建响应消息
        if chat.type == 'private':
            # 私聊消息
            response = (
                "👤 用户信息\n"
                f"ID: <code>{user.id}</code>\n"
                f"用户名: {('@' + user.username) if user.username else '无'}"
            )
        else:
            # 群组消息
            response = (
                "👥 群组信息\n"
                f"群组ID: <code>{chat.id}</code>\n"
                f"群组类型: {chat.type}\n"
                f"群组名称: {chat.title}\n\n"
                "👤 用户信息\n"
                f"用户ID: <code>{user.id}</code>\n"
                f"用户名: {('@' + user.username) if user.username else '无'}"
            )
        
        # 使用 HTML 解析模式发送消息
        await update.message.reply_text(
            response,
            parse_mode='HTML'
        )
        logger.info(f"📊 已发送ID信息给用户 {user.first_name}")
        
    except Exception as e:
        error_msg = f"获取ID信息时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}") 