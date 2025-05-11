from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import ContextTypes, CallbackQueryHandler
from utils.decorators import CommandRegistry
from utils.logger import setup_logger
from config.config import API_DOMAIN
import re
import aiohttp
import json

logger = setup_logger()

# 存储用户的分享信息
share_sessions = {}

async def get_share_info(surl: str, pwd: str = "", dir: str = "/"):
    """获取分享信息"""
    try:
        url = f"{API_DOMAIN}/api/v0/list"
        data = {
            "surl": surl,
            "pwd": pwd,
            "dir": dir
        }
        
        logger.info(f"请求API: {url} 数据: {data}")
        
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=data) as response:
                logger.info(f"API响应状态码: {response.status}")
                response_text = await response.text()
                logger.info(f"API响应内容: {response_text}")
                
                if response.status == 200:
                    try:
                        return await response.json()
                    except Exception as e:
                        logger.error(f"解析JSON响应失败: {str(e)}")
                        return None
                else:
                    logger.error(f"API请求失败: {response.status}, 响应: {response_text}")
                    return None
    except Exception as e:
        logger.error(f"获取分享信息时出错: {str(e)}")
        return None

def build_file_list_buttons(file_list, current_path="/", page=0):
    """构建文件列表按钮"""
    items_per_page = 10
    start = page * items_per_page
    end = start + items_per_page
    current_files = file_list[start:end]
    
    buttons = []
    for file in current_files:
        is_dir = file.get('isdir') == "1"
        icon = "📁" if is_dir else "📄"
        name = file.get('server_filename', '')
        path = f"{current_path.rstrip('/')}/{name}"
        
        # 为目录添加导航功能
        callback_data = json.dumps({
            "action": "enter_dir" if is_dir else "file_info",
            "path": path
        })
        
        buttons.append([InlineKeyboardButton(
            f"{icon} {name}",
            callback_data=callback_data
        )])
    
    # 添加导航按钮
    nav_buttons = []
    if current_path != "/":
        nav_buttons.append(InlineKeyboardButton(
            "⬆️ 返回上级",
            callback_data=json.dumps({
                "action": "enter_dir",
                "path": str(current_path).rsplit('/', 2)[0] or "/"
            })
        ))
    
    # 添加翻页按钮
    if page > 0:
        nav_buttons.append(InlineKeyboardButton(
            "⬅️ 上一页",
            callback_data=json.dumps({
                "action": "page",
                "page": page - 1
            })
        ))
    if end < len(file_list):
        nav_buttons.append(InlineKeyboardButton(
            "➡️ 下一页",
            callback_data=json.dumps({
                "action": "page",
                "page": page + 1
            })
        ))
    
    if nav_buttons:
        buttons.append(nav_buttons)
    
    return buttons

@CommandRegistry.register(command="bd", description="解析百度网盘链接")
async def baidu_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理 /bd 命令 - 解析百度网盘分享链接"""
    try:
        user = update.effective_user
        
        # 检查参数
        if not context.args:
            await update.message.reply_text(
                "❌ 请提供百度网盘分享链接\n"
                "格式: /bd https://pan.baidu.com/s/xxxxxx?pwd=yyyy\n"
                "或: /bd https://pan.baidu.com/s/xxxxxx yyyy"
            )
            return
        
        # 获取链接和可能的提取码
        share_url = context.args[0]
        pwd = context.args[1] if len(context.args) > 1 else ""
        
        # 验证链接格式并提取surl和pwd
        url_pattern = r'https?://pan\.baidu\.com/s/([a-zA-Z0-9_-]+)(?:\?pwd=([a-zA-Z0-9]+))?'
        match = re.match(url_pattern, share_url)
        
        if not match:
            await update.message.reply_text(
                "❌ 无效的百度网盘链接格式\n"
                "请使用以下格式：\n"
                "1. https://pan.baidu.com/s/xxxxxx?pwd=yyyy\n"
                "2. /bd https://pan.baidu.com/s/xxxxxx yyyy"
            )
            return
        
        # 提取surl和pwd
        surl = match.group(1)
        url_pwd = match.group(2) if match.group(2) else pwd
        
        logger.info(f"用户 {user.first_name} 请求解析链接，surl: {surl}, pwd: {url_pwd}")
        
        # 如果没有提取码，询问用户
        if not url_pwd:
            confirm_msg = await update.message.reply_text(
                "⚠️ 未检测到提取码，确认分享链接真的没有提取码吗？\n"
                "如果有提取码，请使用以下格式重新发送：\n"
                "1. /bd https://pan.baidu.com/s/xxxxxx?pwd=yyyy\n"
                "2. /bd https://pan.baidu.com/s/xxxxxx yyyy"
            )
            return
        
        # 发送等待消息
        message = await update.message.reply_text(
            "🔄 正在解析分享链接...\n"
            "请稍候"
        )
        
        # 获取分享信息
        result = await get_share_info(surl, url_pwd)
        
        if result is None:
            await message.edit_text("❌ 解析失败，API请求出错")
            return
            
        # 处理API响应
        if result.get('code') == 200:
            data = result.get('data', {})
            file_list = data.get('list', [])
            share_info = data.get('info', {})
            
            if not file_list:
                await message.edit_text("❌ 未找到文件信息")
                return
            
            # 保存会话信息
            session_data = {
                'surl': surl,
                'pwd': url_pwd,
                'share_info': share_info,
                'current_path': '/',
                'file_list': file_list
            }
            share_sessions[user.id] = session_data
            
            # 构建分享信息消息
            response = (
                f"🔗 分享信息\n"
                f"链接：https://pan.baidu.com/s/{surl}\n"
                f"提取码：{url_pwd}\n"
                f"分享ID：{share_info.get('shareid', '未知')}\n"
                f"分享者ID：{share_info.get('uk', '未知')}\n\n"
                f"📂 文件列表如下，点击查看详情："
            )
            
            # 构建按钮
            buttons = build_file_list_buttons(file_list)
            reply_markup = InlineKeyboardMarkup(buttons)
            
            await message.edit_text(
                response,
                reply_markup=reply_markup
            )
            logger.info(f"✅ 已发送解析结果给用户 {user.first_name}")
            
        else:
            error_msg = result.get('message', '未知错误')
            await message.edit_text(f"❌ 解析失败：{error_msg}")
        
    except Exception as e:
        error_msg = f"解析链接时出错: {str(e)}"
        logger.error(error_msg)
        await update.message.reply_text(f"❌ {error_msg}")

async def baidu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """处理百度网盘相关的回调查询"""
    try:
        query = update.callback_query
        user = query.from_user
        logger.info(f"收到回调查询 - 用户: {user.first_name}({user.id}), 数据: {query.data}")
        
        data = json.loads(query.data)
        action = data.get('action')
        
        # 获取用户会话
        session = share_sessions.get(user.id)
        if not session:
            logger.warning(f"用户 {user.first_name} 的会话已过期")
            await query.answer("会话已过期，请重新发送分享链接")
            return
        
        if action == "enter_dir":
            path = data.get('path', '/')
            logger.info(f"用户 {user.first_name} 尝试进入目录: {path}")
            
            # 获取目录内容
            result = await get_share_info(session['surl'], session['pwd'], path)
            logger.info(f"目录内容响应: {result}")
            
            if result and result.get('code') == 200:
                file_list = result.get('data', {}).get('list', [])
                session['current_path'] = path
                session['file_list'] = file_list
                logger.info(f"成功获取目录 {path} 的内容，文件数: {len(file_list)}")
                
                # 更新消息内容和按钮
                response = (
                    f"🔗 分享信息\n"
                    f"链接：https://pan.baidu.com/s/{session['surl']}\n"
                    f"提取码：{session['pwd']}\n"
                    f"当前路径：{path}\n\n"
                    f"📂 文件列表如下，点击查看详情："
                )
                
                buttons = build_file_list_buttons(file_list, path)
                await query.message.edit_text(
                    response,
                    reply_markup=InlineKeyboardMarkup(buttons)
                )
                logger.info(f"已更新消息内容和按钮")
            else:
                logger.error(f"获取目录 {path} 内容失败")
                await query.answer("获取目录内容失败")
        
        elif action == "file_info":
            path = data.get('path')
            logger.info(f"用户 {user.first_name} 查看文件信息: {path}")
            
            # 显示文件详细信息
            for file in session['file_list']:
                if file.get('server_filename') == path.split('/')[-1]:
                    size = int(file.get('size', 0))
                    if size < 1024:
                        size_str = f"{size}B"
                    elif size < 1024 * 1024:
                        size_str = f"{size/1024:.2f}KB"
                    elif size < 1024 * 1024 * 1024:
                        size_str = f"{size/1024/1024:.2f}MB"
                    else:
                        size_str = f"{size/1024/1024/1024:.2f}GB"
                    
                    info = (
                        f"📄 文件信息\n"
                        f"名称：{file.get('server_filename')}\n"
                        f"大小：{size_str}\n"
                        f"路径：{path}\n"
                        f"MD5：{file.get('md5', '未知')}"
                    )
                    await query.answer(info, show_alert=True)
                    logger.info(f"已显示文件 {path} 的详细信息")
                    break
        
        elif action == "page":
            page = data.get('page', 0)
            logger.info(f"用户 {user.first_name} 翻页到: {page}")
            
            buttons = build_file_list_buttons(
                session['file_list'],
                session['current_path'],
                page
            )
            await query.message.edit_reply_markup(
                reply_markup=InlineKeyboardMarkup(buttons)
            )
            logger.info(f"已更新翻页按钮")
        
    except Exception as e:
        logger.error(f"处理回调时出错: {str(e)}")
        await query.answer("操作失败，请重试")

# 注册回调处理器
def setup_baidu_handlers(application):
    """设置百度网盘相关的处理器"""
    application.add_handler(CallbackQueryHandler(
        baidu_callback,
        pattern=r'^{"action":"(enter_dir|file_info|page)"'
    )) 