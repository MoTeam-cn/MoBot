from telegram.ext import Application
from config.config import BOT_TOKEN, PROXY_URL, PROXY_ENABLED
import asyncio
from utils.logger import setup_logger
from handlers.command_loader import setup_commands
import platform
from httpx import Proxy, Limits
import signal
from github import Github
from packaging import version

# 当前版本号
CURRENT_VERSION = "v1.0.1"
GITHUB_REPO = "MoTeam-cn/Telegram-Bot"  # 替换为实际的GitHub仓库名

logger = setup_logger()

class TelegramBot:
    def __init__(self):
        self.application = None
        self._stop_event = None
    
    async def check_version(self):
        """检查GitHub上的最新版本"""
        try:
            logger.info("🔍 正在检查最新版本...")
            g = Github()
            repo = g.get_repo(GITHUB_REPO)
            latest_release = repo.get_latest_release()
            latest_version = latest_release.tag_name
            
            if version.parse(latest_version.lstrip('v')) > version.parse(CURRENT_VERSION.lstrip('v')):
                logger.info(f"📢 发现新版本: {latest_version} (当前版本: {CURRENT_VERSION})")
                logger.info(f"📝 更新说明: {latest_release.body}")
                logger.info(f"🔗 下载地址: {latest_release.html_url}")
            else:
                logger.info(f"✅ 当前已是最新版本: {CURRENT_VERSION}")
        except Exception as e:
            logger.warning(f"⚠️ 版本检查失败: {str(e)}")
    
    def _signal_handler(self):
        """处理停止信号"""
        if self._stop_event and not self._stop_event.done():
            logger.info("收到停止信号...")
            self._stop_event.set_result(None)

    async def start(self):
        """启动机器人"""
        try:
            logger.info("🚀 开始启动机器人...")
            
            # 检查版本
            await self.check_version()
            
            # 代理状态日志
            if PROXY_ENABLED:
                logger.info(f"🌐 代理已启用: {PROXY_URL}")
            else:
                logger.info("🌐 代理未启用")
            
            # 创建应用实例
            logger.info("⚙️ 正在创建应用实例...")
            builder = (
                Application.builder()
                .token(BOT_TOKEN)
                .connection_pool_size(8)  # 增加连接池大小
                .connect_timeout(30.0)
                .read_timeout(30.0)
                .write_timeout(30.0)
                .pool_timeout(3.0)  # 减小池超时时间
                .get_updates_connection_pool_size(8)  # 为updates设置单独的连接池
                .get_updates_read_timeout(30.0)
                .get_updates_pool_timeout(3.0)
            )
            
            # 配置代理
            if PROXY_ENABLED and PROXY_URL:
                proxy = Proxy(
                    url=PROXY_URL,
                    headers={"User-Agent": "python-telegram-bot"}
                )
                builder = (
                    builder
                    .proxy(proxy)
                    .get_updates_proxy(proxy)
                )
            
            # 构建应用实例
            self.application = builder.build()
            logger.info("✅ 应用实例创建成功")
            
            # 创建停止事件并绑定到应用实例
            self._stop_event = asyncio.Event()
            self.application._stop_event = self._stop_event
            
            # 加载命令
            logger.info("📝 正在加载命令...")
            await setup_commands(self.application)
            logger.info("✅ 命令加载完成")
            
            logger.info("✨ 机器人启动成功!")
            logger.info("🤖 Bot is running...")
            
            # 开始轮询
            logger.info("📡 开始监听消息...")
            await self.application.initialize()
            await self.application.start()
            await self.application.updater.start_polling(
                allowed_updates=["message", "callback_query"],
                drop_pending_updates=True,
                read_timeout=30,
                pool_timeout=3
            )
            
            # 等待停止信号
            await self._stop_event.wait()
                
        except Exception as e:
            logger.error(f"❌ Bot启动错误: {str(e)}")
            raise
        finally:
            await self.stop()

    async def stop(self):
        """停止机器人"""
        if self.application:
            logger.info("正在关闭机器人...")
            try:
                # 先停止轮询，不等待清理操作完成
                if self.application.updater and self.application.updater.running:
                    try:
                        await asyncio.wait_for(
                            self.application.updater.stop(),
                            timeout=0.5
                        )
                    except asyncio.TimeoutError:
                        logger.warning("⚠️ 轮询停止超时")
                    except Exception as e:
                        logger.warning(f"停止轮询时出错: {str(e)}")
                
                # 停止应用
                if self.application.running:
                    try:
                        await asyncio.wait_for(
                            self.application.stop(),
                            timeout=0.5
                        )
                    except asyncio.TimeoutError:
                        logger.warning("⚠️ 应用停止超时")
                    except Exception as e:
                        logger.warning(f"停止应用时出错: {str(e)}")
                
                # 关闭应用
                try:
                    await asyncio.wait_for(
                        self.application.shutdown(),
                        timeout=0.5
                    )
                except (asyncio.TimeoutError, Exception) as e:
                    logger.warning(f"关闭应用时出错: {str(e)}")
                
                logger.info("👋 机器人已关闭")
                
            except Exception as e:
                logger.error(f"关闭过程出错: {str(e)}")
            finally:
                # 确保事件被设置
                if self._stop_event and not self._stop_event.is_set():
                    self._stop_event.set()

def run():
    """运行入口"""
    if platform.system() == 'Windows':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    
    bot = TelegramBot()
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    def signal_handler(signum, frame):
        """信号处理函数"""
        logger.info("收到停止信号，正在关闭...")
        if bot._stop_event:
            loop.call_soon_threadsafe(bot._stop_event.set)
    
    try:
        # 注册信号处理
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
        
        # 运行机器人
        loop.run_until_complete(bot.start())
        
    except KeyboardInterrupt:
        pass  # 已经在signal_handler中处理
    except Exception as e:
        logger.error(f"❌ 程序异常退出: {str(e)}")
    finally:
        try:
            # 确保所有任务都被取消
            pending = asyncio.all_tasks(loop)
            for task in pending:
                task.cancel()
            
            # 等待所有任务完成
            if pending:
                loop.run_until_complete(
                    asyncio.wait(pending, timeout=1.0)
                )
        except Exception as e:
            logger.error(f"清理任务时出错: {str(e)}")
        finally:
            loop.close()

if __name__ == '__main__':
    run() 