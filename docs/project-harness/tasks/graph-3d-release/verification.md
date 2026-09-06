# 3D 图谱视觉升级发布回执

更新时间：2026-09-06（UTC）。生产部署与只读验收已完成，独立 closeout 结论见同目录 closeout-review.md。

## 变更与门禁

- 产品提交：`17d743d3ba29fa993d03008354c5922b74823c51`；PR [#67](https://github.com/baisiqi6/DevScope/pull/67)。
- 仅涉及 Web 渲染/交互与文档，无 API、数据库或迁移差异。
- 本地 lint/typecheck/test/build 成功；Web 9 files / 28 tests；18 个既有 lint warnings。
- PR quality / integration 已成功。独立审查结论见同目录 review.md。
- 本地正式构建已使用生产 API 只读数据完成多视角、搜索焦点、主题、画布缩放、减少动态效果回退及恢复检查。Shader 编译错误 0，重挂载后 3 个 pass、5 个纹理。
- 屏幕空间近似不重建遮挡信息或修改几何拾取坐标；整图稳定 60 FPS 未验证。性能采样不能替代用户设备验收。

## 生产基线与备份

- 部署前 Git 及 API/Web/Worker revision：`35cb69d8f635675cbd735a26505816434ff09938`；工作树干净。
- DevScope 五个容器正常；PostgreSQL healthy；磁盘可用约 16 GB。
- 受限备份目录：`/home/devscope/backups/devscope/pre-graph-20260906T050922Z/`，目录 700，文件 600，总大小约 215 MB。
- 备份包括 `.env`、完整 `nginx/` 归档和明确指定 `-d devscope` 的 custom-format 数据库 dump。
- `pg_restore --list` 可读，28 项 TABLE DATA；dump SHA-256：`b4ecb68ce492084362ac278bbfdf57bffb0905ed6364f5da5ac1671fc0608d5a`。
- Nginx 归档 SHA-256：`a8c2138056b7e2b25f54973ffd03f6ec17040eaca5f5e193dbc995e9194ad6ec`。
- 更正上一轮私有部署回执：`20260905T075429Z/database.dump` 导出的是 postgres 默认库，不能作为业务库备份。本次业务库备份已独立验证，不依赖该旧文件。
- 认证 loopback `/graph`、`/api/trpc/health` 均 200；公网未认证 `/` 为 401。

## 发布与回滚

PR #67 已合并，通过手动 deploy.yml 发布 main 精确 SHA；迁移与技术栈清理参数均 false。
工作流保留本节基线对应的 3 个 rollback 镜像。本次无数据库迁移，常规代码回滚不恢复数据库。

## 发布后证据

- PR #67 合并提交：`d2c4db162acf5ac16f562c8915610f7a1de4ed07`，文件树与审查/CI 通过的 PR head `44bb39f` 相同。
- 最终 PR CI [34013603694](https://github.com/baisiqi6/DevScope/actions/runs/34013603694)、main CI [34013749122](https://github.com/baisiqi6/DevScope/actions/runs/34013749122) 均成功。
- Deploy [34013772766](https://github.com/baisiqi6/DevScope/actions/runs/34013772766) 成功，head 为上述合并提交。
- SSH 回读 Git HEAD 与 API/Web/Worker 镜像 revision 均为该完整 SHA；服务器工作树干净。三个 rollback 镜像均为 `35cb69d8f635675cbd735a26505816434ff09938`。
- 五个容器均运行，Nginx 与 PostgreSQL 容器 ID 相对部署前一致；`.env` byte-compare 和完整 Nginx 归档差异校验均通过。
- `nginx -t` 成功；loopback API health / Web graph 200；经 SSH 隧道与进程内 Keychain 注入认证后的 graph/health 200，公网未认证 401。
- 生产浏览器读取 63 仓库 / 405 条关系，实际加载 `/_next/static/chunks/375.7642ef651da79696.js`；搜索 TypeScript 后选中面板可见，球体纹理、八面体受光和黑洞图像已目视确认。
- 浏览器运行时：3 个 pass，透镜 enabled=true、当前 count=3，shader 编译错误 0，画布和后处理 target 同为 2268×852。
- 私有原始证据：`.planning/2026-09-05-graph-craft/production-readback.log`、`production-graph.png`；原始截图未上传 GitHub。
- 未执行数据库迁移、图谱重建或数据写入。DF-20260905-001 保留 `fixed_pending_verification`，等待用户对视觉效果反馈，不把技术发布通过等同于审美认可。
