# MoBot - Telegram Bot

MoBot is a powerful Telegram bot framework developed in Python, utilizing modern asynchronous programming to provide stable and scalable bot services.

## ✨ Features

- 🚀 Asynchronous programming for efficient concurrent request handling
- 🛡️ Built-in proxy support for various network environments
- 📝 Modular command handling system
- 🔄 Graceful startup and shutdown mechanisms
- 📊 Comprehensive logging system
- 🎯 Custom command extension support
- 🌐 Connection pool management for enhanced performance
- 🔒 Exception handling mechanism

## 🔧 Tech Stack

- Python 3.x
- python-telegram-bot 20.7
- python-dotenv 1.0.0
- httpx (with SOCKS proxy support)
- aiohttp 3.8.1
- colorama 0.4.6

## 📁 Project Structure

```
MoBot/
├── main.py              # Main program entry
├── requirements.txt     # Project dependencies
├── bot.log             # Log file
├── config/             # Configuration directory
├── handlers/           # Message handlers
│   ├── commands/      # Command handling modules
│   ├── base_handler.py
│   └── command_loader.py
└── utils/              # Utility functions
```

## 🚀 Quick Start

1. **Environment Setup**

```bash
# Clone the project
git clone https://github.com/MoTeam-cn/Telegram-Bot

# Install dependencies
pip install -r requirements.txt
```

## ⚙️ Environment Configuration

1. Create `.env` file in the project root directory:

```bash
# Bot Configuration
BOT_TOKEN=your_bot_token_here    # Your Telegram Bot Token
BOT_USERNAME=your_bot_username   # Bot Username

# Admin Configuration
ADMIN_IDS=123456,789012         # Admin ID list, separate multiple IDs with commas

# Proxy Configuration (Optional)
PROXY_ENABLED=false             # Whether to enable proxy
PROXY_URL=socks5://127.0.0.1:7890  # Proxy server address

# Feature Switches
PING_ENABLED=false              # Whether to enable ping feature

# API Configuration
API_DOMAIN=http://localhost:5244  # API domain address
```

2. Configuration Details:

| Config Item | Description | Required | Default |
|-------------|-------------|----------|----------|
| BOT_TOKEN | Telegram Bot Token | Yes | - |
| BOT_USERNAME | Bot Username | Yes | - |
| ADMIN_IDS | Admin ID List | No | - |
| PROXY_ENABLED | Enable proxy | No | false |
| PROXY_URL | Proxy server address | No | - |
| PING_ENABLED | Enable ping feature | No | false |
| API_DOMAIN | API domain address | No | http://localhost:5244 |

3. Using Configuration Values:

```python
from config.config import BOT_TOKEN, PROXY_ENABLED, PROXY_URL, ADMIN_IDS

# Get admin ID list
admin_ids = ADMIN_IDS  # Returns list of integers

# Check if proxy is enabled
if PROXY_ENABLED:
    proxy_url = PROXY_URL
    # Code for enabling proxy
```

4. **Launch the Bot**

```bash
python main.py
```

Example startup log:
```log
[2025-04-06 14:36:12] ● INFO: 🚀 Starting bot...
[2025-04-06 14:36:12] ● INFO: 🌐 Proxy enabled: http://127.0.0.1:10809
[2025-04-06 14:36:12] ● INFO: ⚙️ Creating application instance...
[2025-04-06 14:36:12] ● INFO: ✅ Application instance created successfully
[2025-04-06 14:36:12] ● INFO: 📝 Loading commands...
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.admin_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.baidu_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.basic_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.bmcl_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.cookie_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.custom_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.menu_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.network_commands
[2025-04-06 14:36:12] ● INFO: ✅ Command module loaded: handlers.commands.proxy_commands
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /cookie
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /bd
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /admin
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /start
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /help
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /id
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /bmcl
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /hello
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /weather
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /menu
[2025-04-06 14:36:12] ● INFO: 📝 Registering command: /stop
[2025-04-06 14:36:12] ● INFO: ✅ Commands loaded successfully
[2025-04-06 14:36:12] ● INFO: ✨ Bot started successfully!
[2025-04-06 14:36:12] ● INFO: 🤖 Bot is running...
[2025-04-06 14:36:12] ● INFO: 📡 Start listening for messages...
```

## �� Core Features

### Asynchronous Processing
- Implemented with `asyncio`
- Optimized connection pool management
- Efficient concurrent request handling

### Proxy Support
- SOCKS proxy support
- Configurable proxy settings
- Flexible network adaptability

### Command System
- Modular command handling
- Easily extensible command registration
- Complete command lifecycle management

### Error Handling
- Comprehensive exception catching
- Detailed logging
- Graceful error recovery

## 📝 Logging System

- Detailed operation logging
- Hierarchical log management
- Easy debugging and monitoring

## 🔐 Security Features

- Secure token management
- Proxy server support
- Exception handling mechanism

## 🛠️ Development Guide

### Adding New Commands

1. Create a new command handler in `handlers/commands`
2. Implement command logic
3. Register the command in `command_loader.py`

### Custom Features

- Extend `base_handler.py` for custom handlers
- Add new utility functions in the `utils` directory
- Manage features through configuration files

## 📈 Performance Optimization

- Connection pool management
- Asynchronous operation optimization
- Timeout handling mechanism

## 🤝 Contributing

Issues and Pull Requests are welcome to help improve the project.

## 📄 License

Apache License 2.0

## 👥 Author

[XiaoMo](https://www.moiu.cn) [Checkout](https://www.checkout.xin)

## 📞 Contact

- Email: moteam.org@gmail.com
- Project Homepage: https://github.com/MoTeam-cn/Telegram-Bot

## 📚 Documentation

- [中文文档](README.md)
- [更新日志](CHANGELOG.md)
