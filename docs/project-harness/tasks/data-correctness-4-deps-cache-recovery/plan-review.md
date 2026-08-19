# Plan Review 记录：data-correctness-4-deps-cache-recovery

独立 reviewer（fresh-context subagent，与 Worker 不同 session）。两轮均基于 worktree `main@8868246` 的计划全文与源码实读。

## 第一轮（2026-08-19，verdict: `changes_requested`）

### P1

1. `resolved` 状态的复查/TTL 语义缺失，`resolved→error` 降级未定义；warm rebuild 对 `resolved` 行零外呼无语义依据（与 domain-model「`resolved` 只在到期或规范名称校正时更新」冲突）。
2. 历史 302 行 `null` 迁移语义留白，RED test 3 需要确定目标状态；unknown-compatible 会引入第四状态、超出 domain-model 三状态枚举。

### P2

1. 预算口径未覆盖 SBOM backfill 阶段的 GitHub 请求。
2. 预算单一/分 provider 口径未定义；默认预算与 `maxAttempts=3` 的收敛关系未说明（60s 重试、终态重启路径应言明）。
3. 并发化后未保留 pacing，有 GitHub secondary rate limit 风险；429 应尊重 `Retry-After`。
4. 回滚窗口依赖新列 DEFAULT：须 pin DEFAULT `'error'` 防旧镜像写入被误读；建议 CHECK 与条件 UPDATE 回填。
5. canonicalization freshness 存储位置二选一留到实现期，有把 fullName 过载进 `(system,name,version)` 唯一键的风险。
6. RED test 缺口：lost lease 原子提交抑制、rename 回写 evidence、warm rebuild 零 deps.dev 外呼、`resolved→error` 降级。

### P3

stage 枚举漏 `similarity`；test 6「零或接近零」非确定性；progress 存储载体未指定。

第一轮同时核实：计划全部生产证据断言与源码一致（无 timeout 的 `resolveViaDepsDev`/`getCanonicalFullName`、串行+50ms sleep、错误与无映射同落 `null`、status 只有 running/terminal）；越界检查通过。

## 修订（Worker，同日）

- `resolved` 复查语义成段写入（TTL 内零外呼；到期/rename 校正时复查；失败降级 `error` + 旧值移动到 `last_resolved_repo`）；统一 cache 读取规则。
- 迁移语义拍板：非 null → `resolved`；null → `error` + 迁移时间基准短 `retry_after`；DEFAULT `'error'`；条件 UPDATE；CHECK `resolved ⟺ source_repo IS NOT NULL`。
- 预算：口径含 SBOM 阶段；按 provider 分列；冷启动单 attempt 收敛 guardrail；终态重启为设计内路径并写入 runbook。
- 并发：保守个位数 + pacing + 429 `Retry-After`。
- freshness：拍板新表 `github_repo_name_canonicalizations`。
- RED tests：新增/改写 6 条（见 plan.md 更新后的清单 test 1-12）。
- stage 加 `similarity`；progress 载体拍板 `jobs.progress` 列 + lease-authoritative 条件 UPDATE。

## 第二轮（continuity，verdict: `approved`）

- 11 条 findings 全部 closed（含逐条行号核验）。
- 确认 `last_resolved_repo` 取代 CHECK 后半边：`resolved ⟺ source_repo IS NOT NULL` 在三值状态下逻辑等价于原建议（逆否命题），且数据库强制降级必须「移动」而非「复制」，设计更干净。
- 两条 P3 提示已随批处理：`last_resolved_repo` 补入 Files In Scope 迁移清单；新表不套用同款 CHECK（降级证据保留在 `canonical_full_name` 本身）；重复句删除。
- 结论：批准进入 RED tests；后续按计划走 implementation review 与 production closeout。

## 事件

- 第一轮 verdict：`evt-20260819T013750Z-c59d9240`
- 第二轮 verdict：`evt-20260819T014236Z-20c97bd5`
