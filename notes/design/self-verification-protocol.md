# Self-Verification Protocol Reference

仅在需要 schema、更新样例、fixer loop 细节时读取本文件。

## Feature List 示例

```json
{
  "task_id": "auth-implementation",
  "created_at": "2026-03-31T10:00:00Z",
  "session_id": "<current_session>",
  "status": "in_progress",
  "features": [
    {
      "id": "F001",
      "category": "functional",
      "description": "User can login with email and password",
      "acceptance_criteria": ["..."],
      "verification_method": "e2e",
      "passes": null,
      "verified_at": null,
      "attempt_count": 0,
      "max_attempts": 3,
      "notes": "",
      "delta_context": null
    }
  ]
}
```

## Delta Context 示例

```json
{
  "problem_location": {
    "file": "src/auth/login.ts",
    "lines": "45-52",
    "code_snippet": "const token = generateToken(user.id);"
  },
  "root_cause": "Token generation doesn't set expiration time",
  "fix_suggestion": {
    "action": "add_parameter",
    "target": "generateToken() call",
    "details": "Pass { expiresIn: '24h' } as second parameter",
    "reference_example": "src/auth/refresh.ts:23"
  },
  "files_to_read": ["src/auth/login.ts:45-52"],
  "files_to_skip": ["src/auth/login.ts:1-44", "src/utils/*"]
}
```

## Verification Gate 判断

```text
Stop hook
  -> stop_hook_active=true        => allow
  -> no feature-list             => allow
  -> status=completed            => allow
  -> pending=0                   => allow
  -> attempts exceeded           => mark blocked / manual intervention
  -> passes=false                => VERIFICATION_FAILED
  -> passes=null                 => VERIFICATION_REQUIRED
```

## jq 更新样例

### 验证通过

```bash
jq '(.features[] | select(.id == "F001") | .passes) = true |
    (.features[] | select(.id == "F001") | .verified_at) = "TIMESTAMP" |
    (.features[] | select(.id == "F001") | .delta_context) = null' "$FEATURE_LIST"
```

### 验证失败

```bash
jq '(.features[] | select(.id == "F001") | .passes) = false |
    (.features[] | select(.id == "F001") | .attempt_count) += 1 |
    (.features[] | select(.id == "F001") | .delta_context) = {...}' "$FEATURE_LIST"
```

### implementer 修复后重置

```bash
jq '(.features[] | select(.id == "F001") | .passes) = null |
    (.features[] | select(.id == "F001") | .verified_at) = null' "$FEATURE_LIST"
```

## Fixer Loop

```text
reviewer fail
  -> 写 delta_context
  -> verification-gate 阻止退出
  -> 主 agent 派发 implementer
  -> implementer 只读 files_to_read
  -> 修复后重置为待验证
  -> reviewer 再次验证
```
