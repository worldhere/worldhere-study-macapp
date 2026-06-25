#!/bin/bash
set -e

echo "========================================"
echo "  Running Man macOS 一键打包脚本"
echo "========================================"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "[1/4] 检查 Python3..."
if ! command -v python3 &> /dev/null; then
    echo "❌ 未找到 python3，请先安装 Python3 (https://python.org)"
    exit 1
fi
python3 --version

echo ""
echo "[2/4] 安装/升级依赖..."
python3 -m pip install --upgrade pip
python3 -m pip install pyinstaller flask werkzeug jinja2 requests openpyxl pillow

echo ""
echo "[3/4] 开始打包 .app ..."
python3 -m PyInstaller running_man_macos.spec --noconfirm --clean

echo ""
echo "[4/4] 检查打包结果..."
APP_PATH="$SCRIPT_DIR/dist/RunningMan.app"
if [ -d "$APP_PATH" ]; then
    echo "✅ 打包成功！"
    echo ""
    echo "📦 应用位置:"
    echo "   $APP_PATH"
    echo ""
    echo "🚀 运行方式:"
    echo "   直接双击 RunningMan.app，或在终端执行:"
    echo "   open '$APP_PATH'"
    echo ""
    echo "⚠️  首次运行可能提示'无法打开'，去 系统设置 > 隐私与安全性 里允许即可"
else
    echo "❌ 打包失败，请查看上方错误信息"
    exit 1
fi
