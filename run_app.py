#!/usr/bin/env python3
"""
Running Man - 任务排班可视化系统 v2.32.3
跨平台启动入口 (Linux / macOS / Windows)
PyInstaller 打包时以此文件为入口点。
"""

import sys
import os
import time
import socket
import subprocess
import webbrowser
import threading


def kill_old_instance(port=5000):
    """关闭已占用端口的旧进程，释放端口"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(('127.0.0.1', port))
    sock.close()
    if result != 0:
        return  # 端口空闲

    try:
        if sys.platform == 'win32':
            output = subprocess.check_output(
                f'netstat -ano | findstr :{port}', shell=True, text=True
            )
            for line in output.strip().split('\n'):
                parts = line.split()
                if len(parts) >= 5 and parts[1].endswith(f':{port}'):
                    subprocess.run(
                        f'taskkill /F /PID {parts[-1]}', shell=True,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
                    )
        elif sys.platform == 'darwin':
            subprocess.run(
                f'lsof -ti:{port} | xargs kill -9', shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        else:  # Linux
            subprocess.run(
                f'fuser -k {port}/tcp', shell=True,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
    except Exception:
        pass
    time.sleep(0.5)


# 修复：Finder/文件管理器双击启动时 stdout 可能为 None
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')


if __name__ == '__main__':
    kill_old_instance(5000)

    # 导入 Flask 应用（触发所有初始化：init_db, 蓝图注册, 自动存档线程等）
    from app import app

    # 自动打开浏览器
    def _open_browser():
        time.sleep(1.5)
        webbrowser.open('http://127.0.0.1:5000')

    threading.Thread(target=_open_browser, daemon=True).start()

    print("=" * 60)
    print("  Running Man - 任务排班可视化系统 v2.32.3")
    print("  访问地址: http://127.0.0.1:5000")
    print("  按 Ctrl+C 退出")
    print("=" * 60)

    app.run(host='127.0.0.1', port=5000, debug=False, threaded=True)
