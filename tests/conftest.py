# -*- coding: utf-8 -*-
"""共享 fixture：app + db + mock_feishu"""
import os
import shutil
import tempfile
import sys
import pytest
from unittest import mock

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TEST_DB_TEMPLATE = os.path.join(os.path.dirname(__file__), "data", "test.db")


@pytest.fixture
def app():
    """创建 Flask test client，指向临时测试 DB"""
    db_copy = tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False)
    db_copy.close()
    shutil.copy2(TEST_DB_TEMPLATE, db_copy.name)

    os.environ["TASK_SCHEDULE_DB_PATH"] = db_copy.name

    # Re-import db module to pick up the new path
    import db
    import importlib
    importlib.reload(db)

    from app import app as flask_app
    flask_app.config["TESTING"] = True
    with flask_app.test_client() as client:
        yield client

    os.unlink(db_copy.name)
    if "TASK_SCHEDULE_DB_PATH" in os.environ:
        del os.environ["TASK_SCHEDULE_DB_PATH"]


@pytest.fixture
def db(app):
    """数据库连接，指向测试 DB"""
    from db import get_db, DB_PATH
    conn = get_db()
    yield conn
    try:
        conn.close()
    except Exception:
        pass


@pytest.fixture(autouse=True)
def mock_feishu():
    """全局 mock 飞书 API 和 IM 消息，避免真实网络调用"""
    def _mock_success(data=None):
        """创建成功响应的 mock"""
        m = mock.MagicMock()
        m.get.return_value = {"code": 0, "data": data or {}, "msg": "ok"}
        return m

    with mock.patch("feishu.common._feishu_request", return_value={"code": 0, "data": {}, "msg": "ok"}) as mock_req, \
         mock.patch("feishu.common._feishu_data", return_value={}) as mock_data, \
         mock.patch("feishu.common.send_im_message", return_value=(True, None)) as mock_im_group, \
         mock.patch("feishu.common.send_im_message_to_user", return_value=(True, None)) as mock_im_user:
        yield {
            "request": mock_req,
            "data": mock_data,
            "im_group": mock_im_group,
            "im_user": mock_im_user,
        }
