# 飞书应用凭证可配置化

**日期**: 2026-06-18  
**状态**: 已确认

## 背景

飞书账号和应用被注销，`feishu_token.py` 中硬编码的 `APP_ID` / `APP_SECRET` 和 `feishu/common.py` 中的 `APP_TOKEN` 全部失效。需要将这三个编译时常量迁移为运行时可配置项，存储在 SQLite `config` 表中。

## 目标

- 在飞书同步设置面板新增「应用凭证」模块
- 三个字段存入 `config` 表，随存档一起保存和恢复
- 换凭证后无需改代码、无需重启，填好保存即可恢复全部飞书功能

## 设计

### 存储

在 `config` 表中新增三条记录：

| category | key | value |
|---|---|---|
| `feishu` | `app_id` | 飞书应用 App ID |
| `feishu` | `app_secret` | 飞书应用 App Secret（明文） |
| `feishu` | `app_token` | 多维表格 Base ID |

### 改造点

1. **`feishu_token.py`** — `get_token()` / `refresh_token()` 不再读模块常量，改为从 `config` 表动态读取 `app_id` / `app_secret`
2. **`feishu/common.py`** — 去掉 `APP_TOKEN` 模块常量，每次 API 请求时从 `config` 表读取 `app_token`；BASE_URL 也可选配置
3. **`feishu/__init__.py`** — 不再导出 `APP_TOKEN` 常量
4. **`routes/feishu.py`** — 新增 `GET/POST /api/feishu/app-info` 端点
5. **`static/settings.js`** — 凭证表单的加载、保存、验证逻辑
6. **`templates/panels/settings.html`** — 飞书同步子页面底部新增应用凭证 box

### UI 布局

```
飞书同步子页面 (subpage 7)
├── 飞书数据同步 (开关 + 仪表盘)    ← 现有
├── 推送设置 (群聊 + 事件开关)      ← 现有
└── 应用凭证 (App ID/Secret/Token)  ← 新增，放最下面
```

### 凭证验证状态

| 状态 | 条件 | UI | 行为 |
|---|---|---|---|
| 有效 | token 获取成功 | 绿色对勾 | 全功能 |
| 未配置 | 字段为空 | 灰色提示 | 同步开关不可开启 |
| 无效 | 401/403 | 黄色警告 | 停止同步 |
| 网络错误 | 超时/连接失败 | 红色错误 | 降级重试 |

### 换 APP_TOKEN 联动

检测到 APP_TOKEN 变更时，提示旧映射失效，需重新执行增量初始化。

## 文件清单

| 文件 | 改动 | 说明 |
|---|---|---|
| `feishu_token.py` | 重构 | 常量 → config 表动态读取 |
| `feishu/common.py` | 重构 | APP_TOKEN/BASE_URL → config 表 |
| `feishu/__init__.py` | 微调 | 不再导出 APP_TOKEN |
| `routes/feishu.py` | 新增端点 | GET/POST /api/feishu/app-info |
| `static/settings.js` | 新增逻辑 | 凭证表单 CRUD + 验证 |
| `templates/panels/settings.html` | 新增 HTML | 应用凭证 box |
