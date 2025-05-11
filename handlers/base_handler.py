from telegram import Update
from telegram.ext import ContextTypes
from utils.logger import setup_logger

logger = setup_logger()

async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /start 命令"""
    try:
        user = update.effective_user
        await update.message.reply_text(
            f'你好 {user.first_name}！我是一个 Telegram 机器人。'
        )
    except Exception as e:
        logger.error(f"处理start命令时出错: {str(e)}") 