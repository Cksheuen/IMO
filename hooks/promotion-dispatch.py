#!/usr/bin/env python3
"""Promotion Dispatch - 队列管理脚本

管理晋升候选队列，支持 claim/release/list 操作。

Usage:
    python3 promotion-dispatch.py claim              # 获取待处理候选
    python3 promotion-dispatch.py release <id>       # 释放候选回队列
    python3 promotion-dispatch.py list               # 列出队列状态
    python3 promotion-dispatch.py scan               # 扫描新的晋升候选
"""

import argparse
import fcntl
import json
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

BASE = Path.home() / ".claude"
QUEUE_FILE = BASE / "promotion-queue.json"
TODO_FILE = BASE / "consolidation-todo.json"
STATE_FILE = BASE / "consolidation-state.json"
LESSONS_DIR = BASE / "notes" / "lessons"
RULES_DIR = BASE / "rules"
SKILLS_DIR = BASE / "skills"
LOG_DIR = BASE / "logs" / "promotion"
QUEUE_LOCK_FILE = BASE / "promotion-queue.lock"
LOG_DIR.mkdir(parents=True, exist_ok=True)


def log(msg: str):
    """写入日志"""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line, file=sys.stderr)
    log_file = LOG_DIR / "dispatch.log"
    with open(log_file, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def build_dispatch_prompt(candidates: list[dict]) -> str:
    """构造 promote-notes prompt，支持手动批量处理。"""
    if not candidates:
        return (
            "No claimed promotion candidates were provided. "
            "Do not rescan the queue; stop and report no-op."
        )

    lines = [
        "Process only the claimed promotion candidates from promotionDispatch.candidates.",
        "Do not rescan the whole queue.",
        "For each candidate, decide promote / merge / keep / defer and write promotion-result.json.",
        "",
        f"Batch size: {len(candidates)}",
    ]

    for idx, candidate in enumerate(candidates, start=1):
        lines.append(
            f"{idx}. {candidate.get('path', '')} | reason={candidate.get('reason', '') or candidate.get('signal', '')}"
        )
    return "\n".join(lines)


def now_iso() -> str:
    return datetime.now().isoformat()


def default_dispatch_state() -> dict:
    return {
        "status": "idle",
        "consumer": "promote-notes",
        "attempts": 0,
        "requestedAt": None,
        "lastAttemptAt": None,
        "finishedAt": None,
        "lastError": None,
    }


def normalize_candidate(item: dict, forced_status: Optional[str] = None) -> Optional[dict]:
    """归一化候选项，兼容 v1/v2 字段。"""
    if not isinstance(item, dict):
        return None

    candidate = dict(item)
    candidate_id = candidate.get("id") or candidate.get("path")
    if not candidate_id:
        return None

    candidate["id"] = candidate_id
    candidate["status"] = forced_status or candidate.get("status") or "pending"
    candidate["attempts"] = candidate.get("attempts", 0)
    return candidate


def normalize_queue(raw_queue: Optional[dict]) -> dict:
    """归一化队列，兼容 legacy(v1) 和 queue v2。"""
    if not isinstance(raw_queue, dict):
        raw_queue = {}

    dispatch = default_dispatch_state()
    if isinstance(raw_queue.get("dispatch"), dict):
        dispatch.update(raw_queue["dispatch"])

    candidates_by_id = {}
    status_priority = {"pending": 0, "failed": 1, "processing": 2, "completed": 3}

    def upsert(item: dict, forced_status: Optional[str] = None):
        candidate = normalize_candidate(item, forced_status=forced_status)
        if not candidate:
            return

        key = str(candidate["id"])
        existing = candidates_by_id.get(key)
        if not existing:
            candidates_by_id[key] = candidate
            return

        existing_status = existing.get("status", "pending")
        new_status = candidate.get("status", "pending")
        if status_priority.get(new_status, 0) >= status_priority.get(existing_status, 0):
            merged = dict(existing)
            merged.update(candidate)
        else:
            merged = dict(candidate)
            merged.update(existing)
        candidates_by_id[key] = merged

    for item in raw_queue.get("candidates", []):
        upsert(item)
    for item in raw_queue.get("processing", []):
        upsert(item, forced_status="processing")
    for item in raw_queue.get("completed", []):
        upsert(item, forced_status="completed")

    return {
        "version": raw_queue.get("version", 2),
        "created_at": raw_queue.get("created_at") or raw_queue.get("createdAt") or now_iso(),
        "updatedAt": raw_queue.get("updatedAt") or raw_queue.get("updated_at") or now_iso(),
        "dispatch": dispatch,
        "candidates": list(candidates_by_id.values()),
    }


def candidates_with_status(queue: dict, *statuses: str) -> list:
    if not statuses:
        return list(queue.get("candidates", []))
    target = set(statuses)
    return [c for c in queue.get("candidates", []) if c.get("status", "pending") in target]


def load_queue() -> dict:
    """加载队列状态"""
    if QUEUE_FILE.exists():
        try:
            return normalize_queue(json.loads(QUEUE_FILE.read_text()))
        except (json.JSONDecodeError, OSError):
            pass
    return normalize_queue({})


def save_queue(queue: dict):
    """保存队列状态"""
    normalized = normalize_queue(queue)
    normalized["updatedAt"] = now_iso()
    # legacy mirrors: 给仍依赖 processing/completed 的脚本做兜底
    normalized["processing"] = candidates_with_status(normalized, "processing")
    normalized["completed"] = candidates_with_status(normalized, "completed")
    normalized["updated_at"] = normalized["updatedAt"]
    QUEUE_FILE.write_text(json.dumps(normalized, indent=2, ensure_ascii=False))


@contextmanager
def locked_queue():
    """在文件锁保护下执行 read-modify-write。"""
    QUEUE_LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(QUEUE_LOCK_FILE, "a+", encoding="utf-8") as lock_file:
        fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
        queue = load_queue()
        try:
            yield queue
        finally:
            save_queue(queue)
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def load_consolidation_todo() -> dict:
    """加载 consolidation-todo.json"""
    if TODO_FILE.exists():
        try:
            return json.loads(TODO_FILE.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {"pending_promotions": [], "stale_reviews": []}


def extract_keywords(text: str) -> set:
    """从文本中提取关键词"""
    import re
    # 分词：支持中英文
    words = re.findall(r"[a-zA-Z]{2,}|[\u4e00-\u9fff]{2,}", text.lower())
    # 过滤常见停用词
    stopwords = {"the", "a", "an", "is", "are", "was", "were", "be", "been",
                 "have", "has", "had", "do", "does", "did", "will", "would",
                 "could", "should", "may", "might", "must", "shall", "can",
                 "的", "是", "在", "有", "和", "与", "或", "了", "不", "这"}
    return set(w for w in words if w not in stopwords)


def calculate_similarity(lesson_path: Path, target_path: Path) -> float:
    """计算 lesson 与目标文件的相似度"""
    # 1. 文件名关键词重叠
    lesson_keywords = extract_keywords(lesson_path.stem)
    target_keywords = extract_keywords(target_path.stem)

    if not lesson_keywords or not target_keywords:
        return 0.0

    keyword_overlap = len(lesson_keywords & target_keywords) / max(len(lesson_keywords), len(target_keywords))

    # 2. 内容触发条件匹配（如果文件存在）
    trigger_sim = 0.0
    if lesson_path.exists() and target_path.exists():
        lesson_content = lesson_path.read_text(encoding="utf-8", errors="ignore")
        target_content = target_path.read_text(encoding="utf-8", errors="ignore")

        # 提取触发条件 - 支持 frontmatter、metadata 和 markdown 标题三种格式
        import re

        def extract_trigger_text(content: str) -> str:
            """从内容中提取触发条件文本"""
            # 尝试 frontmatter: Trigger: xxx 或 触发条件: xxx
            fm_match = re.search(r"^(Trigger|触发条件)[:\s]+(.+)$", content, re.MULTILINE | re.IGNORECASE)
            if fm_match:
                return fm_match.group(2).strip()

            # 尝试 metadata 格式: - Trigger: xxx (常见于 lesson 文件)
            meta_match = re.search(r"^-?\s*Trigger[:\s]+(.+)$", content, re.MULTILINE | re.IGNORECASE)
            if meta_match:
                return meta_match.group(1).strip()

            # 尝试 markdown 标题: ## 触发条件 后的第一段内容
            heading_match = re.search(r"^##\s*触发条件\s*\n+(.+?)(?=\n##|\n---|\Z)", content, re.MULTILINE | re.DOTALL)
            if heading_match:
                return heading_match.group(1).strip()

            return ""

        lesson_trigger = extract_trigger_text(lesson_content)
        target_trigger = extract_trigger_text(target_content)

        if lesson_trigger and target_trigger:
            lt_kw = extract_keywords(lesson_trigger)
            tt_kw = extract_keywords(target_trigger)
            if lt_kw and tt_kw:
                trigger_sim = len(lt_kw & tt_kw) / max(len(lt_kw), len(tt_kw))

    # 加权得分
    return 0.6 * keyword_overlap + 0.4 * trigger_sim


def find_similar_rules(lesson_path: Path) -> list:
    """查找与 lesson 相似的现有 rules/skills"""
    similar = []

    # 扫描 rules/
    if RULES_DIR.exists():
        for rule_file in RULES_DIR.rglob("*.md"):
            if rule_file.name == "README.md":
                continue
            sim = calculate_similarity(lesson_path, rule_file)
            if sim >= 0.3:  # 降低阈值，记录更多候选
                similar.append({
                    "path": str(rule_file.relative_to(BASE)),
                    "type": "rule",
                    "similarity": round(sim, 2),
                })

    # 扫描 skills/
    if SKILLS_DIR.exists():
        for skill_dir in SKILLS_DIR.iterdir():
            if skill_dir.is_dir():
                skill_file = skill_dir / "SKILL.md"
                if skill_file.exists():
                    sim = calculate_similarity(lesson_path, skill_file)
                    if sim >= 0.3:
                        similar.append({
                            "path": str(skill_file.relative_to(BASE)),
                            "type": "skill",
                            "similarity": round(sim, 2),
                        })

    # 按相似度排序
    similar.sort(key=lambda x: x["similarity"], reverse=True)
    return similar[:5]  # 返回 top 5


def scan_candidates() -> list:
    """扫描新的晋升候选"""
    candidates = []

    # 1. 从 consolidation-todo.json 获取
    todo = load_consolidation_todo()
    for item in todo.get("pending_promotions", []):
        filename = item.get("file")
        if not filename:
            continue
        lesson_path = LESSONS_DIR / filename
        if not lesson_path.exists():
            continue

        similar = find_similar_rules(lesson_path)
        candidates.append({
            "id": filename.replace(".md", ""),
            "source": "consolidation-todo",
            "path": f"notes/lessons/{filename}",
            "reason": item.get("reason", ""),
            "similar_rules": similar,
            "action": "promote",
        })

    # 2. 扫描 candidate-rule 状态的 lesson
    if LESSONS_DIR.exists():
        for lesson_file in LESSONS_DIR.iterdir():
            if lesson_file.suffix != ".md":
                continue
            content = lesson_file.read_text(encoding="utf-8", errors="ignore")
            if "status: candidate-rule" in content.lower() or "Status: candidate-rule" in content:
                # 检查是否已在候选列表中
                existing_ids = [c["id"] for c in candidates]
                file_id = lesson_file.stem
                if file_id not in existing_ids:
                    similar = find_similar_rules(lesson_file)
                    candidates.append({
                        "id": file_id,
                        "source": "status-scan",
                        "path": f"notes/lessons/{lesson_file.name}",
                        "reason": "Status: candidate-rule",
                        "similar_rules": similar,
                        "action": "promote",
                    })

    return candidates


def cmd_scan():
    """扫描命令"""
    candidates = scan_candidates()
    log(f"Found {len(candidates)} promotion candidates")

    for c in candidates:
        print(f"\n  [{c['id']}]")
        print(f"    Source: {c['source']}")
        print(f"    Reason: {c['reason']}")
        if c['similar_rules']:
            print(f"    Similar rules:")
            for s in c['similar_rules']:
                print(f"      - {s['path']} (sim={s['similarity']})")

    # 更新队列（使用锁保护）
    with locked_queue() as queue:
        existing_ids = {c["id"] for c in queue["candidates"]}
        now = now_iso()

        for c in candidates:
            if c["id"] not in existing_ids:
                c["status"] = "pending"
                c["claimed_at"] = None
                c.setdefault("attempts", 0)
                c.setdefault("enqueuedAt", now)
                c["lastSeenAt"] = now
                queue["candidates"].append(c)
                existing_ids.add(c["id"])

        pending_count = len(candidates_with_status(queue, "pending"))
        processing_count = len(candidates_with_status(queue, "processing"))

    print(f"\nQueue updated: {pending_count} pending, {processing_count} processing")


def cmd_claim(count: int = 1):
    """获取待处理候选，支持手动批量 claim。"""
    requested_count = max(1, min(count, 10))
    claimed: list[dict] = []

    with locked_queue() as queue:
        claimable_statuses = ("pending", "failed")
        for candidate in queue["candidates"]:
            if len(claimed) >= requested_count:
                break
            if candidate.get("status") in claimable_statuses:
                candidate["status"] = "processing"
                candidate["claimed_at"] = now_iso()
                candidate["attempts"] = candidate.get("attempts", 0) + 1
                candidate.pop("last_error", None)
                candidate.pop("lastError", None)
                claimed.append(dict(candidate))

        if claimed:
            dispatch = queue["dispatch"]
            dispatch["status"] = "running"
            dispatch["requestedAt"] = dispatch.get("requestedAt") or now_iso()
            dispatch["lastAttemptAt"] = now_iso()
            dispatch["attempts"] = dispatch.get("attempts", 0) + 1
            dispatch["lastError"] = None

    if claimed:
        log(f"Claimed candidates: {', '.join(item['id'] for item in claimed)}")
        payload = {
            "promotionDispatch": {
                "subagentType": "promote-notes",
                "queuePath": str(QUEUE_FILE.relative_to(BASE)),
                "hasCandidates": True,
                "candidates": claimed,
                "prompt": build_dispatch_prompt(claimed),
            }
        }
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return

    log("No pending candidates found")
    print(json.dumps({"promotionDispatch": {"hasCandidates": False, "candidates": []}}, indent=2, ensure_ascii=False))


def cmd_release(candidate_id: str):
    """释放候选回队列"""
    released = False

    with locked_queue() as queue:
        for candidate in queue["candidates"]:
            if candidate.get("id") == candidate_id and candidate.get("status") == "processing":
                candidate["status"] = "pending"
                candidate["claimed_at"] = None
                released = True
                break

        if released and not candidates_with_status(queue, "processing"):
            queue["dispatch"]["status"] = "idle"
            queue["dispatch"]["finishedAt"] = now_iso()
            queue["dispatch"]["lastError"] = None
            queue["dispatch"]["background_spawned"] = False
            queue["dispatch"]["background_pid"] = None

    if released:
        log(f"Released candidate: {candidate_id}")
        print(f"Released: {candidate_id}")
        return

    log(f"Candidate not found in processing: {candidate_id}")
    print(f"Error: candidate {candidate_id} not in processing")


def cmd_fail(candidate_id: Optional[str], error: Optional[str]):
    """失败恢复：将一个或全部 processing 候选重新入队。"""
    requeued = []

    with locked_queue() as queue:
        for candidate in queue["candidates"]:
            if candidate.get("status") != "processing":
                continue
            if candidate_id and candidate.get("id") != candidate_id:
                continue

            candidate["status"] = "failed" if error else "pending"
            candidate["claimed_at"] = None
            candidate["last_error"] = error or "subagent_failed"
            candidate["lastError"] = error or "subagent_failed"
            requeued.append(candidate["id"])

        if requeued:
            queue["dispatch"]["status"] = "failed" if error else "idle"
            queue["dispatch"]["finishedAt"] = now_iso()
            queue["dispatch"]["lastError"] = error
            queue["dispatch"]["background_spawned"] = False
            queue["dispatch"]["background_pid"] = None

    if requeued:
        log(f"Re-queued failed candidates: {', '.join(requeued)}")
        print(json.dumps({"requeued": requeued, "error": error}, indent=2, ensure_ascii=False))
    else:
        log("No processing candidates matched fail request")
        print(json.dumps({"requeued": [], "error": error}, indent=2, ensure_ascii=False))


def cmd_apply(result_file: str):
    """调用 promotion-apply-result.py 应用结果。"""
    apply_script = BASE / "hooks" / "promotion-apply-result.py"
    target = Path(result_file)
    if not target.is_absolute():
        target = BASE / target

    completed = subprocess.run(
        [sys.executable, str(apply_script), "--result-file", str(target)],
        capture_output=True,
        text=True,
        check=False,
    )
    if completed.stderr:
        print(completed.stderr, file=sys.stderr, end="")
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)
    print(completed.stdout, end="")


def cmd_list():
    """列出队列状态"""
    queue = load_queue()
    dispatch = queue.get("dispatch", {})
    pending = candidates_with_status(queue, "pending")
    processing = candidates_with_status(queue, "processing")
    failed = candidates_with_status(queue, "failed")
    completed = candidates_with_status(queue, "completed")

    print("=== Promotion Queue ===")
    print(f"Version: {queue.get('version', 'N/A')}")
    print(
        "Dispatch: "
        f"status={dispatch.get('status', 'unknown')}, "
        f"consumer={dispatch.get('consumer', 'unknown')}, "
        f"attempts={dispatch.get('attempts', 0)}, "
        f"lastError={dispatch.get('lastError') or 'N/A'}"
    )

    print(f"\nPending: {len(pending)}")
    for c in pending:
        print(f"  - {c['id']} ({c.get('reason', 'N/A')})")

    print(f"\nProcessing: {len(processing)}")
    for c in processing:
        claimed = c.get("claimed_at", "N/A")
        print(f"  - {c['id']} (claimed: {claimed})")

    print(f"\nFailed: {len(failed)}")
    for c in failed:
        err = c.get("lastError") or c.get("last_error") or "N/A"
        print(f"  - {c['id']} (error: {err})")

    print(f"\nCompleted: {len(completed)}")


def main():
    parser = argparse.ArgumentParser(description="Promotion Dispatch")
    parser.add_argument("command", choices=["scan", "claim", "release", "fail", "apply", "list"])
    parser.add_argument("candidate_id", nargs="?", help="Candidate ID for release")
    parser.add_argument("--error", help="Failure reason for fail command")
    parser.add_argument("--result-file", help="Result file for apply command")
    parser.add_argument("--count", type=int, default=1, help="Batch size for claim command")
    args = parser.parse_args()

    if args.command == "scan":
        cmd_scan()
    elif args.command == "claim":
        cmd_claim(args.count)
    elif args.command == "release":
        if not args.candidate_id:
            print("Error: candidate_id required for release")
            sys.exit(1)
        cmd_release(args.candidate_id)
    elif args.command == "fail":
        cmd_fail(args.candidate_id, args.error)
    elif args.command == "apply":
        if not args.result_file:
            print("Error: --result-file required for apply", file=sys.stderr)
            sys.exit(1)
        cmd_apply(args.result_file)
    elif args.command == "list":
        cmd_list()


if __name__ == "__main__":
    main()
