import os
import importlib
from telegram.ext import Application, CommandHandler
from utils.decorators import CommandRegistry
from utils.logger import setup_logger
from handlers.commands.cookie_commands import setup_cookie_handlers
from handlers.commands.baidu_commands import setup_baidu_handlers

logger = setup_logger()

async def setup_commands(application: Application) -> None:
    """
    自动加载和注册所有命令
    """
    # 导入commands目录下所有命令模块
    commands_dir = os.path.join(os.path.dirname(__file__), 'commands')
    for filename in os.listdir(commands_dir):
        if filename.endswith('.py') and not filename.startswith('__'):
            module_name = f"handlers.commands.{filename[:-3]}"
            try:
                importlib.import_module(module_name)
                logger.info(f"✅ 已加载命令模块: {module_name}")
            except Exception as e:
                logger.error(f"❌ 加载命令模块失败 {module_name}: {str(e)}")
    
    # 注册所有命令
    for command in CommandRegistry.get_commands():
        try:
            application.add_handler(
                CommandHandler(command['command'], command['handler'])
            )
            logger.info(f"📝 注册命令: /{command['command']}")
        except Exception as e:
            logger.error(f"❌ 注册命令失败 /{command['command']}: {str(e)}") 
    
    # 设置Cookie处理器
    setup_cookie_handlers(application) 
    
    # 设置百度网盘处理器
    setup_baidu_handlers(application) 