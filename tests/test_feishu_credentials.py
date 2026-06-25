# -*- coding: utf-8 -*-
"""飞书应用凭证 API 测试"""
import json


def test_app_info_get_empty(app):
    """GET /api/feishu/app-info 返回凭证信息（未配置时返回空字符串）"""
    resp = app.get('/api/feishu/app-info')
    assert resp.status_code == 200
    data = resp.get_json()
    assert 'app_id' in data
    assert 'app_secret' in data
    assert 'app_token' in data
    assert 'has_secret' in data
    # 未配置时 has_secret 应为 False
    assert data['has_secret'] is False


def test_app_info_save(app):
    """POST /api/feishu/app-info 保存凭证（不验证）"""
    resp = app.post('/api/feishu/app-info', json={
        "app_id": "cli_test123",
        "app_secret": "my_secret_key",
        "app_token": "test_base_token",
        "verify": False,
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert data.get('msg') == '保存成功'
    assert data.get('verify') is None


def test_app_info_read_back(app):
    """保存后读回，验证持久化"""
    # 先保存
    app.post('/api/feishu/app-info', json={
        "app_id": "cli_readback",
        "app_secret": "s3cr3t!",
        "app_token": "tok_xyz",
        "verify": False,
    })
    # 读回
    resp = app.get('/api/feishu/app-info')
    assert resp.status_code == 200
    data = resp.get_json()
    assert data['app_id'] == 'cli_readback'
    assert data['app_token'] == 'tok_xyz'
    assert data['has_secret'] is True
    # secret 应脱敏
    assert 's3cr3t!' not in data['app_secret']
    assert '*' in data['app_secret']


def test_app_info_empty_rejected(app):
    """空字段应返回 400"""
    resp = app.post('/api/feishu/app-info', json={
        "app_id": "",
        "app_secret": "",
        "app_token": "",
    })
    assert resp.status_code == 400
    data = resp.get_json()
    assert 'error' in data


def test_app_info_save_then_token_cache_invalidated(app):
    """保存后 feishu_token 缓存应失效"""
    from feishu_token import _load_app_credentials, invalidate_app_cache

    # 先确保缓存已加载（读取一次触发缓存）
    _load_app_credentials()

    # 保存新凭证
    resp = app.post('/api/feishu/app-info', json={
        "app_id": "cli_new_app",
        "app_secret": "new_secret_val",
        "app_token": "new_token_val",
        "verify": False,
    })
    assert resp.status_code == 200

    # 再次读取凭证，应返回新值
    resp2 = app.get('/api/feishu/app-info')
    data2 = resp2.get_json()
    assert data2['app_id'] == 'cli_new_app'
    assert data2['app_token'] == 'new_token_val'
