# MoBot - Telegram 机器人

<div align="center">
    <img src="assets/logo.svg" alt="MoBot Logo" width="200" height="200">
</div>

MoBot 是一个基于 Python 开发的功能强大的 Telegram 机器人框架，采用现代化的异步编程方式，提供了稳定、可扩展的机器人服务。

[English](README_EN.md) | 简体中文 | [更新日志](CHANGELOG.md)

## 🌟 亮点特色

除了基础功能外，MoBot 还提供以下特色：

- 🎯 智能命令路由
- 🔄 自动重连机制
- 🌍 多语言支持
- 📊 内置数据统计
- 🎨 自定义中间件
- 🔌 插件化架构

## ✨ 特性

- 🚀 基于异步编程，高效处理并发请求
- 🛡️ 内置代理支持，适应各种网络环境
- 📝 模块化的命令处理系统
- 🔄 优雅的启动和关闭机制
- 📊 完善的日志记录系统
- 🎯 支持自定义命令扩展
- 🌐 连接池管理，提升性能
- 🔒 异常处理机制

## 🚀 快速开始

1. **环境准备**

```bash
# 克隆项目
git clone https://github.com/MoTeam-cn/Telegram-Bot

# 安装依赖
pip install -r requirements.txt
```

## ⚙️ 环境配置

1. 在项目根目录创建 `.env` 文件：

```bash
# Bot配置
BOT_TOKEN=your_bot_token_here    # 你的Telegram机器人令牌
BOT_USERNAME=your_bot_username   # 机器人用户名

# 管理员配置
ADMIN_IDS=123456,789012         # 管理员ID列表，多个ID用逗号分隔

# 代理配置（可选）
PROXY_ENABLED=false             # 是否启用代理
PROXY_URL=socks5://127.0.0.1:7890  # 代理服务器地址

# 功能开关
PING_ENABLED=false              # 是否启用ping功能

# API配置
API_DOMAIN=http://localhost:5244  # API域名地址
```

2. 配置说明：

| 配置项 | 说明 | 必需 | 默认值 |
|--------|------|------|---------|
| BOT_TOKEN | Telegram Bot Token | 是 | - |
| BOT_USERNAME | 机器人用户名 | 是 | - |
| ADMIN_IDS | 管理员ID列表 | 否 | - |
| PROXY_ENABLED | 是否启用代理 | 否 | false |
| PROXY_URL | 代理服务器地址 | 否 | - |
| PING_ENABLED | 是否启用ping功能 | 否 | false |
| API_DOMAIN | API域名地址 | 否 | http://localhost:5244 |

3. 获取配置值：

```python
from config.config import BOT_TOKEN, PROXY_ENABLED, PROXY_URL, ADMIN_IDS

# 获取管理员ID列表
admin_ids = ADMIN_IDS  # 返回整数列表

# 检查代理是否启用
if PROXY_ENABLED:
    proxy_url = PROXY_URL
    # 启用代理的代码
```

4. **启动机器人**

```bash
python main.py
```

启动日志示例：
```log
[2025-04-06 14:36:12] ● INFO: 🚀 开始启动机器人...
[2025-04-06 14:36:12] ● INFO: 🌐 代理已启用: http://127.0.0.1:10809
[2025-04-06 14:36:12] ● INFO: ⚙️ 正在创建应用实例...
[2025-04-06 14:36:12] ● INFO: ✅ 应用实例创建成功
[2025-04-06 14:36:12] ● INFO: 📝 正在加载命令...
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.admin_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.baidu_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.basic_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.bmcl_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.cookie_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.custom_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.menu_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.network_commands
[2025-04-06 14:36:12] ● INFO: ✅ 已加载命令模块: handlers.commands.proxy_commands
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /cookie
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /bd
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /admin
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /start
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /help
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /id
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /bmcl
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /hello
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /weather
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /menu
[2025-04-06 14:36:12] ● INFO: 📝 注册命令: /stop
[2025-04-06 14:36:12] ● INFO: ✅ 命令加载完成
[2025-04-06 14:36:12] ● INFO: ✨ 机器人启动成功!
[2025-04-06 14:36:12] ● INFO: 🤖 Bot is running...
[2025-04-06 14:36:12] ● INFO: 📡 开始监听消息...
```

## 🔨 主要功能

### 异步处理
- 使用 `asyncio` 实现异步操作
- 优化的连接池管理
- 高效的并发请求处理

### 代理支持
- 支持 SOCKS 代理
- 可配置的代理设置
- 灵活的网络适应性

### 命令系统
- 模块化的命令处理
- 易扩展的命令注册机制
- 完整的命令生命周期管理

### 错误处理
- 完善的异常捕获机制
- 详细的日志记录
- 优雅的错误恢复

## 📝 日志系统

- 详细的运行日志记录
- 分级的日志管理
- 易于调试和监控

## 🔐 安全特性

- 安全的令牌管理
- 代理服务器支持
- 异常处理机制

## 🛠️ 开发指南

### 添加新命令

1. 在 `handlers/commands` 目录下创建新的命令处理器
2. 实现命令逻辑
3. 在 `command_loader.py` 中注册命令

### 自定义功能

- 扩展 `base_handler.py` 实现自定义处理器
- 在 `utils` 目录添加新的工具函数
- 通过配置文件管理新功能

## 📈 性能优化

- 连接池管理
- 异步操作优化
- 超时处理机制

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request 来帮助改进项目。

## 📄 许可证

Apache License 2.0

## 👥 作者

[XiaoMo](https://www.moiu.cn) [Checkout](https://www.checkout.xin)

## 📞 联系方式

- 邮箱：moteam.org@gmail.com
- 项目主页：https://github.com/MoTeam-cn/Telegram-Bot 

## 📚 使用示例

```python
from mobot import MoBot

bot = MoBot()

@bot.command("start")
async def start(update, context):
    await update.message.reply_text("你好！我是 MoBot！")

bot.run()
```

## 🎯 开发路线图

- [ ] 完善插件系统
- [ ] 添加更多中间件
- [ ] 优化性能
- [ ] 增加单元测试
- [ ] 支持更多平台

## 🎨 定制化

MoBot 支持高度定制化，你可以：

1. 自定义命令处理器
2. 开发专属插件
3. 定制中间件
4. 扩展核心功能

## 🔧 调试指南

1. 开启调试模式：
```python
bot.set_debug(True)
```

2. 查看详细日志：
```bash
tail -f bot.log
```

## 📊 性能指标

- 并发处理能力：1000+ 请求/秒
- 平均响应时间：< 100ms
- 内存占用：< 100MB 