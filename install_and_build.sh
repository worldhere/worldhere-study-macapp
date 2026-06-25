#!/bin/sh
# ============================================================
# Running Man v2.32.3 - Linux 一键安装 & 构建脚本
# 用法:
#   chmod +x install_and_build.sh
#   ./install_and_build.sh          # 联网安装
#   ./install_and_build.sh offline  # 离线安装（使用 offline_pkg/）
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "============================================"
echo "  Running Man v2.32.3 - Linux 构建脚本"
echo "============================================"
echo ""

# ---- 确保 pip 可用 ----
if ! python3 -m pip --version >/dev/null 2>&1; then
    echo "[1/4] 安装 pip..."
    python3 -m ensurepip --upgrade
fi

# ---- 安装依赖 ----
if [ "$1" = "offline" ]; then
    echo "[2/4] 离线安装 Python 依赖..."
    if [ -d "offline_pkg" ]; then
        python3 -m pip install --no-index --find-links offline_pkg \
            pyinstaller flask requests openpyxl Pillow \
            importlib-metadata zipp typing-extensions
    else
        echo "错误: offline_pkg/ 目录不存在！请在宿主机先下载依赖。"
        echo ""
        echo "在 Windows 宿主机执行："
        echo "  python -m pip download --platform manylinux2014_x86_64 --python-version 39 --only-binary=:all: -d offline_pkg pyinstaller flask requests openpyxl Pillow"
        exit 1
    fi
else
    echo "[2/4] 联网安装 Python 依赖..."
    python3 -m pip install pyinstaller flask requests openpyxl Pillow
fi

# ---- 检查 spec 文件 ----
if [ ! -f "running_man_linux.spec" ]; then
    echo "错误: 找不到 running_man_linux.spec"
    exit 1
fi

# ---- 构建 ----
echo "[3/4] 开始 PyInstaller 打包..."
python3 -m PyInstaller running_man_linux.spec --noconfirm

# ---- 完成 ----
echo "[4/4] 构建完成！"
echo ""
echo "输出文件: $SCRIPT_DIR/dist/RunningMan"
echo "文件大小: $(du -h "$SCRIPT_DIR/dist/RunningMan" 2>/dev/null | cut -f1 || echo '未知')"
echo ""
echo "运行方式:"
echo "  chmod +x dist/RunningMan"
echo "  ./dist/RunningMan"
echo ""
echo "浏览器访问: http://127.0.0.1:5000"
