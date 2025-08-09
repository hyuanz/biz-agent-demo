import os
import json
from datetime import datetime
from typing import Any, Dict, List

from flask import Blueprint, jsonify, request


def ensure_memory_file(memory_path: str) -> None:
    data_dir = os.path.dirname(memory_path)
    if not os.path.exists(data_dir):
        os.makedirs(data_dir, exist_ok=True)
    if not os.path.exists(memory_path):
        with open(memory_path, "w") as f:
            json.dump({"sessions": {}}, f)


def _load_memory(memory_path: str) -> Dict[str, Any]:
    try:
        with open(memory_path) as f:
            return json.load(f)
    except Exception:
        return {"sessions": {}}


def _save_memory(memory_path: str, mem: Dict[str, Any]) -> None:
    try:
        with open(memory_path, "w") as f:
            json.dump(mem, f, indent=2)
    except Exception:
        pass


def _get_session_mem(mem: Dict[str, Any], session_id: str) -> Dict[str, Any]:
    sessions = mem.setdefault("sessions", {})
    sess = sessions.setdefault(session_id, {})
    entities = sess.setdefault("entities", {})
    entities.setdefault("users_by_id", {})
    entities.setdefault("users_by_name", {})
    sess.setdefault("facts", [])
    return sess


def _normalize_name(name: str) -> str:
    return (name or "").strip().lower()


def remember_users(memory_path: str, session_id: str, rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    mem = _load_memory(memory_path)
    sess = _get_session_mem(mem, session_id)
    users_by_id = sess["entities"]["users_by_id"]
    users_by_name = sess["entities"]["users_by_name"]
    for row in rows:
        uid = str(row.get("id") or row.get("user_id") or "")
        if not uid:
            continue
        entry = {
            "id": uid,
            "name": row.get("name"),
            "email": row.get("email"),
            "location": row.get("location"),
            "age": row.get("age"),
        }
        users_by_id[uid] = entry
        if entry.get("name"):
            users_by_name[_normalize_name(entry["name"]) ] = uid
    if len(users_by_id) > 500:
        drop_n = len(users_by_id) - 500
        for i, k in enumerate(list(users_by_id.keys())):
            if i >= drop_n:
                break
            users_by_name.pop(_normalize_name(users_by_id[k].get("name") or ""), None)
            users_by_id.pop(k, None)
    _save_memory(memory_path, mem)


def create_memory_blueprint(memory_path: str) -> Blueprint:
    bp = Blueprint("memory", __name__)

    @bp.get("/memory")
    def get_memory():
        session_id = request.args.get("session_id", "default")
        mem = _load_memory(memory_path)
        sess = mem.get("sessions", {}).get(session_id) or {}
        return jsonify({"session_id": session_id, "memory": sess})

    @bp.post("/memory")
    def post_memory():
        data = request.get_json(silent=True) or {}
        session_id = data.get("session_id", "default")
        fact = data.get("fact")
        if not fact:
            return jsonify({"error": "fact is required"}), 400
        mem = _load_memory(memory_path)
        sess = _get_session_mem(mem, session_id)
        facts = sess.setdefault("facts", [])
        facts.append({"ts": datetime.utcnow().isoformat() + "Z", "fact": fact})
        if len(facts) > 200:
            sess["facts"] = facts[-200:]
        _save_memory(memory_path, mem)
        return jsonify({"ok": True})

    return bp


