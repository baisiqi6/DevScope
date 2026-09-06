# 3D 图谱视觉升级生产发布

- Mode: high-risk
- Scope: 发布 PR #67 的图谱材质、多视角黑洞与交互改进；代码提交 17d743d。
- Authority: 用户于本会话明确要求“走正常的发布部署流程”。允许 push、PR、合并及生产部署。
- Non-goals: 不迁移数据库，不执行技术栈清理，不改其他站点或凭据；不宣称相对论模拟或稳定 60 FPS。

## 执行与验收

1. 核对代码及本地 lint/typecheck/test/build；独立 Reviewer 检查 diff、视觉和范围证据；PR quality/integration 均成功后合并。
2. 部署前确认生产 35cb69d、工作树干净、三应用健康；已有业务库备份 28 项 TABLE DATA 可读、Nginx 与 .env 受限备份；保存回滚镜像定位。
3. main 精确合并提交经手动 deploy.yml 发布，apply_database_migration=false、technology_stack_legacy_cleanup=false；等待成功。
4. 独立回读 Git 与 3 镜像 revision、API/Web、Nginx、未认证 401 与认证 200；浏览器验证生产 shader 与图谱交互。
5. verification.md 记录部署 run、SHA、备份/回滚与浏览器证据；独立 closeout 审查后关闭本发布节点。产品审美意见保留 DF-20260905-001 待用户反馈。

## 回滚

目标生产基线 35cb69d8f635675cbd735a26505816434ff09938。工作流保留三服务 :rollback 镜像；按 runbook 的回滚步骤恢复原镜像并复核健康；本次无 DB migration，常规回滚不恢复数据库。任何 CI/备份/版本/健康门禁失败均停止推进，不强制合并或修改访问控制。

## 证据

- 本地门禁及多视角验收：.planning/2026-09-05-graph-craft/verification.md（私有本地 artifact，不包含凭据）。
- PR: https://github.com/baisiqi6/DevScope/pull/67
- 备份 locator 与部署结果写入同目录 verification.md，不复制到稳定架构文档。
