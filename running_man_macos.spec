# -*- mode: python ; coding: utf-8 -*-
"""
Running Man v2.32.3 - macOS PyInstaller 打包配置
生成 .app 应用程序包
用法: python3 -m PyInstaller running_man_macos.spec --noconfirm
"""

import os

project_root = os.path.dirname(os.path.abspath(SPEC))

# ===== 数据文件（模板 + 静态资源） =====
datas = [
    (os.path.join(project_root, 'templates'), 'templates'),
    (os.path.join(project_root, 'static'), 'static'),
]
datas = [(src, dst) for src, dst in datas if os.path.exists(src)]

# ===== 隐式导入 =====
hiddenimports = [
    # Flask 生态
    'flask', 'flask.json', 'werkzeug', 'werkzeug.routing',
    'werkzeug.serving', 'werkzeug.security', 'jinja2', 'jinja2.ext',
    'sqlite3', 'requests',
    # 容易被漏掉的第三方库
    'openpyxl', 'PIL', 'PIL.Image', 'PIL.ImageDraw', 'PIL.ImageFont',
    # 标准库
    'webbrowser', 'threading', 'signal', 'json', 'datetime',
    're', 'glob', 'argparse', 'contextlib', 'urllib.request',
    'concurrent.futures', 'concurrent.futures.thread',
    # ---- 项目根模块 ----
    'app', 'db', 'utils', 'save_utils', 'import_utils',
    'undo_utils', 'auto_assign', 'feishu_token', 'feishu_sync',
    # ---- routes 包 ----
    'routes', 'routes.views', 'routes.machines', 'routes.tasks',
    'routes.schedules', 'routes.schedule_ops', 'routes.schedule_cut',
    'routes.settings', 'routes.saves', 'routes.shift_posts',
    'routes.feishu', 'routes.undo', 'routes.summary',
    # ---- models 包 ----
    'models', 'models.summary', 'models.recycle',
    'models.queries', 'models.packages', 'models.config',
    # ---- feishu 包 ----
    'feishu', 'feishu.common', 'feishu.table_utils',
    'feishu.config_table', 'feishu.schedule_sync', 'feishu.status',
    'feishu.lifecycle', 'feishu.init_engine', 'feishu.sync_loop',
    'feishu.groups',
    # ---- feishu.events 子包 ----
    'feishu.events', 'feishu.events.cards', 'feishu.events.dispatch',
    'feishu.events.feishu_source', 'feishu.events.local_source',
    'feishu.events.shared',
]

a = Analysis(
    ['run_app.py'],
    pathex=[project_root],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=['pytest', '_pytest', 'tests', 'tkinter', 'matplotlib',
              'numpy', 'pandas', 'IPython', 'notebook'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='RunningMan',
    debug=False,
    strip=False,
    upx=True,
    console=True,           # 保留终端窗口（Flask 服务需要）
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# ===== macOS .app Bundle =====
app = BUNDLE(
    exe,
    name='RunningMan.app',
    icon=None,
    bundle_identifier='com.runningman.app',
    info_plist={
        'CFBundleName': 'RunningMan',
        'CFBundleDisplayName': '运行超人',
        'CFBundleShortVersionString': '2.32.3',
        'CFBundleVersion': '2.32.3',
        'CFBundleExecutable': 'RunningMan',
        'CFBundlePackageType': 'APPL',
        'NSHighResolutionCapable': True,
        'LSMinimumSystemVersion': '10.13',
    },
)
