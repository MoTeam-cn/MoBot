import logging
import sys
from datetime import datetime
from colorama import init, Fore, Style

init()  # 初始化colorama

class ColoredFormatter(logging.Formatter):
    """自定义彩色日志格式器"""
    
    COLORS = {
        'INFO': Fore.GREEN,
        'WARNING': Fore.YELLOW,
        'ERROR': Fore.RED,
        'CRITICAL': Fore.RED + Style.BRIGHT,
        'DEBUG': Fore.BLUE
    }

    def format(self, record):
        # 获取对应的颜色
        color = self.COLORS.get(record.levelname, '')
        
        # 自定义时间格式
        time_format = datetime.fromtimestamp(record.created).strftime("%Y-%m-%d %H:%M:%S")
        
        # 格式化日志信息
        if record.levelname == 'INFO':
            log_fmt = f"{Fore.WHITE}[{time_format}]{Style.RESET_ALL} {color}● {record.levelname}{Style.RESET_ALL}: {record.getMessage()}"
        else:
            log_fmt = f"{Fore.WHITE}[{time_format}]{Style.RESET_ALL} {color}▲ {record.levelname}{Style.RESET_ALL}: {record.getMessage()}"
        
        return log_fmt

def setup_logger():
    """配置日志"""
    logger = logging.getLogger('TelegramBot')
    logger.setLevel(logging.INFO)
    
    # 如果logger已经有处理器，先清除
    if logger.handlers:
        logger.handlers.clear()
    
    # 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(ColoredFormatter())
    logger.addHandler(console_handler)
    
    # 文件处理器
    file_formatter = logging.Formatter(
        '[%(asctime)s] %(levelname)s: %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    file_handler = logging.FileHandler('bot.log', encoding='utf-8')
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)
    
    return logger 