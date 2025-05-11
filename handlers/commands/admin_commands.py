from telegram import Update
from telegram.ext import ContextTypes
from utils.decorators import CommandRegistry
from utils.logger import setup_logger
from config.config import ADMIN_IDS

logger = setup_logger()

@CommandRegistry.register(command="admin", description="查看管理员信息", is_admin=True)
async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /admin 命令"""
    try:
        user = update.effective_user
        
        # 获取所有管理员命令
        admin_commands = [
            cmd for cmd in CommandRegistry.get_commands() 
            if cmd['is_admin']
        ]
        
        # 构建响应消息
        response = (
            f"👮‍♂️ 管理员信息\n\n"
            f"当前管理员ID：\n"
            f"{', '.join(map(str, ADMIN_IDS))}\n\n"
            f"可用管理员命令：\n"
        )
        
        for cmd in admin_commands:
            enabled = "✅" if cmd['enabled'] else "❌"
            response += f"{enabled} /{cmd['command']} - {cmd['description']}\n"
        
        await update.message.reply_text(response)
        logger.info(f"📊 已发送管理员信息给用户 {user.first_name}")
        
    except Exception as e:
        error_msg = f"获取管理员信息时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}") 