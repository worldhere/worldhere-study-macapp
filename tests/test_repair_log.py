# -*- coding: utf-8 -*-
"""维修记录 API 测试 — create"""


def test_repair_log_create_success(app):
    """POST /api/repair_log/create 成功创建维修记录"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": "2026-06-18T11:30",
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is True
    assert isinstance(data.get('id'), int)
    assert data['id'] > 0


def test_repair_log_create_missing_machine_id(app):
    """缺少 machine_id 返回 400"""
    resp = app.post('/api/repair_log/create', json={
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": "2026-06-18T11:30",
    })
    assert resp.status_code == 400


def test_repair_log_create_missing_start(app):
    """缺少 start_datetime 返回 400"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "end_datetime": "2026-06-18T11:30",
    })
    assert resp.status_code == 400


def test_repair_log_create_end_null(app):
    """end_datetime 为 null 时仍可创建（进行中的维修）"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": None,
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('ok') is True

    # Also verify end_datetime is NULL in DB
    from db import get_db
    conn = get_db()
    row = conn.execute("SELECT end_datetime FROM repair_log WHERE id=?", (data['id'],)).fetchone()
    conn.close()
    assert row is not None
    assert row["end_datetime"] is None


def test_repair_log_create_created_at_auto(app):
    """created_at 由后端自动设置，不依赖前端传入"""
    resp = app.post('/api/repair_log/create', json={
        "machine_id": 1,
        "start_datetime": "2026-06-18T09:00",
        "end_datetime": "2026-06-18T10:00",
    })
    assert resp.status_code == 200
    data = resp.get_json()
    rid = data['id']

    # 读回验证 created_at 不为空
    from db import get_db
    conn = get_db()
    row = conn.execute("SELECT created_at FROM repair_log WHERE id=?", (rid,)).fetchone()
    conn.close()
    assert row is not None
    assert row["created_at"] is not None
