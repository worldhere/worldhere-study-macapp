# -*- coding: utf-8 -*-
"""飞书同步包 — 统一出口"""

# 公共模块
from feishu.common import (
    _feishu_data, _feishu_raw, _feishu_request,
    _batch_create_records, _batch_update_records, _batch_delete_records,
    _parse_feishu_text,
    _get_app_token, BASE_URL, BATCH_SIZE, ROW_LIMIT,
    MACHINE_CONFIG_TABLE, GROUPS_TABLE, WHITELIST_TABLES,
)

# 表工具
from feishu.table_utils import (
    TABLE_FIELDS, SYSTEM_FIELDS, USER_FIELDS, LOCAL_USER_FIELDS,
    _build_exception_options_property,
    _find_table_by_name, _fetch_all_tables_snapshot, _lookup_table_name,
    _create_table, ensure_table_fields,
)

# 配置表同步
from feishu.config_table import (
    CONFIG_TABLE_FIELDS, STATUS_TRANSLATE,
    ensure_config_table_fields, ensure_machine_config_table,
    push_machine_config,
)

# 排班同步
from feishu.schedule_sync import (
    PUSH_DAYS_BEFORE, PUSH_DAYS_AFTER,
    compute_task_statuses,
    _sort_by_priority, _date_min_to_timestamps,
    push_machine_schedules,
    _parse_feishu_datetime_for_pull, _format_drift_window,
    _pull_one_machine, _apply_pull_changes, _handle_exception_events,
    pull_all_machines,
)

# 状态
from feishu.status import (
    _event_buffer, _event_lock, MAX_EVENTS,
    _active_operation, _init_lock_ref,
    write_event, get_sync_status, _get_sync_mode, _is_sync_enabled,
)

# 生命周期
from feishu.lifecycle import (
    _upsert_mapping,
    on_machine_created, on_machine_renamed, on_machine_deleted,
)

# 初始化引擎
from feishu.init_engine import (
    incremental_init, _incremental_init_impl,
)

# 同步循环
from feishu.sync_loop import (
    _sync_thread, _sync_stop_event, _init_lock, _init_cancel,
    SYNC_INTERVAL_SEC, _last_loop_at, _last_push_result,
    _consecutive_failures, _thread_health,
    is_initializing, cancel_init,
    _get_degraded_level, _get_sync_interval,
    push_all_machines_parallel,
    start_pull_thread, stop_pull_thread,
    _async_init, _async_push, _async_pull, _async_toggle_on,
    _sync_loop,
)

# 分组表
from feishu.groups import (
    GROUPS_TABLE_FIELDS,
    _ensure_groups_table_fields, ensure_groups_table,
    sync_groups,
)

# 必须显式列出 __all__ 以支持 feishu_sync 兼容层的 from feishu import *
__all__ = [
    # common
    "_feishu_data", "_feishu_raw", "_feishu_request",
    "_batch_create_records", "_batch_update_records", "_batch_delete_records",
    "_parse_feishu_text",
    "_get_app_token", "BASE_URL", "BATCH_SIZE", "ROW_LIMIT",
    "MACHINE_CONFIG_TABLE", "GROUPS_TABLE", "WHITELIST_TABLES",
    # table_utils
    "TABLE_FIELDS", "SYSTEM_FIELDS", "USER_FIELDS", "LOCAL_USER_FIELDS",
    "_build_exception_options_property",
    "_find_table_by_name", "_fetch_all_tables_snapshot", "_lookup_table_name",
    "_create_table", "ensure_table_fields",
    # config_table
    "CONFIG_TABLE_FIELDS", "STATUS_TRANSLATE",
    "ensure_config_table_fields", "ensure_machine_config_table",
    "push_machine_config",
    # schedule_sync
    "PUSH_DAYS_BEFORE", "PUSH_DAYS_AFTER",
    "compute_task_statuses",
    "_sort_by_priority", "_date_min_to_timestamps",
    "push_machine_schedules",
    "_parse_feishu_datetime_for_pull", "_format_drift_window",
    "_pull_one_machine", "_apply_pull_changes", "_handle_exception_events",
    "pull_all_machines",
    # status
    "_event_buffer", "_event_lock", "MAX_EVENTS",
    "_active_operation", "_init_lock_ref",
    "write_event", "get_sync_status", "_get_sync_mode", "_is_sync_enabled",
    # lifecycle
    "_upsert_mapping",
    "on_machine_created", "on_machine_renamed", "on_machine_deleted",
    # init_engine
    "incremental_init", "_incremental_init_impl",
    # sync_loop
    "_sync_thread", "_sync_stop_event", "_init_lock", "_init_cancel",
    "SYNC_INTERVAL_SEC", "_last_loop_at", "_last_push_result",
    "_consecutive_failures", "_thread_health",
    "is_initializing", "cancel_init",
    "_get_degraded_level", "_get_sync_interval",
    "push_all_machines_parallel",
    "start_pull_thread", "stop_pull_thread",
    "_async_init", "_async_push", "_async_pull", "_async_toggle_on",
    "_sync_loop",
    # groups
    "GROUPS_TABLE_FIELDS",
    "_ensure_groups_table_fields", "ensure_groups_table",
    "sync_groups",
]
