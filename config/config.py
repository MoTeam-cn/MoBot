import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# Bot Token
BOT_TOKEN = os.getenv('BOT_TOKEN')

# 其他配置项
BOT_USERNAME = os.getenv('BOT_USERNAME')

# 代理配置
PROXY_ENABLED = os.getenv('PROXY_ENABLED', 'false').lower() == 'true'  # 代理开关
PROXY_URL = os.getenv('PROXY_URL') if PROXY_ENABLED else None  # 代理地址 

# 功能开关
PING_ENABLED = os.getenv('PING_ENABLED', 'false').lower() == 'true'

# 管理员配置
ADMIN_IDS = [int(id.strip()) for id in os.getenv('ADMIN_IDS', '').split(',') if id.strip()] 

# API配置
API_DOMAIN = os.getenv('API_DOMAIN', 'http://localhost:5244')  # 默认值为本地地址 