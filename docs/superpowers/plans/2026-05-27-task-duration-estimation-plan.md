# 任务时长自动推算 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入无时长字段的 Excel 任务包时，根据任务名称关键词和条数自动推算预估时长。

**Architecture:** 在 `utils.py` 新增纯函数 `estimate_duration_from_name()`，基于关键词系数表计算时长；在 `import_utils.py` 的 `execute_import()` 中，当任务无 duration 时调用该函数自动填充。前端的设置页新增"班次速率"参数滑块。

**Tech Stack:** Python 3, Flask, SQLite, vanilla JS

---

### Task 1: 在 utils.py 中新增时长推算函数

**Files:**
- Modify: `utils.py` (末尾追加新函数)

- [ ] **Step 1: 在 utils.py 末尾追加关键词系数表和推算函数**

```python
# ====================== 任务时长自动推算 ======================

# 关键词系数：值 < 1.0 表示简单位移，> 1.0 表示精细/费力操作
# 排在前面的优先匹配（长关键词优先，避免 "放" 误匹配 "放入"）
_KEYWORD_COEFFICIENTS = [
    # 1.2 组 — 精细/费力操作（长关键词在前）
    (1.2, ["插入", "挤出", "挤压", "拧紧", "摇晃", "晃动", "翻转", "整理",
           "抽出", "倒出", "打开", "合上"]),
    # 1.0 组 — 普通操作
    (1.0, ["放入", "放进", "放到", "放中间", "推出", "推回", "抽出", "拿起",
           "轻推", "朝下", "朝上"]),
    # 0.8 组 — 简单位移
    (0.8, ["并排", "紧贴", "移到", "推向", "移到", "横放", "右移", "左移",
           "移到", "放在", "放到", "推到", "移药品", "立"]),
]

def _get_rate_per_shift(default: int = 3000) -> int:
    """从 config 表读取每班次采集条数，读取失败返回默认值。"""
    try:
        from db import get_db
        conn = get_db()
        row = conn.execute(
            "SELECT value FROM config WHERE category='schedule_settings' AND key='rate_per_shift'"
        ).fetchone()
        conn.close()
        if row and row["value"]:
            return max(100, int(row["value"]))
    except Exception:
        pass
    return default


def estimate_duration_from_name(name: str, count: int = 25,
                                rate_per_shift: int = None) -> int:
    """根据任务名称和条数推算预估时长（分钟）。

    formula: count * (420 / rate_per_shift) * coefficient

    - 420 = 白班有效工作分钟（扣除休息）
    - rate_per_shift = 每班次采集条数（默认 3000，可从设置页调整）
    - coefficient = 名称关键词系数，范围 [0.7, 1.5]
    """
    if not name or not str(name).strip():
        return count  # 无法推算时返回条数作为最粗略估计

    name_str = str(name).strip()
    count = max(1, int(count)) if count else 25

    # 计算系数：扫描关键词，取命中的最高系数
    max_coef = 1.0
    complex_count = 0  # 1.2 组命中次数
    for coef, keywords in _KEYWORD_COEFFICIENTS:
        for kw in keywords:
            if kw in name_str:
                if coef > max_coef:
                    max_coef = coef
                if coef >= 1.2:
                    complex_count += 1
                break  # 同组内只计一次

    # 多个复杂关键词 → 1.5
    if complex_count >= 2:
        max_coef = 1.5

    if rate_per_shift is None:
        rate_per_shift = _get_rate_per_shift()

    effective_minutes = 420  # 白班有效工作分钟
    per_item_min = effective_minutes / max(1, rate_per_shift)
    base_min = count * per_item_min

    result = round(base_min * max_coef)
    return max(1, result)
```

- [ ] **Step 2: 验证函数逻辑**

```powershell
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python -c "
from utils import estimate_duration_from_name

tests = [
    ('药盒右移与创可贴并排', 25),   # 右移+并排 → 0.8 → 25*0.14*0.8=2.8≈3
    ('从缝隙中抽出药膏', 25),       # 抽出 → 1.0 → 25*0.14*1.0=3.5≈4
    ('挤压管状药膏一次', 25),       # 挤压 → 1.2 → 25*0.14*1.2=4.2≈4
    ('拧紧管状药膏瓶盖', 25),       # 拧紧 → 1.2 → 4
    ('整理桌面药品', 25),           # 整理 → 1.2 → 4
    ('翻转药盒使名称朝上并拧紧瓶盖', 25),  # 翻转+拧紧 → 1.5 → 25*0.14*1.5=5.25≈5
    ('药膏右移与创可贴并排整理桌面', 25),  # 右移+并排+整理 → 1.5 → 5
    ('移药品到中央并排', 25),        # 移药品+并排 → 0.8 → 3
    ('', 25),                       # 空名 → 回退 25 → 25
]

for name, cnt in tests:
    est = estimate_duration_from_name(name, cnt, rate_per_shift=3000)
    print(f'{est:2d} min | {name}')
"
```

Expected: 时长有区分度（2~5 分钟区间），且含多个复杂关键词的任务时长更高。

- [ ] **Step 3: 验证所有 45 个药品任务都有合理估算**

```powershell
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python -c "
import openpyxl
from utils import estimate_duration_from_name

wb = openpyxl.load_workbook(r'C:\Users\Admin\Desktop\大家的Draft\zyh\测试文档\药品任务包.xlsx')
ws = wb.active
durations = []
for row in ws.iter_rows(min_row=2, values_only=True):
    name = str(row[1]) if row[1] else ''
    count = int(row[2]) if row[2] else 25
    est = estimate_duration_from_name(name, count, rate_per_shift=3000)
    durations.append(est)
    print(f'{est:2d} min | {name}')

print(f'\n范围: {min(durations)}~{max(durations)} min')
print(f'平均: {sum(durations)/len(durations):.1f} min')
print(f'总时长: {sum(durations)} min = {sum(durations)/60:.1f} h')
# 一轮 1125 条 → 3000/1125 ≈ 2.67 轮/班
# 单轮总时长应远小于 420 min（因为多台机器并行）
print(f'单轮总时长: {sum(durations)} min (若 3 台机器 ≈ {sum(durations)/3:.0f} min/台)')
"
```

- [ ] **Step 4: Commit**

```bash
git add utils.py
git commit -m "feat: add estimate_duration_from_name() for auto duration estimation"
```

---

### Task 2: 在导入流程中集成时长推算

**Files:**
- Modify: `import_utils.py:420-430`

- [ ] **Step 1: 修改 execute_import() 中的时长处理逻辑**

将 `import_utils.py` 中第 422-428 行：

```python
        duration_str = _safe_str(item.get("duration"))
        est_mode = "blank"
        est_seconds = None
        if duration_str:
            m = parse_duration_to_minutes(duration_str, default_minutes=0)
            if m:
                est_mode = "direct"
                est_seconds = m * 60
```

替换为：

```python
        duration_str = _safe_str(item.get("duration"))
        est_mode = "blank"
        est_seconds = None
        if duration_str:
            m = parse_duration_to_minutes(duration_str, default_minutes=0)
            if m:
                est_mode = "direct"
                est_seconds = m * 60
        elif name and not duration_str:
            # 无时长字段时，根据名称+条数自动推算
            from utils import estimate_duration_from_name
            count = _safe_int(item.get("expected_count")) or 25
            est_min = estimate_duration_from_name(name, count)
            duration_str = str(est_min)
            est_mode = "auto"
            est_seconds = est_min * 60
```

- [ ] **Step 2: 验证导入流程**

用 Python 模拟导入（不在实际 DB 中执行），确认时长推算已触发：

```powershell
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python -c "
from import_utils import parse_excel, analyze_import

field_map, rows, headers = parse_excel(r'C:\Users\Admin\Desktop\大家的Draft\zyh\测试文档\药品任务包.xlsx')
print('Headers:', headers)
print('Field map:', field_map)
print(f'Rows: {len(rows)}')
print()
# 检查前 5 行的解析结果
for i, row in enumerate(rows[:5]):
    print(f'  [{i+1}] name={row.get(\"name\")}, type={row.get(\"type\")}, count={row.get(\"expected_count\")}')
"
```

- [ ] **Step 3: Commit**

```bash
git add import_utils.py
git commit -m "feat: auto-estimate task duration from name when duration field is missing"
```

---

### Task 3: 添加班次速率设置 UI

**Files:**
- Modify: `templates/panels/settings.html` (在子页面2末尾添加)
- Modify: `static/settings.js` (添加初始化逻辑)

- [ ] **Step 1: 在 settings.html 子页面2（排班面板设置）末尾添加速率配置**

在 `templates/panels/settings.html` 的 `<!-- ===== 子页面2：排班面板设置 ===== -->` 区域内，找到最后一个 `</div>` 闭合标签（`color-box-states` 的 box 之后），在其后插入：

```html
            <div class="box">
                <h3>班次采集速率</h3>
                <p class="settings-hint">每个班次大约采集多少条任务。导入任务包时，若任务无预估时长，将根据此速率和任务名称关键词自动推算时长。</p>
                <div style="display:flex;align-items:center;gap:12px;">
                    <input id="s-rate-per-shift" type="range" min="500" max="10000" step="100" value="3000" oninput="applyScheduleSetting('rate_per_shift', this.value); document.getElementById('rate-per-shift-val').textContent = this.value;">
                    <span id="rate-per-shift-val" style="font-weight:600;">3000</span>
                    <span>条/班次</span>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin-top:4px;">
                    当前推算：每条约 <span id="rate-per-item-display">0.14</span> 分钟，25条任务基础时长约 <span id="rate-per-25-display">3.5</span> 分钟
                </p>
            </div>
```

- [ ] **Step 2: 在 settings.js 的 applyStoredUISettings() 中添加速率滑块的初始化**

在 `static/settings.js` 中，找到 `applyStoredUISettings` 函数（或类似初始化逻辑），添加：

```javascript
    // 班次采集速率
    var rateSlider = document.getElementById('s-rate-per-shift');
    var rateVal = document.getElementById('rate-per-shift-val');
    var rateItemDisp = document.getElementById('rate-per-item-display');
    var rate25Disp = document.getElementById('rate-per-25-display');
    if (rateSlider) {
        var scheduleSettings = _settingsData['schedule_settings'] || [];
        var rateEntry = scheduleSettings.find(function(s) { return s.key === 'rate_per_shift'; });
        var saved = rateEntry ? parseInt(rateEntry.value) || 3000 : 3000;
        rateSlider.value = saved;
        if (rateVal) rateVal.textContent = saved;
        updateRateDisplay(saved);
        rateSlider.addEventListener('input', function() {
            updateRateDisplay(parseInt(this.value) || 3000);
        });
        function updateRateDisplay(rate) {
            var perItem = (420 / rate).toFixed(2);
            var per25 = (25 * 420 / rate).toFixed(1);
            if (rateItemDisp) rateItemDisp.textContent = perItem;
            if (rate25Disp) rate25Disp.textContent = per25;
        }
    }
```

将这段代码放在 `applyStoredUISettings()` 函数体内，其他初始化代码之后。

- [ ] **Step 3: Commit**

```bash
git add templates/panels/settings.html static/settings.js
git commit -m "feat: add rate_per_shift config UI in settings panel"
```

---

### Task 4: 端到端验证

- [ ] **Step 1: 启动应用**

```powershell
cd "C:\Users\Admin\Desktop\大家的Draft\zyh\golden"
python app.py
```

- [ ] **Step 2: 导入药品任务包**

在浏览器中打开 http://127.0.0.1:5000，进入任务库页面，导入 `药品任务包.xlsx`，确认：
- 45 个任务全部导入成功
- 每个任务显示了自动推算的时长（约 3~5 分钟区间）
- 不同任务的时长有差异

- [ ] **Step 3: 自动分配排班**

在排班面板中选择日期，选择自动分配，选择所有 BR2 待分配任务和所有 BR2 机器，执行分配，确认：
- 任务被分配到各 BR2 机器的时间轴上
- 时间条长度合理（3~5 分钟不等）
- 整体排班看起来符合"一个白班 ~3000 条"的量级

- [ ] **Step 4: 调整速率参数验证**

在设置页 > 排班面板设置中，调整"班次采集速率"滑块（如从 3000 改到 4000），确认：
- 下方推算显示随之更新
- 重新导入任务时，时长按新速率计算
