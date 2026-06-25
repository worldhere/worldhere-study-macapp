# -*- coding: utf-8 -*-
"""端到端冒烟测试 — 连真实飞书跑完整链路。

用法:  python tests/smoke_test.py

⚠️ 此脚本会：
  1. 修改本地 DB（完成一条排班）
  2. 调用真实飞书 API（push + pull + detect + 发消息到测试群）
  3. 运行完毕后恢复排班状态

跑之前请确认：
  - app 未在运行（避免同步循环干扰）
  - 飞书 token 有效
  - 了解会有一条消息发到配置的飞书群
"""
import sys
import os
import time
import json
import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# 确保指向真实 DB（不是测试 DB）
if "TASK_SCHEDULE_DB_PATH" in os.environ:
    del os.environ["TASK_SCHEDULE_DB_PATH"]

from db import get_db, DB_PATH


def main():
    print("=" * 60)
    print("  飞书端到端冒烟测试")
    print(f"  DB: {DB_PATH}")
    print(f"  时间: {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    print()

    # ---- Step 0: 安全检查 ----
    conn = get_db()

    # 检查是否有映射
    mappings = conn.execute(
        "SELECT machine_id, machine_name, table_id FROM feishu_sync_mapping LIMIT 5"
    ).fetchall()
    if not mappings:
        print("❌ 无 feishu_sync_mapping 映射，请先在设置中配置飞书同步")
        conn.close()
        return

    print("已映射机器:")
    for m in mappings:
        print(f"  {m['machine_name']} (id={m['machine_id']}, table={m['table_id']})")

    # 找一条可用的排班
    sch = conn.execute(
        """SELECT s.id, s.date, s.task_id, s.task_name, s.status,
                  s.start_min, s.end_min,
                  m.id AS mid, m.name AS mname
           FROM schedules s
           JOIN machines m ON s.machine_id = m.id
           WHERE s.status != 'completed'
           AND s.machine_id IN (SELECT machine_id FROM feishu_sync_mapping)
           ORDER BY s.date DESC LIMIT 1"""
    ).fetchone()

    if not sch:
        print("❌ 找不到有映射且未完成的排班")
        conn.close()
        return

    print()
    print(f"测试排班: #{sch['id']} {sch['task_name']} @ {sch['mname']} {sch['date']}")
    print(f"  当前状态: {sch['status']}")
    print(f"  时间: {sch['start_min']}-{sch['end_min']}")

    # 检查是否有聊天配置
    chat_cfg = conn.execute(
        "SELECT value FROM config WHERE category='feishu_push' AND key='chat_ids'"
    ).fetchone()
    chat_ids = []
    if chat_cfg:
        try:
            chat_ids = [c["chat_id"] for c in json.loads(chat_cfg["value"]) if c.get("chat_id")]
        except Exception:
            pass
    print(f"  消息目标群: {chat_ids if chat_ids else '未配置'}")

    conn.close()

    print()
    resp = input("确认运行？这会发一条真实消息到飞书群。输入 yes 继续: ")
    if resp.strip().lower() != "yes":
        print("已取消")
        return

    results = {"steps": [], "passed": 0, "failed": 0}

    # ---- Step 1: 完成排班 ----
    print("\n[Step 1] 完成排班...")
    try:
        from app import app as flask_app
        with flask_app.test_client() as client:
            resp = client.get(f"/complete_task/{sch['id']}")
            data = resp.get_json()
            if resp.status_code == 200 and data.get("msg") == "ok":
                print(f"  ✅ 完成成功: {data}")
                results["steps"].append({"step": 1, "ok": True})
                results["passed"] += 1
            else:
                print(f"  ❌ 完成失败: status={resp.status_code} data={data}")
                results["steps"].append({"step": 1, "ok": False, "error": str(data)})
                results["failed"] += 1
    except Exception as e:
        print(f"  ❌ 异常: {e}")
        results["steps"].append({"step": 1, "ok": False, "error": str(e)})
        results["failed"] += 1

    time.sleep(1)

    # ---- Step 2: Push 到飞书 ----
    print("\n[Step 2] Push 排班到飞书...")
    try:
        from feishu.schedule_sync import push_machine_schedules
        result = push_machine_schedules(sch["mid"])
        if "error" not in result:
            print(f"  ✅ Push 完成: created={result.get('created')}, "
                  f"updated={result.get('updated')}, deleted={result.get('deleted')}")
            results["steps"].append({"step": 2, "ok": True, "detail": result})
            results["passed"] += 1
        else:
            print(f"  ❌ Push 失败: {result['error']}")
            results["steps"].append({"step": 2, "ok": False, "error": result["error"]})
            results["failed"] += 1
    except Exception as e:
        print(f"  ❌ 异常: {e}")
        results["steps"].append({"step": 2, "ok": False, "error": str(e)})
        results["failed"] += 1

    time.sleep(1)

    # ---- Step 3: Pull 更新 ----
    print("\n[Step 3] Pull 飞书变更...")
    try:
        from feishu.schedule_sync import pull_all_machines
        result = pull_all_machines()
        print(f"  ✅ Pull 完成: machines={result.get('machines_checked')}, "
              f"updated={result.get('records_updated')}")
        if result.get("errors"):
            print(f"  ⚠️  有错误: {result['errors'][:2]}")
        results["steps"].append({"step": 3, "ok": True, "detail": result})
        results["passed"] += 1
    except Exception as e:
        print(f"  ❌ 异常: {e}")
        results["steps"].append({"step": 3, "ok": False, "error": str(e)})
        results["failed"] += 1

    time.sleep(1)

    # ---- Step 4: 事件检测 ----
    print("\n[Step 4] 事件检测 + 发送消息...")
    try:
        # 不使用 mock！导入前确认 mock 未激活
        from feishu.events import detect_and_push_events
        detect_and_push_events()
        print("  ✅ 事件检测完成（检查飞书群是否收到消息）")
        results["steps"].append({"step": 4, "ok": True})
        results["passed"] += 1
    except Exception as e:
        print(f"  ❌ 异常: {e}")
        results["steps"].append({"step": 4, "ok": False, "error": str(e)})
        results["failed"] += 1

    # ---- Step 5: 恢复排班 ----
    print("\n[Step 5] 恢复排班状态...")
    try:
        conn = get_db()
        conn.execute(
            "UPDATE schedules SET status=?, completed_at=NULL, actual_end_min=NULL WHERE id=?",
            (sch["status"], sch["id"]),
        )
        conn.commit()
        conn.close()
        print(f"  ✅ 已恢复为 {sch['status']}")

        # 恢复后重新 push
        from feishu.schedule_sync import push_machine_schedules
        push_machine_schedules(sch["mid"])
        print("  ✅ 已同步恢复后的状态到飞书")
    except Exception as e:
        print(f"  ⚠️  恢复失败: {e}")

    # ---- 结果 ----
    print()
    print("=" * 60)
    print(f"  结果: {results['passed']} 通过 / {results['failed']} 失败")
    print("=" * 60)
    if results["failed"] == 0:
        print("  ✅ 全部通过！请到飞书群确认是否收到消息。")
    else:
        print("  ❌ 有步骤失败，详见上方日志。")


if __name__ == "__main__":
    main()
