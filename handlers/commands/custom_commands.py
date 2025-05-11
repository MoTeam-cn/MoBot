from telegram import Update
from telegram.ext import ContextTypes
from utils.decorators import CommandRegistry

@CommandRegistry.register(command="hello", description="打个招呼")
async def hello_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("👋 你好啊！")

@CommandRegistry.register(command="weather", description="查看天气")
async def weather_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🌤 今天天气真不错！")

@CommandRegistry.register(command="admin", description="管理员命令", is_admin=True)
async def admin_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("这是管理员命令！") 