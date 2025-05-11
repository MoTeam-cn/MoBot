from telegram import Update
from telegram.ext import ContextTypes
from utils.decorators import CommandRegistry
from utils.logger import setup_logger
import asyncio
import platform
import re
from config.config import PING_ENABLED

logger = setup_logger()

async def async_ping(host, count=4):
    """异步执行ping命令"""
    try:
        # 根据操作系统选择ping命令参数
        if platform.system().lower() == "windows":
            cmd = f"ping -n {count} {host}"
        else:
            cmd = f"ping -c {count} {host}"
        
        # 执行ping命令
        process = await asyncio.create_subprocess_shell(
            cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        stdout, stderr = await process.communicate()
        
        if process.returncode == 0:
            return True, stdout.decode()
        else:
            return False, stderr.decode()
            
    except Exception as e:
        return False, str(e)

def is_valid_domain(domain):
    """验证域名格式"""
    pattern = r'^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$'
    return bool(re.match(pattern, domain))

@CommandRegistry.register(
    command="ping", 
    description="Ping指定域名", 
    is_admin=True,  # 设置为管理员命令
    enabled=PING_ENABLED  # 使用配置控制是否启用
)
async def ping_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /ping 命令"""
    try:
        user = update.effective_user
        
        # 检查是否提供了域名参数
        if not context.args:
            await update.message.reply_text(
                "❌ 请提供要ping的域名\n"
                "例如: /ping google.com"
            )
            return
        
        domain = context.args[0].lower()
        
        # 验证域名格式
        if not is_valid_domain(domain):
            await update.message.reply_text(
                "❌ 无效的域名格式\n"
                "请输入正确的域名，例如: google.com"
            )
            return
        
        logger.info(f"🔍 用户 {user.first_name} 请求 ping {domain}")
        
        # 发送等待消息
        message = await update.message.reply_text(
            f"🔄 正在 ping {domain}...\n"
            "请稍候，这可能需要几秒钟。"
        )
        
        # 执行ping
        logger.info(f"开始执行 ping {domain}")
        success, result = await async_ping(domain)
        logger.info(f"Ping 执行结果: success={success}, result='{result}'")
        
        # 处理结果
        if success:
            # 提取关键信息
            if platform.system().lower() == "windows":
                # Windows格式的ping结果处理
                try:
                    lines = result.strip().split('\n')
                    # 获取统计信息（最后四行）
                    stats = [line for line in lines[-4:] if line.strip()]
                    response = (
                        f"✅ Ping {domain} 结果：\n\n"
                        f"{stats[0]}\n{stats[1]}\n{stats[2]}\n{stats[3]}"
                    )
                except Exception as e:
                    logger.warning(f"处理Windows ping结果时出错: {str(e)}")
                    response = f"✅ Ping成功，但无法解析详细结果：\n{result}"
            else:
                # Linux/Unix格式的ping结果处理
                try:
                    lines = result.strip().split('\n')
                    # 获取统计信息（最后两行）
                    stats = [line for line in lines[-2:] if line.strip()]
                    response = (
                        f"✅ Ping {domain} 结果：\n\n"
                        f"{stats[0]}\n{stats[1]}"
                    )
                except Exception as e:
                    logger.warning(f"处理Unix ping结果时出错: {str(e)}")
                    response = f"✅ Ping成功，但无法解析详细结果：\n{result}"
        else:
            # 记录失败原因
            logger.error(f"Ping失败，原因: {result}")
            response = (
                f"❌ Ping {domain} 失败\n"
                f"错误信息：{result}"
            )
        
        # 使用代码块格式化输出
        formatted_response = f"```\n{response}\n```"
        
        # 更新消息
        await message.edit_text(formatted_response, parse_mode='Markdown')
        logger.info(f"✨ 已发送 ping {domain} 结果给用户 {user.first_name}")
        
    except Exception as e:
        error_msg = f"执行ping命令时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}") 