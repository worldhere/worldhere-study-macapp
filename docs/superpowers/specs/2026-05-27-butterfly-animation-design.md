# 蝴蝶动画设计文档

## 概述

在现有粒子背景和彩带动画之外，新增蝴蝶动画效果。蝴蝶由三个三角形组成（黄绿色随机），在页面中平缓飞行，长时间无操作后会停在卡片边缘休息，用户操作后惊飞。

## 视觉设计

### 飞行态（俯视图）
- 三个三角形组成的蝴蝶形状，无身体，纯几何抽象
- 颜色：黄绿色随机 hue(65~95)，饱和度65%~75%，亮度48%~58%
- 大小：scale 0.7~1.1 随机
- 头部始终朝向飞行方向：`ctx.rotate(heading + Math.PI/2)`
- 微风飘摆：位置摇曳(±5px)、微小旋转(±0.05rad)、翅膀呼吸式缩放(0.80~1.00)
- 绘制在 fly-canvas，z-index=2（面板下方）

### 休息态（侧视图）
- 两翅合并为一片完整大三角，无身体，保持几何抽象
- 从侧视角看到的是翅膀的完整面（不是边缘）
- 三层颜色叠加：外翅阴影(52%亮度) + 主翅(65%亮度) + 高光(75%亮度)
- 停在卡片边缘，朝向跟随边框方向：
  - 上边框：翅朝上
  - 左边框：翅朝左
  - 右边框：翅朝右
- 微风旋转微摆(±0.05rad)、呼吸缩放(0.94~1.00)
- 偶尔扇翅：每3~8秒一次快速微张脉冲，持续约0.3秒
- 绘制在 rest-canvas，z-index=10（面板上方）
- floatAlpha 控制从飞行层到休息层的渐变过渡

### 惊飞态（俯视图）
- 双翅同步扇动（飞蛾式），上翅压缩90%，下翅压缩35%
- 频率0.6~1.8Hz
- 向随机斜上方飞出画面，速度逐渐增加
- 红色微光阴影效果

### 渐隐态
- alpha 从0.82渐变至0后移除

## 种群动态

### 三个阶段
| 阶段 | 名称 | 数量 | 行为 |
|------|------|------|------|
| idle | 基础游荡 | 3~5只 | 飞行+偶尔休息 |
| grow | 缓慢增殖 | 每30~60s +1，最多15只 | 飞行+频繁休息 |
| flee | 惊飞散逸 | 每1~3s -1~4只 | 休息蝶惊飞/渐隐 |

### 生命周期
```
enter（边缘飞入，fade-in） → fly（飞行游荡） → rest（停靠休息）
                                                    ↓
                                          休息够了(15~50s) → fly
                                                    ↓
                                          flee/fade（退出）
```

### 休息位管理
- 每张卡片上边框4个位，左右边框各2个位
- 从 `.rest-card` 元素实时采集位置
- 占用/释放机制，先到先得
- 只有当总数>4时才尝试休息
- 休息位满了就继续飞行

## 交互

- **点击飞行蝴蝶** → 变为惊飞态，向随机方向飞出
- **点击惊飞蝴蝶** → 直接渐变消失
- **休息蝴蝶不受直接点击**（在 rest-canvas 上，pointer-events:none）
- 用户滚动/操作页面时可触发群体惊飞（phase=flee）

## 系统集成

### 新增文件
- `static/butterflies.js` — 蝴蝶动画全部逻辑

### 修改文件
1. **`templates/index.html`**
   - 新增两个 canvas 元素：`butterfly-fly-canvas`(z=2) 和 `butterfly-rest-canvas`(z=10)
   - 引入 `/static/butterflies.js`

2. **`templates/panels/settings.html`**
   - 在系统设置子页面新增蝴蝶动画开关 checkbox
   - 格式参照粒子背景/彩带动画的 toggle 模式

3. **`static/settings.js`**
   - `applyUISetting()`: 新增 `butterfly_animation` case
   - `applyStoredUISettings()`: 新增蝴蝶开关的初始化和启动

4. **`static/app.js`**
   - 在 `window.onload` 中读取 `butterfly_animation` 设置并启动

### API
- `startButterflies()` — 启动蝴蝶动画
- `stopButterflies()` — 停止蝴蝶动画
- 与 `startParticleBackground`/`stopParticleBackground` 模式一致

### 设置持久化
- key: `butterfly_animation`
- 通过 `/api/settings/batch` 存取
- localStorage 缓存：`ui_butterfly_animation`

### 不修改
- CSS 文件（动画纯 canvas 实现）
- Flask 后端（复用现有 settings API）

## 技术约束
- canvas pointer-events:none，避免阻挡面板操作
- rest-canvas 的 pointer-events 由 fly-canvas 的 click 事件处理（通过坐标判断）
- requestAnimationFrame 循环，跟随页面刷新率
- resize 监听：窗口大小变化时同步更新两个 canvas 尺寸
- 暗色模式：自动切换为萤火虫渲染（见下方）

## 暗色模式：萤火虫

当页面处于暗色主题（`document.documentElement.getAttribute('data-theme') === 'dark'`）时，所有蝴蝶自动切换为萤火虫渲染。行为完全不变，仅视觉替换。

### 萤火虫视觉（Style C — 双光点）
- 飞行态：主光点（径向渐变，中心近白→黄绿→透明）+ 小尾光点（略偏下，模拟腹部发光段延伸）
- 主光点半径约16px，尾光点半径约8px
- 暖黄绿色调 hue(75~85)
- 呼吸式亮度脉冲：`0.5 + sin(t*1.8+phase)*0.28`
- 微风飘摆：位置摇曳(±3px)
- 无身体、无翅膀结构，纯发光点
- 休息态：卡片边缘上的微弱闪烁光点（缩小版，无尾光）
- 惊飞态：光点加速远离 + 红色光晕（替代蝴蝶的红色阴影）

### 主题切换响应
- 在 `updateAndDraw` 循环中每帧检测 `data-theme` 属性
- 亮色模式 → 蝴蝶三角形渲染
- 暗色模式 → 萤火虫光点渲染
- 无需额外开关，自动跟随系统主题
