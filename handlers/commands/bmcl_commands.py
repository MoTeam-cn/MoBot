from telegram import Update
from telegram.ext import ContextTypes
from utils.decorators import CommandRegistry
from utils.logger import setup_logger
import aiohttp
import json

logger = setup_logger()

def format_size(bytes_size: int) -> str:
    """格式化文件大小"""
    if bytes_size < 1024:
        return f"{bytes_size}B"
    elif bytes_size < 1024 * 1024:
        return f"{bytes_size/1024:.2f}KB"
    elif bytes_size < 1024 * 1024 * 1024:
        return f"{bytes_size/1024/1024:.2f}MB"
    elif bytes_size < 1024 * 1024 * 1024 * 1024:
        return f"{bytes_size/1024/1024/1024:.2f}GB"
    else:
        return f"{bytes_size/1024/1024/1024/1024:.2f}TiB"

def format_hits(hits: int) -> str:
    """格式化请求次数"""
    if hits < 10000:
        return f"{hits}"
    elif hits < 100000000:
        return f"{hits/10000:.2f}万"
    else:
        return f"{hits/100000000:.2f}亿"

@CommandRegistry.register(command="bmcl", description="查看BMCLAPI节点统计")
async def bmcl_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /bmcl 命令 - 显示BMCLAPI节点统计信息"""
    try:
        user = update.effective_user
        logger.info(f"用户 {user.first_name} 请求BMCLAPI节点统计")
        
        # 发送等待消息
        message = await update.message.reply_text(
            "🔄 正在获取BMCLAPI节点统计信息...\n"
            "请稍候"
        )
        
        # 请求API
        async with aiohttp.ClientSession() as session:
            async with session.get('https://bd.bangbang93.com/openbmclapi/metric/rank') as response:
                if response.status != 200:
                    await message.edit_text("❌ 获取节点信息失败")
                    return
                    
                data = await response.json()
        
        # 计算总流量和总请求次数
        total_bytes = sum(node.get('metric', {}).get('bytes', 0) for node in data if node.get('isEnabled', False))
        total_hits = sum(node.get('metric', {}).get('hits', 0) for node in data if node.get('isEnabled', False))
        
        # 构建响应消息
        response = (
            f"📊 BMCLAPI 节点统计\n\n"
            f"今日总流量：{format_size(total_bytes)}\n"
            f"共响应 {format_hits(total_hits)} 次请求\n\n"
            f"节点流量排名：\n"
        )
        
        # 对启用的节点按流量排序
        enabled_nodes = [node for node in data if node.get('isEnabled', False)]
        sorted_nodes = sorted(
            enabled_nodes, 
            key=lambda x: x.get('metric', {}).get('bytes', 0), 
            reverse=True
        )
        
        # 添加前10个节点的信息
        medals = ['🥇', '🥈', '🥉']
        for i, node in enumerate(sorted_nodes[:10]):
            medal = medals[i] if i < 3 else f"{i+1}."
            name = node.get('name', 'Unknown')
            bytes_size = format_size(node.get('metric', {}).get('bytes', 0))
            hits = format_hits(node.get('metric', {}).get('hits', 0))
            
            response += f"{medal} {name}: {bytes_size}, {hits} 次请求\n"
        
        # 更新消息
        await message.edit_text(response)
        logger.info(f"✅ 已发送BMCLAPI节点统计给用户 {user.first_name}")
        
    except Exception as e:
        error_msg = f"获取BMCLAPI节点统计时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}") 