# 可视化总结面板 — 设计规格

**日期：** 2026-06-08
**状态：** 已确认

## 1. 目标

在历史记录面板右侧新增"可视化总结"面板，实现：

1. **计算与展示分离**：聚合查询集中在 `models/summary.py`，前端和飞书卡片各自消费同一份数据
2. **管理员审核**：班次报告在 Web UI 可视化预览后，由管理员手动点击发送到飞书群
3. **飞书代码轻量化**：`cards.py` 不再自己查库聚合，只负责接收数据 + 拼装 Feishu JSON

## 2. 架构

```
schedules / tasks / machines / task_packages / repair_log / push_log / shift_config
                                      │
                                      ▼
                            models/summary.py
                          （13 个纯数据函数）
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                ▼
              GET /api/summary   cards.py          POST /api/summary
              /data              build_report_     /send-report
                     │           card()                   │
                     ▼                │                   │
              🖥 可视化面板          Feishu JSON         发送到飞书群
              (Chart.js 渲染)        （轻量拼装）
```

## 3. 文件变更清单

| 文件 | 类型 | 内容 |
|------|------|------|
| `models/summary.py` | 🆕 新建 | 13 个纯数据函数。从 `cards.py` 迁入 `_build_shift_where` 和 `_query_*` 辅助函数 |
| `routes/summary.py` | 🆕 新建 | API 路由：`GET /api/summary/data`、`GET /api/summary/report-status`、`POST /api/summary/send-report` |
| `templates/panels/summary.html` | 🆕 新建 | 2 列网格面板，顶部班次报告横幅 + 发送按钮，下方 widget 卡片 |
| `static/summary.js` | 🆕 新建 | 面板 JS：数据拉取、Chart.js 渲染、折叠/展开、发送确认对话框 |
| `feishu/events/cards.py` | ✏️ 重构 | SQL 查询迁到 `summary.py`，`build_report_card()` 改为接收数据字典 |
| `templates/index.html` | ✏️ 修改 | 加 tab 按钮 + panel include |
| `static/core.js` | ✏️ 修改 | `NAV_TAB_MAP` 加一条 |

## 4. 数据层：`models/summary.py`

所有函数签名：`def func(conn, ...) -> dict | list`。由调用方管理 `conn` 生命周期。

### 4.1 `shift_report_data(conn, date_str, shift) -> dict`

从 `cards.py` 重构迁出。复用 `_build_shift_where` 逻辑。

```python
{
    "total_schedules": int,
    "completed_standalone": int,
    "packages": [
        {"name": str, "total": int, "completed": int, "pct": float}
    ],
    "pkg_sch_total": int,
    "pkg_sch_completed": int,
    "collect_total": int,
    "completion_pct": float,
    "pending_count": int,
}
```

### 4.2 `daily_trend_data(conn, days=14, machine_type=None) -> list`

```python
[{"date": "2026-06-01", "completed": 12, "total": 15}, ...]
```

SQL: `SELECT date, COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed FROM schedules WHERE date >= ? GROUP BY date ORDER BY date`

### 4.3 `estimate_vs_actual_data(conn, days=14) -> list`

```python
[{"task_name": str, "machine_name": str, "type": str,
  "est_min": int, "actual_min": int, "delta_min": int}, ...]
```

只含已完成且同时有 `actual_start_min` 和 `actual_end_min` 的排班。工作时长调用 `calc_working_minutes` 扣除休息段。

### 4.4 `completion_heatmap_data(conn, days=14) -> list`

```python
[{"date": str, "hour": 0..23, "count": int}, ...]
```

从 `completed_at` 提取小时，按 `(date, hour)` 分组计数。

### 4.5 `weekday_load_data(conn, weeks=4) -> list`

```python
[{"weekday": 0..6, "label": "周一".."周日", "total": int, "completed": int, "avg_per_day": float}, ...]
```

### 4.6 `machine_utilization_data(conn, date_str, shift) -> list`

```python
[{"machine_name": str, "type": str, "total_min": int, "utilization_pct": float, "task_count": int}, ...]
```

利用率 = 排班总时长 / 班次可用时长（白班 day_start~night_start，夜班 night_start~次日 day_start）。

### 4.7 `machine_status_distribution(conn) -> dict`

```python
{
    "by_type": {"BR1": {"空闲": 3, "工作": 5, "维修停用": 1}, ...},
    "total": {"空闲": 8, "工作": 12, "维修停用": 3}
}
```

### 4.8 `repair_summary_data(conn, days=30) -> list`

```python
[{"machine_name": str, "type": str, "repair_count": int,
  "total_duration_min": int, "avg_duration_min": float, "last_repair_at": str}, ...]
```

### 4.9 `exception_summary_data(conn, days=14) -> dict`

```python
{
    "by_type": {"机器故障": 5, "缺少物料": 2, "无法执行": 1},
    "by_shift": {"白班": 3, "夜班": 5},
    "rate": 0.12,
    "trend": [{"date": str, "count": int}, ...]
}
```

### 4.10 `overdue_tasks_data(conn) -> list`

```python
[{"task_name": str, "machine_name": str, "date": str,
  "end_str": str, "overdue_min": int, "status": str}, ...]
```

未完成 + `now > end_dt`。按 overdue_min 降序。

### 4.11 `cross_day_tasks_data(conn, days=7) -> list`

```python
[{"task_name": str, "machine_name": str, "date": str,
  "start_str": str, "end_str": str, "span_days": int}, ...]
```

`end_min > 1440`。`span_days = end_min // 1440`。

### 4.12 `time_deviation_data(conn, days=14) -> dict`

```python
{
    "start_deviations": [{"task_name": str, "delta": int}, ...],
    "end_deviations": [{"task_name": str, "delta": int}, ...],
    "avg_start_delta": float,
    "avg_end_delta": float
}
```

正数 = 延迟，负数 = 提前。

### 4.13 `push_stats_data(conn, days=7) -> dict`

```python
{
    "by_type": {"reminder": 15, "announcement": 3, ...},
    "success_rate": 0.98,
    "daily": [{"date": str, "total": int, "success": int}, ...]
}
```

## 5. API 层：`routes/summary.py`

### `GET /api/summary/data`

批量获取 widget 数据。

**参数：**
- `widgets`（必填）：逗号分隔的 widget 名，如 `daily_trend,exception_summary`
- `days`（可选，默认 14）
- `date`（可选，默认今天）
- `shift`（可选，班次报告时需要）

**返回：** `{"daily_trend": [...], "exception_summary": {...}}`

**实现：** 用函数名映射表路由到 `summary.py` 的对应函数，每个函数失败不影响其他（独立 try/except，返回 null）。

### `GET /api/summary/report-status`

检查指定日期/班次的报告是否已通过手动发送。

**参数：** `date`, `shift`

**返回：** `{"generated": bool, "sent": bool, "sent_at": str|null}`

判断依据：查询 `push_log` 表 `event_type='shift_report'` 且 `dedup_key` 匹配。

### `POST /api/summary/send-report`

手动发送班次报告到飞书群。

**Body：** `{"date": "2026-06-08", "shift": "白班", "chat_ids": ["oc_xxx"]}`

**流程：**
1. 调用 `shift_report_data(conn, date, shift)` 获取数据
2. 调用 `build_report_card(data, date, shift)` 生成卡片 JSON
3. 逐个 chat_id 调用 `send_im_message(chat_id, card_json, "interactive")`
4. 写 `push_log` 记录发送成功/失败

**返回：** `{"success": true, "sent_to": ["oc_xxx"], "errors": []}`

## 6. 前端面板：`summary.html` + `summary.js`

### 6.1 布局

2 列 CSS Grid，顶行跨两列。

- **第 1 行（全宽）**：班次报告横幅 — 紫色背景。显示日期、班次、完成率、未完成数、采集总数。右侧「发送到飞书」按钮 + 日期/班次选择器（下拉切换历史报告）。
- **剩余行**：12 个 widget 卡片，2 列排列。每个卡片有标题 + Chart.js canvas 或表格。

### 6.2 图表类型对照

| Widget | 图表类型 |
|--------|----------|
| 每日完成趋势 | 折线图（多线：总排班 / 已完成） |
| 预估 vs 实际 | 柱状图（分组：预估 / 实际） |
| 时段热力图 | 自定义 grid（CSS 背景色深浅） |
| 星期负载 | 柱状图 |
| 机器利用率 | 水平柱状图（降序） |
| 机器状态分布 | 环形图（按类型分组） |
| 维修频率 | 双轴柱状图（次数 + 时长） |
| 异常汇总 | 堆叠柱状图 + 折线（趋势） |
| 过时清单 | 紧凑表格（任务名 / 机器 / 超时时长） |
| 跨天任务 | 紧凑表格（任务名 / 机器 / 跨几天） |
| 提前/延迟 | 分布直方图 |
| 推送统计 | 堆叠柱状图 |

### 6.3 交互

- **面板切换时**：从 API 拉取所有 widget 数据，渲染图表
- **时间范围选择器**：下拉（本周 / 本月 / 近 14 天 / 近 30 天），切换后重拉数据
- **日期/班次选择器**：在报告横幅内，切换历史报告
- **发送按钮**：弹出确认对话框 → 列出 `feishu_push.chat_ids` 中的群组 → 确认发送 → 调 `POST /api/summary/send-report`
- **Widget 折叠**：点击标题栏折叠/展开
- **发送状态**：横幅右侧显示「已发送 ✓ 2026-06-08 21:05」或「未发送」

### 6.4 图表库

Chart.js（~60KB gzip），CDN 引入。不引入 ECharts。

## 7. 飞书端重构：`cards.py`

### 7.1 `build_report_card()` 重构

**重构前**（~120 行）：自己获取 conn、调用 `_build_shift_where`、4 次 SQL 查询、计算完成率、拼 JSON

**重构后**（~40 行）：

```python
from models.summary import shift_report_data

def build_report_card(data, date_str, shift):
    """data: shift_report_data() 的返回值"""
    elements = _render_package_progress(data["packages"])
    elements += _render_summary_section(data)
    elements += _render_pending_section(data)

    card = {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"{shift}总结"},
            "template": "purple"
        },
        "elements": elements,
    }
    return json.dumps(card, ensure_ascii=False)
```

### 7.2 迁移清单

从 `cards.py` 迁到 `summary.py`：
- `_build_shift_where()` — 班次 WHERE 子句构建
- `_query_package_progress()` — 包进度查询
- `_query_package_schedule_stats()` — 包排班统计
- `_query_collect_total()` — 采集总数查询

留在 `cards.py`：
- 6 个 `build_*_card()` 函数（拼 JSON 逻辑）
- `_format_task_label()`、`_time_change_line()` 等纯展示函数

### 7.3 `dispatch.py`

**不改动。** 自动发送路径保持不变，由飞书推送设置开关控制。手动发送是独立的新路径。

## 8. 自动发送与手动发送的关系

- **自动发送**：由 `feishu_push` 配置中的事件开关控制。开关打开时，`dispatch.py` 在检测到 `shift_report` 事件后自动发送。此路径不变。
- **手动发送**：可视化面板中的「发送到飞书」按钮。独立于自动检测流程，走 `POST /api/summary/send-report`。管理员可以随时为任意日期/班次手动发送报告。
- **两条路径互不干扰**：自动发送是无人值守的下限保证，手动发送是有人审核的主路径。

## 9. 边界条件

- **无数据时**：widget 显示空状态提示（如 "暂无数据"），不崩溃
- **跨天任务**：复用 `_build_shift_where` 的 start_min 区间逻辑，跨天排班归入正确的班次
- **大日期范围**：趋势类 widget 限制最大 90 天
- **并发的 send-report 请求**：`push_log` 去重键防止重复发送
- **数据库锁**：summary.py 的所有函数只读，使用调用方传入的 conn
