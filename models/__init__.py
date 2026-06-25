# -*- coding: utf-8 -*-
"""models 包 - 后向兼容 re-export。
子模块: config(班次/UI配置), queries(数据查询), packages(任务包), recycle(回收/切割)"""
from models.config import load_app_config, load_shift_config
from models.queries import (
    list_machines, list_tasks, list_schedules,
    list_history_schedules, get_repair_logs, _get_repair_for_schedule,
)
from models.packages import (
    list_task_packages, create_task_package, update_task_package,
    delete_task_package, add_tasks_to_package, get_package_tasks,
)
from models.recycle import (
    recycle_schedules, recycle_split_segment,
    task_insert_values, TASK_INSERT_FIELDS, TASK_INSERT_PLACEHOLDERS,
)
