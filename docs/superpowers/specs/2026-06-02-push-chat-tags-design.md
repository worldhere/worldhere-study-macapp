# 推送设置 · 群聊标签模式 设计文档

日期：2026-06-02

## 1. 背景

当前推送设置的群聊 ID 用纯文本框（textarea），一行一个 chat_id。用户裸眼看 oc_xxx 没法区分哪个是哪个群，且无法隐藏长 ID。改为标签模式：给每个群起个名字，只展示名字，hover 才看 ID，点 × 删除。

## 2. UI 设计

### 2.1 输入区

两个小输入框 + 添加按钮，替代原来的 textarea：

```
[群名称__________] [chat_id: oc_xxxx] [➕ 添加]
```

- 群名称为空时默认取 chat_id 前 12 位
- chat_id 不以 `oc_` 开头时拒绝添加，toast 提示

### 2.2 标签列表

每行一个 tag，hover 浮出 tooltip 显示完整 chat_id：

```
🏷 生产群  ×       ← hover: "oc_1b5fe857a2c346a9cb67970fb9d79fed"
🏷 测试群  ×
```

- 点 × 直接删除，不需要确认弹窗（误删可以再加）
- 列表为空时显示灰色提示："还没有群聊，在上方添加"

### 2.3 布局

```
┌─ 推送设置 ─────────────────────── [开关] ─┐
│ 推送已开启                                  │
│ ────────────────────────────────────────── │
│ 群聊列表                                    │
│ [群名称____] [chat_id: oc_xxxx] [➕ 添加]   │
│                                            │
│ 🏷 生产群  ×                                │
│ 🏷 测试群  ×    ← 空态："还没有群聊..."     │
│                                            │
│ [💾 保存] [🧪 测试消息________] [🚀 发送]   │
└────────────────────────────────────────────┘
```

## 3. 数据存储

`config` 表 `feishu_push/chat_ids` 的 value 从纯文本改为 JSON 数组：

```json
[{"name":"生产群","chat_id":"oc_1b5fe857..."}, {"name":"测试群","chat_id":"oc_9d3a..."}]
```

向后兼容：读取时若旧格式为纯文本（不以 `[` 开头），自动迁移为 `[{"name":"","chat_id":"每行一个"}]`。

## 4. 后端变更

### 4.1 `/api/feishu/push-config` (GET)

返回字段变更：

```json
{
  "enabled": true,
  "chat_groups": [{"name":"生产群","chat_id":"oc_xxx"}, ...]
}
```

旧字段 `chat_ids` 移除。

### 4.2 `/api/feishu/push-config/save` (POST)

接收字段变更：

```json
{
  "enabled": true,
  "chat_groups": [{"name":"生产群","chat_id":"oc_xxx"}, ...]
}
```

### 4.3 `/api/feishu/push-config/test` (POST)

从 `chat_groups` 中提取 `chat_id` 列表发送，逻辑不变。

## 5. 前端变更

涉及文件：
- `templates/panels/settings.html`：替换 textarea 为输入框 + 标签列表容器
- `static/settings.js`：新增 `addChatGroup()`、`removeChatGroup(idx)`、`renderChatGroups()`；修改 `loadPushConfig()`、`savePushConfig()`、`testPush()`

## 6. 样式

标签样式参考现有 `.sticky` 系列但更轻量：

- 背景：`var(--bg-muted)` 或浅色 tag 底色
- 圆角：`20px`（胶囊形）
- hover tooltip：CSS `title` 属性 或 `::after` pseudo element
- × 按钮：`color: var(--text-muted); cursor: pointer;` hover 变红

## 7. 验证

- 添加群聊：输入名称 + oc_xxx → 标签列表出现
- 空名称：自动取 chat_id 前 12 位
- 非法 chat_id：不以 oc_ 开头时 toast 拒绝
- 删除：点 × 立即从列表移除
- 保存→刷新页面→数据还在
- 旧数据迁移：如果 config 里是纯文本 chat_ids，自动转成 JSON 数组
