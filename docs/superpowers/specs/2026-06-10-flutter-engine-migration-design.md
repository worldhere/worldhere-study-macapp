# Golden → Flutter 引擎迁移设计

## 概述

将 golden 排班系统的前端从 Flask Jinja2 + 原生 JS/CSS 迁移到 Flutter 桌面客户端，后端（Python Flask + SQLite）不动。

### 迁移原则

1. **后端零改动**：所有 `/api/*` 接口原样保留
2. **功能对等**：golden 现有功能全部迁移，不增不减
3. **有 bug 的功能**：迁移时能修就修，不能修的做成只读占位，标记 TODO 等后续细聊
4. **Flutter 编译为 Windows exe**，启动时自动拉起 Flask 后端进程

---

## 一、整体架构

```
┌─────────────────────────────────────────────────┐
│              Flutter 桌面客户端                   │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │ 时间轴    │ │ 面板页    │ │ 对话框        │   │
│  │CustomPainter│ │ Widget   │ │ showDialog    │   │
│  └─────┬─────┘ └────┬─────┘ └───────┬───────┘   │
│        │             │               │           │
│  ┌─────┴─────────────┴───────────────┴───────┐   │
│  │           数据层 (Repository)              │   │
│  │    models / api_client / app_config       │   │
│  └──────────────────┬────────────────────────┘   │
│                     │  HTTP + SSE                 │
└─────────────────────┼────────────────────────────┘
                      │
┌─────────────────────┼────────────────────────────┐
│          Python Flask 后端 (不动)                  │
│  /api/machines  /api/tasks  /api/schedules       │
│  /api/feishu/*  /api/saves  /api/settings        │
│                     │                             │
│              SQLite 数据库                         │
└───────────────────────────────────────────────────┘
```

### Flask 进程管理

- Flutter 启动时 `Process.start` 起 Flask（`localhost:5000`）
- 关闭窗口时 `Process.kill` 杀掉
- Flask 进程崩溃 → Flutter 显示"后端断开"提示，提供重启按钮

### 飞书集成

飞书同步逻辑全部在 Python 后端，Flutter 端只调 `/api/feishu/*` 接口。换引擎对飞书功能零影响。

---

## 二、数据与配置框架

### 2.1 统一配置管道

```
AppConfig (单例)
├── theme: ThemeTokens          ← 颜色/字体/间距/圆角
├── timeline: TimelineConfig    ← 时间轴刻度/缩放/吸附
├── filters: FilterPresets      ← 默认筛选规则
├── behavior: BehaviorConfig    ← 交互行为开关/参数
└── display: DisplayConfig      ← 日期格式/语言/每页条数

配置来源：
  默认值 (代码内置) ─┬─→ 合并 ─→ 最终配置 → 所有 Widget 从这里读
  用户覆盖值 (Flask API → SQLite) ─┘
```

**规则**：任何 Widget 需要可变值时，统一走 `AppConfig.of(context)`，不写死常量。新功能加可配置项只需在对应 config 类中加字段。

### 2.2 类型安全数据模型

所有 API JSON 返回先过 `fromJson` 变成 Dart 强类型对象（`Machine`、`Task`、`Schedule` 等）。字段名拼错编译期报错，杜绝运行时 `undefined`。

### 2.3 主题 Token 系统

```dart
// Widget 只引用 token，不写色值
Container(color: theme.surfaceColor)
Text('排班', style: theme.bodyStyle)

// 换风格 = 换一套 token
final darkTheme   = ThemeTokens(...)
final lightTheme  = ThemeTokens(...)
```

主题切换通过 `ThemeData.copyWith()` 一键全局生效。

---

## 三、时间轴

### 3.1 投影抽象层

```
数据层 (Schedule / Task / Machine)
         │
    ┌────┴────┐
    │ TimelineProjection (接口，可插拔)
    │
    │ timeToPoint(DateTime) → Offset
    │ pointToTime(Offset) → DateTime
    │ timeToWidth(start, end) → double
    │ visibleRange → (DateTime, DateTime)
    └────┬────┘
         │
    ┌────┴──────────────────────┐
    │                           │
LinearProjection   LensProjection / ArcProjection ...
(默认：水平线性)     (未来：拉伸、弧形、立体)
```

### 3.2 CustomPainter 渲染管线

```
paint(canvas, size):
  ├─ _drawGrid(canvas)           ← 网格线 + 时间标签
  ├─ _drawShiftOverlay(canvas)   ← 班次背景色带
  ├─ _drawSchedules(canvas)      ← 排班色块
  ├─ _drawTasks(canvas)          ← 任务时间块
  ├─ _drawCurrentTime(canvas)    ← 当前时间红线
  ├─ _drawFollowLine(canvas)     ← 基准跟随线（虚线）
  ├─ _drawSnapLine(canvas)       ← 吸附线（实线+高亮）
  └─ _drawDragPreview(canvas)    ← 拖拽预览叠加层
```

### 3.3 交互基准线系统

| 线 | 作用 | 显示条件 |
|---|---|---|
| **跟随线**（虚线） | 鼠标在哪线就在哪，即时空间定位 | 鼠标悬停在时间轴上 |
| **吸附线**（实线+高亮） | 跟随线锁到最近吸附网格点，显示"真实时间" | 拖拽/拉伸排班块时 |
| **时间浮标** | 吸附线对应的时间文字，跟手浮动 | 跟随线或吸附线显示时 |

**吸附规则**：默认 5 分钟网格，`Shift` 自由移动，`Alt` 1 分钟精度。配置从 `TimelineConfig` 读取。

### 3.4 拖拽交互（三层分离）

| 层 | 职责 |
|---|---|
| **GestureDetector** | 手势识别：`onPanStart` 命中检测、`onPanUpdate` 计算时间偏移、`onPanEnd` 提交 |
| **TimelineProjection** | 坐标映射：`pointToTime()`、`timeToPoint()`、`snapToGrid()` |
| **CustomPainter** | 渲染：根据最新数据画块，`shouldRepaint` 判断是否需要重绘 |

手势层不知道像素的存在，投影层负责屏幕坐标↔时间的双向映射。

**四种拖拽场景**：

| 场景 | 实现 |
|---|---|
| 任务池 → 时间轴 | `Draggable<Task>` + `DragTarget<TimelineSlot>` |
| 移动排班块 | `onPanStart` 命中检测 → `onPanUpdate` 投影反算 → 实时重绘 |
| 拉伸边缘 | 落点离左/右边缘 < 8px → resize 模式 |
| 操作模式 | `OperationMode` 枚举（修改/回收/完成/切割/删除），`onTap`/`onPanStart` 先判断模式 |

---

## 四、布局系统

### 4.1 双模式（和 golden 现在的 `toggleLayoutMode()` 一致）

| 模式 | 结构 | 对应 golden |
|---|---|---|
| **NavigationRail** | 左侧 48px 图标列 + 内容区 | 对应"侧边栏模式" |
| **顶部 TabBar** | 顶部导航栏 + Tab 行 + 内容区 | 对应"顶部导航 V2" |

右上角 ⇄ 按钮切换，逻辑和 `toggleLayoutMode()` 一致。

顶部栏内容（两种模式共享）：品牌名/图标 + 实时时钟 + 日期选择器 + 快速操作按钮 + 导出按钮 + 主题/布局切换按钮。

### 4.2 未来扩展

专注模式（全屏时间轴，隐藏导航）作为后续功能，不在首版实现。

---

## 五、面板

7 个面板全部用 Flutter 标准 Widget 实现：

| 面板 | golden 位置 | Flutter 方案 |
|---|---|---|
| **班次设置** | Tab 0 | `Form` + `TimePicker` + `TextField` |
| **机器管理** | Tab 1 | `DataTable` + `FilterChip` + `ExpansionTile` |
| **任务库** | Tab 2 | `PaginatedDataTable` + 筛选 + 编辑弹窗 |
| **排班面板** | Tab 3 | `CustomPaint` 时间轴 + 任务池（核心） |
| **历史记录** | Tab 4 | `PaginatedDataTable` + 时间范围筛选 |
| **可视化总结** | Tab 5 | `fl_chart` 图表包 |
| **设置** | Tab 6 | 表单（各种开关/下拉框/输入框） |

除排班面板外，其余 6 个均为标准 CRUD 表格/表单，无特殊技术难点。

---

## 六、对话框与交互

| 功能 | 处理方式 |
|---|---|
| **自动分配** | `showDialog` + 多步流程，照搬现有逻辑 |
| **批量添加/批量延迟/快速操作/编辑** | 标准 CRUD 弹窗 |
| **导出图片** | `dart:ui` 截 `CustomPaint` Canvas → PNG，替换 html2canvas |
| **导出 PDF** | `pdf` 包直接生成，替换 jsPDF |
| **Toast** | Flutter `SnackBar` |
| **Tooltip** | Flutter `Tooltip` Widget |
| **撤回/重做** | `UndoService` + `Ctrl+Z/Y` 快捷键（`Shortcuts` Widget） |

---

## 七、功能迁移状态分类

为避免 bug 迁移扩散，对 golden 现有功能做分级处理：

| 级别 | 说明 | 示例 |
|---|---|---|
| **绿：直接搬** | 逻辑清晰、运行稳定的功能 | 机器管理 CRUD、班次设置、设置面板、飞书同步 |
| **黄：搬 + 修** | 有已知小 bug，迁移时顺手修 | 具体功能待迁移时逐一确认 |
| **红：只读占位** | 有历史 bug 或逻辑复杂，暂时只读 | 快速操作等（用户标记） |

红标功能在 Flutter 端保留 UI 入口，但只展示现有数据/状态，不可操作，标记 TODO。等用户逐一细聊后再补全。

---

## 八、项目结构

```
golden_flutter/
├── lib/
│   ├── main.dart                      # 入口：启动 Flask → 进入 App
│   ├── app.dart                       # MaterialApp + ThemeData + 路由
│   │
│   ├── core/
│   │   ├── api_client.dart            # HTTP 客户端
│   │   ├── app_config.dart            # 统一配置管道
│   │   ├── theme_tokens.dart          # 主题 Token
│   │   └── storage.dart               # 本地偏好
│   │
│   ├── models/
│   │   ├── machine.dart
│   │   ├── task.dart
│   │   ├── schedule.dart
│   │   ├── shift_config.dart
│   │   └── feishu_status.dart
│   │
│   ├── projection/
│   │   ├── timeline_projection.dart   # 抽象接口
│   │   ├── linear_projection.dart     # 默认线性
│   │   └── (future) lens/arc/...      # 后续扩展
│   │
│   ├── pages/
│   │   ├── home_page.dart             # 主布局（双模式切换）
│   │   ├── shifts_page.dart
│   │   ├── machines_page.dart
│   │   ├── tasks_page.dart
│   │   ├── schedule_page.dart         # 排班面板（时间轴 + 任务池）
│   │   ├── history_page.dart
│   │   ├── summary_page.dart
│   │   └── settings_page.dart
│   │
│   ├── widgets/
│   │   ├── timeline/
│   │   │   ├── timeline_widget.dart
│   │   │   ├── timeline_painter.dart
│   │   │   ├── timeline_gestures.dart
│   │   │   └── timeline_guide_lines.dart  # 基准线系统
│   │   ├── task_table.dart
│   │   ├── machine_table.dart
│   │   ├── filter_bar.dart
│   │   └── dialogs/
│   │       ├── auto_assign_dialog.dart
│   │       ├── batch_add_dialog.dart
│   │       └── quick_ops_dialog.dart
│   │
│   └── services/
│       ├── schedule_service.dart
│       ├── auto_assign_service.dart
│       ├── export_service.dart
│       └── undo_service.dart
```

---

## 九、不做的

- 后端不作任何改动
- 不新增功能（功能对等迁移）
- 不改变数据库结构
- 专注模式等新布局特性推迟到后续版本
- 弧形/立体时间轴投影推迟到后续版本

---

## 十、已确认的决策

- 引擎：Flutter（CustomPainter 时间轴）
- 后端：Python Flask + SQLite 不动
- 迁移节奏：全量重写，一刀切
- 布局：双模式（NavigationRail ↔ 顶部 TabBar），⇄ 切换
- 时间轴：TimelineProjection 抽象接口 + 基准线吸附系统
- 拖拽：GestureDetector → Projection → CustomPainter 三层分离
- 数据框架：AppConfig 统一配置管道 + 强类型模型 + ThemeTokens
- 飞书：零影响，后端全包
- 导出：dart:ui Canvas 截图 + pdf 包
- bug 功能：分级处理（直接搬 / 搬+修 / 只读占位）
