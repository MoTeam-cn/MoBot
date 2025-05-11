from functools import wraps
from typing import List, Callable
from utils.logger import setup_logger
from config.config import ADMIN_IDS, PING_ENABLED

logger = setup_logger()

class CommandRegistry:
    """命令注册中心"""
    _commands: List[dict] = []
    
    @classmethod
    def register(cls, command: str, description: str = "", is_admin: bool = False, enabled: bool = True):
        """
        命令注册装饰器
        :param command: 命令名称（不含/）
        :param description: 命令描述
        :param is_admin: 是否仅管理员可用
        :param enabled: 命令是否启用
        """
        def decorator(func: Callable):
            @wraps(func)
            async def wrapper(update, context, *args, **kwargs):
                user = update.effective_user
                logger.info(f"📩 收到来自 {user.first_name}({user.id}) 的命令: /{command}")
                
                # 检查命令是否启用
                if not enabled:
                    await update.message.reply_text("❌ 该命令当前未启用")
                    return
                
                # 检查管理员权限
                if is_admin:
                    if not ADMIN_IDS:  # 如果没有配置管理员ID
                        logger.warning(f"⚠️ 未配置管理员ID，拒绝执行管理员命令 /{command}")
                        await update.message.reply_text("❌ 未配置管理员，该命令不可用")
                        return
                    if user.id not in ADMIN_IDS:
                        await update.message.reply_text("❌ 该命令仅管理员可用")
                        logger.warning(f"⚠️ 用户 {user.first_name}({user.id}) 尝试使用管理员命令 /{command}")
                        return
                
                try:
                    logger.info(f"⚡ 正在处理命令: /{command}")
                    result = await func(update, context, *args, **kwargs)
                    logger.info(f"✅ 命令 /{command} 处理完成")
                    return result
                except Exception as e:
                    logger.error(f"❌ 处理命令 /{command} 时出错: {str(e)}")
                    await update.message.reply_text(f"抱歉，处理命令时出现错误: {str(e)}")
            
            cls._commands.append({
                'command': command,
                'handler': wrapper,
                'description': description,
                'is_admin': is_admin,
                'enabled': enabled
            })
            return wrapper
        return decorator
    
    @classmethod
    def get_commands(cls) -> List[dict]:
        """获取所有已注册的命令"""
        return [cmd for cmd in cls._commands if cmd['enabled']]