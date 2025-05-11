from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CallbackQueryHandler
from utils.decorators import CommandRegistry
from utils.logger import setup_logger
import aiohttp
import json
import time
import asyncio
from config.config import ADMIN_IDS

logger = setup_logger()

# Cookie缓存
cookie_cache = {}

async def get_qrcode():
    """获取百度登录二维码"""
    url = f"https://passport.baidu.com/v2/api/getqrcode?lp=pc&qrloginfrom=pc&apiver=v3&tt={int(time.time()*1000)}&tpl=netdisk"
    
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status == 200:
                data = await response.json()
                if 'imgurl' in data and 'sign' in data:
                    imgurl = data['imgurl']
                    if not imgurl.startswith('https://'):
                        imgurl = 'https://' + imgurl
                    return {
                        'qrcode_url': imgurl,
                        'sign': data['sign']
                    }
    return None

async def get_bduss(sign: str):
    """获取BDUSS"""
    url = f"https://passport.baidu.com/channel/unicast?channel_id={sign}&gid=9CBA674-2B66-430E-B271-791EA309B0A4&tpl=netdisk&_sdkFrom=1&apiver=v3&tt={int(time.time()*1000)}"
    
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as response:
            if response.status == 200:
                data = await response.json()
                if 'channel_v' in data:
                    try:
                        channel_v = json.loads(data['channel_v'])
                        if 'v' in channel_v:
                            return channel_v['v']
                    except json.JSONDecodeError:
                        pass
    return None

async def get_cookie_by_bduss(bduss: str):
    """通过BDUSS获取完整Cookie"""
    cookies = {}  # 使用字典存储cookie，避免重复
    
    async with aiohttp.ClientSession() as session:
        # 第一步：通过BDUSS获取初始Cookie
        url = f"https://passport.baidu.com/v3/login/main/qrbdusslogin?v={int(time.time()*1000)}&bduss={bduss}&loginVersion=v5&qrcode=1&tpl=netdisk&apiver=v3&tt={int(time.time()*1000)}"
        headers = {"BDUSS": bduss}
        
        try:
            async with session.get(url, headers=headers, allow_redirects=False) as response:
                # 收集第一次请求的Cookie
                for cookie in response.cookies.values():
                    cookies[cookie.key] = cookie.value
                
                # 如果有重定向，跟随重定向
                while response.status in (301, 302, 303, 307, 308):
                    redirect_url = response.headers.get('Location')
                    if not redirect_url:
                        break
                        
                    # 确保URL是完整的
                    if not redirect_url.startswith('http'):
                        redirect_url = f"https://passport.baidu.com{redirect_url}"
                    
                    # 构建新的Cookie头
                    cookie_header = '; '.join([f"{k}={v}" for k, v in cookies.items()])
                    headers = {"Cookie": cookie_header}
                    
                    # 跟随重定向
                    async with session.get(redirect_url, headers=headers, allow_redirects=False) as redirect_response:
                        # 收集重定向过程中的Cookie
                        for cookie in redirect_response.cookies.values():
                            cookies[cookie.key] = cookie.value
                        response = redirect_response
            
            # 第二步：访问网盘主页获取额外Cookie
            main_url = "https://pan.baidu.com/disk/main"
            cookie_header = '; '.join([f"{k}={v}" for k, v in cookies.items()])
            headers = {"Cookie": cookie_header}
            
            async with session.get(main_url, headers=headers, allow_redirects=True) as response:
                # 收集网盘页面的Cookie
                for cookie in response.cookies.values():
                    cookies[cookie.key] = cookie.value
            
            # 构建最终的Cookie字符串
            cookie_str = '; '.join([f"{k}={v}" for k, v in cookies.items()])
            
            # 验证是否包含必要的Cookie
            required_cookies = ['BDUSS', 'STOKEN']
            if all(cookie in cookie_str for cookie in required_cookies):
                logger.info("成功获取完整Cookie，包含BDUSS和STOKEN")
                return cookie_str
            else:
                logger.error("获取的Cookie不完整，缺少必要字段")
                return None
                
        except Exception as e:
            logger.error(f"获取Cookie过程出错: {str(e)}")
            return None

@CommandRegistry.register(command="cookie", description="获取百度网盘Cookie", is_admin=True)
async def cookie_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /cookie 命令"""
    try:
        user = update.effective_user
        logger.info(f"用户 {user.first_name} 请求获取Cookie")
        
        # 获取二维码
        qr_data = await get_qrcode()
        if not qr_data:
            await update.message.reply_text("❌ 获取二维码失败，请重试")
            return
        
        # 创建二维码消息
        keyboard = [[
            InlineKeyboardButton("🔄 刷新二维码", callback_data=f"refresh_qr"),
            InlineKeyboardButton("✅ 检查状态", callback_data=f"check_status:{qr_data['sign']}")
        ]]
        reply_markup = InlineKeyboardMarkup(keyboard)
        
        # 发送二维码和说明
        message = await update.message.reply_text(
            "🔄 正在获取二维码...\n"
            "请使用百度网盘APP扫描二维码登录\n"
            "登录后点击「检查状态」按钮获取Cookie",
            reply_markup=reply_markup
        )
        
        # 发送二维码图片
        await message.edit_text(
            f"请使用百度网盘APP扫描二维码登录\n"
            f"二维码链接：{qr_data['qrcode_url']}\n\n"
            f"登录后点击「检查状态」按钮获取Cookie",
            reply_markup=reply_markup
        )
        
    except Exception as e:
        error_msg = f"获取Cookie时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}")

async def cookie_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理Cookie相关的回调查询"""
    try:
        query = update.callback_query
        user = query.from_user
        
        # 检查管理员权限
        if user.id not in ADMIN_IDS:
            await query.answer("❌ 该操作仅管理员可用")
            return
        
        if query.data == "refresh_qr":
            # 刷新二维码
            qr_data = await get_qrcode()
            if not qr_data:
                await query.answer("❌ 获取二维码失败")
                return
                
            keyboard = [[
                InlineKeyboardButton("🔄 刷新二维码", callback_data=f"refresh_qr"),
                InlineKeyboardButton("✅ 检查状态", callback_data=f"check_status:{qr_data['sign']}")
            ]]
            reply_markup = InlineKeyboardMarkup(keyboard)
            
            await query.message.edit_text(
                f"请使用百度网盘APP扫描二维码登录\n"
                f"二维码链接：{qr_data['qrcode_url']}\n\n"
                f"登录后点击「检查状态」按钮获取Cookie",
                reply_markup=reply_markup
            )
            
        elif query.data.startswith("check_status:"):
            # 检查登录状态
            sign = query.data.split(":")[1]
            await query.answer("🔄 正在检查登录状态...")
            
            # 获取BDUSS
            bduss = await get_bduss(sign)
            if not bduss:
                await query.message.edit_text(
                    "❌ 未检测到登录，请重新扫码\n"
                    "点击下方按钮刷新二维码",
                    reply_markup=InlineKeyboardMarkup([[
                        InlineKeyboardButton("🔄 刷新二维码", callback_data="refresh_qr")
                    ]])
                )
                return
            
            # 获取完整Cookie
            cookie = await get_cookie_by_bduss(bduss)
            if not cookie:
                await query.message.edit_text("❌ 获取Cookie失败，请重试")
                return
            
            # 发送Cookie
            await query.message.edit_text(
                "✅ 获取Cookie成功！\n\n"
                f"<code>{cookie}</code>",
                parse_mode='HTML'
            )
            
        await query.answer()
        
    except Exception as e:
        logger.error(f"处理Cookie回调时出错: {str(e)}")
        await query.answer("❌ 操作失败，请重试")

# 注册回调处理器
def setup_cookie_handlers(application):
    """设置Cookie相关的处理器"""
    application.add_handler(CallbackQueryHandler(cookie_callback, pattern="^(refresh_qr|check_status:)")) 