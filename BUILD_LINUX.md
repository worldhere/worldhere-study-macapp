# Flask 项目打包为 Linux 单文件可执行程序 — v2.32.3

## 适用场景

- Python Flask 项目（Running Man 任务排班可视化系统）
- 目标：打包成一个独立文件，双击或命令行直接运行，无需安装 Python
- 目标平台：Linux x86_64
- 构建环境：RHEL 9.5 / Ubuntu 22.04+ / Debian 12+ / Fedora 40+

## 前置条件

- Python 3.9+ 已安装
- 项目代码齐全（模板、静态文件、所有 .py 模块）

---

## 项目文件说明（2.32.3 打包相关）

| 文件 | 用途 |
|------|------|
| `run_app.py` | 打包入口（跨平台：端口自动释放、自动打开浏览器） |
| `running_man_linux.spec` | PyInstaller Linux 打包配置 |
| `install_and_build.sh` | 一键安装依赖 + 构建脚本 |
| `requirements.txt` | Python 依赖清单 |
| `BUILD_LINUX.md` | 本文档 |

---

## 步骤总览

```
1. 准备依赖（联网或离线）
2. 确认 spec 文件和 run_app.py
3. 运行构建脚本（或手动执行 PyInstaller）
4. 输出 dist/RunningMan（单文件）
```

---

## 第一步：安装 Python 依赖

### 方式 A：联网安装（推荐）

```bash
python3 -m pip install pyinstaller flask requests openpyxl Pillow
```

或直接使用一键脚本：
```bash
chmod +x install_and_build.sh
./install_and_build.sh
```

### 方式 B：离线安装（虚拟机没网时用）

**在宿主机（Windows）下载：**

```cmd
python -m pip download ^
  --platform manylinux2014_x86_64 ^
  --python-version 39 ^
  --only-binary=:all: ^
  -d offline_pkg ^
  pyinstaller flask requests openpyxl Pillow
```

如果构建时提示缺包，补下：
```cmd
python -m pip download ^
  --platform manylinux2014_x86_64 ^
  --python-version 39 ^
  --only-binary=:all: ^
  -d offline_pkg ^
  importlib-metadata zipp typing-extensions
```

**拷贝到 Linux 虚拟机后安装：**

```bash
python3 -m pip install --no-index --find-links offline_pkg pyinstaller flask requests openpyxl Pillow
```

或使用一键脚本：
```bash
./install_and_build.sh offline
```

### 踩坑记录

| 问题 | 原因 | 解决 |
|------|------|------|
| `pip3: 未找到命令` | RHEL 全新安装不带 pip | `python3 -m ensurepip --upgrade` |
| `No module named PyInstaller` | pyinstaller 没装上 | 先 `python3 -m pip install pyinstaller` |
| `未知的名称或服务` | DNS 故障 / 没网 | 走离线安装（方式 B） |
| 下载的 .whl 不兼容 | 宿主机 Python 版本和虚拟机不一致 | 必须加 `--python-version 39` 和 `--platform manylinux2014_x86_64` |
| `No matching distribution for importlib-metadata` | PyInstaller 对 Python 3.9 的依赖没下全 | 额外下载 importlib-metadata、zipp、typing-extensions |
| dnf 报错无启用仓库 | RHEL 未注册订阅 | 用 `ensurepip` 绕过，不走 dnf |

---

## 第二步：PyInstaller spec 文件

文件名：`running_man_linux.spec`（已生成，直接使用）

### 关键参数说明

| 参数 | 说明 |
|------|------|
| `EXE(..., a.binaries, a.datas)` | Linux 直接把 binaries/datas 传入 EXE，全部嵌入单个文件 |
| `noarchive=False` | 数据文件嵌入 CArchive，必须设为 False |
| `console=True` | 运行时有终端窗口，方便看日志 |
| `hiddenimports` | **最容易出问题的点**。新增模块没加到这里 = 打包后运行报 ImportError |
| `excludes` | 排除不需要的库（pytest, tkinter, matplotlib...），减小体积 |

---

## 第三步：启动入口 run_app.py

`run_app.py` 是 PyInstaller 的入口文件，它做了以下事情：

1. **端口自动释放** — 启动前杀掉占用端口 5000 的旧进程
2. **None stdout 防护** — Finder/文件管理器双击启动时 stdout 可能为 None
3. **自动打开浏览器** — 启动后 1.5 秒自动打开 `http://127.0.0.1:5000`
4. **跨平台兼容** — Windows / macOS / Linux 分别处理旧进程关闭逻辑

### 踩坑记录

| 问题 | 解决 |
|------|------|
| 双击打开后看不到控制台 | Linux 用 `console=True` + 创建 `.desktop` 文件设置 `Terminal=true`，或直接从终端运行 |
| 重复启动端口冲突 | `run_app.py` 内置 `kill_old_instance()` 自动杀旧进程 |
| macOS Finder 启动 stdout=None 崩溃 | `run_app.py` 开头做了 `sys.stdout is None` 检测 |

---

## 第四步：构建

### 一键构建（推荐）

```bash
chmod +x install_and_build.sh
./install_and_build.sh          # 联网
./install_and_build.sh offline  # 离线
```

### 手动构建

```bash
python3 -m PyInstaller running_man_linux.spec --noconfirm
```

- `--noconfirm`：自动覆盖已有输出，不弹确认提示
- 输出路径：`dist/RunningMan`
- 构建时间：约 30-60 秒
- 输出大小：约 20-30 MB

---

## 第五步：运行

```bash
chmod +x dist/RunningMan
./dist/RunningMan
```

启动后在浏览器访问 `http://127.0.0.1:5000`（会自动打开浏览器）。

### 创建桌面快捷方式（双击启动 + 显示控制台）

```ini
# RunningMan.desktop
[Desktop Entry]
Name=Running Man
Comment=任务调度系统 v2.32.3
Exec=/实际路径/RunningMan
Terminal=true
Type=Application
Categories=Office;
```

`Terminal=true` 关键位——设为 true 双击时会弹出终端窗口，能看到日志。

---

## 数据存储

应用数据独立于可执行文件，存储在：

```
~/.task_schedule_app/
├── schedule_data.sqlite3    # 主数据库
├── saves/                   # 自动存档
├── logs/app.log             # 应用日志
└── db_config.json           # 路径配置
```

删除可执行文件不会丢失数据。

---

## 常见故障

| 现象 | 原因 | 解决 |
|------|------|------|
| 打包后报 `ModuleNotFoundError: xxx` | hiddenimports 漏了模块 | 在 `running_man_linux.spec` 中补上，重新构建 |
| 打包后模板/静态文件 404 | datas 路径配置错误 | 检查 spec 中 datas 的路径 |
| dist 目录为空 | EXE 输出被 COLLECT 覆盖（macOS 习惯） | Linux 不用 COLLECT，binaries/datas 直接传 EXE |
| 文件双击没反应 | 没执行权限 | `chmod +x dist/RunningMan` |
| 复制到其他 Linux 报 libc 版本错 | glibc 版本不兼容 | 在低版本 glibc 的系统上构建（如 CentOS 7） |
| pip 下载的包是 cp314 不是 cp39 | 宿主机 Python 版本自动匹配 | 加 `--python-version 39` 强制指定 |

---

## 和 Windows / macOS 构建的关键区别

| | Linux | Windows | macOS |
|------|-------|---------|-------|
| PyInstaller 输出 | EXE（单文件 ELF） | EXE（单文件 .exe） | BUNDLE（.app）或单文件 |
| COLLECT 步骤 | 不需要 | 不需要 | 文件夹模式需要 |
| 跨平台交叉编译 | ❌ 不支持 | ❌ 不支持 | ❌ 不支持 |
| console 参数 | True = 有终端 | True/False = 显示/隐藏CMD | True = 有终端 |
| 图标 | .desktop 文件 | .ico 嵌入 | .icns 嵌入 Info.plist |
