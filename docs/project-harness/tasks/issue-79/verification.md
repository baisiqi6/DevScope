# Issue #79 验证与生产回执

当前阶段：Task 1 已获独立 `APPROVE`，进入 PR/发布准备；**尚未执行生产 mutation、签发或切换 HTTPS**。本文件由 `https-operator` 维护；实现证据见 [implementation.md](implementation.md)，稳定操作只维护在运行手册。

用户在本轮提供的备案/许可证编号：`粤ICP备2026167321号`（按原文保存，不臆造站点后缀）。页脚公示需要单独 Web 改动/发布，本次仅切换入口，不将其写成已完成，也不为此重建 Web 容器。

## 2026-10-28 生产只读预检

- 目标域名 root/www 的 A 均为现有服务器，未见 AAAA/CAA；HTTP root 返回 `401` 和 DevScope Basic realm，备案拦截消失；HTTPS 尚未建立。
- 生产工作树 clean；HEAD `791ebab9fd68f0e6866631d6450edec78134e660`，三应用运行镜像未变；该 SHA 至本任务 base 的 apps/packages/skills/原 Compose/Nginx 无代码差异。
- 原五容器不变量（部署后必须逐项比对，不以 HTTP 状态代替）：

| 容器 | ID | StartedAt |
| --- | --- | --- |
| nginx | `7702f377210fa0eb1d2cd59e0ea1220bd1eeb7d3ddcbad4713e4f74428cb5365` | `2026-04-24T08:56:10.937700069Z` |
| api | `4ceae942ec7231c84d61339564693d0f61ecb7f9bf0fd377da05bbd8143ab224` | `2026-09-22T03:49:31.515490411Z` |
| web | `15f483e61df26d74d15237398994033d853e705ba11bedb73ca8475f9733cf09` | `2026-09-22T03:49:32.408719464Z` |
| worker | `dcb197638e79b8b76ce1a4136aa7bc11515821f8d8f04016a2773c3d31b24fe1` | `2026-09-22T03:49:31.517568049Z` |
| postgres | `51681c4d439a8132adbcdb601a7628398d30400db61f206eb80c830b91d02a53` | `2026-07-14T07:19:29.398120131Z` |

- 共享请求基线：服务器本机 `http://127.0.0.1/supplier-search/` 与 `http://127.0.0.1/billmapper/` 均为既有 `502`；对应原 `shared-routes.conf` location 仍指向原 upstream。本次不修复或声称这些站点健康；发布前后将保存同 Host/path 的状态及配置摘要一致性。
- 现有 shared Nginx 仅发布 `80:80`，整目录 readonly 挂载 conf.d，现有 auth 文件和目录可读；本轮将不重建该容器。
- 服务器 Docker `29.4.0`、Compose `v5.1.3`、x86_64，磁盘余量约 13 GiB；Docker active，存在 `flock` 和 systemd。
- 正式/staging ACME directory 从生产均返回 `200`；未注册 account 或请求证书。
- SSH tunnel `127.0.0.1:18080 → server loopback:80` running；现有 MCP health 于 `2026-10-28T17:03:53.654Z` 返回 `ok`；只读 list 返回既有仓库 ID 1（采集时间 `2026-10-26T18:00:10.851Z`）。未触发采集或业务写入。

## 本地准备

- 在独立 worktree 安装 frozen-lockfile 依赖成功，未修改 lockfile。
- installed Harness runtime session-init 成功；typecheck/test exit 0，主要复用源文件未变的 Turbo worktree cache；pipeline 测试实时 21/21 通过。不能将缓存日志中的旧 cwd/time 误当本轮重新执行全部包测试。
- Certbot `v5.8.0` 官方 immutable manifest index 已核验并按 linux/amd64 拉取/导出；本地 archive `.planning/certbot-amd64.tar.gz` SHA-256 `35b590627c235e039b0bd701004df7227f078ca58476cac42321c55e1017e5af`，尚未传入生产。
- 主工作树三处他人 Harness 变更原样保留；本任务使用 ignored `.planning/harness-runtime` 执行当前安装协议的 exact-packet gate，无需改动通用 runtime 源码。
- 预检 CLI 首次因 zsh 未引用 `rows=Instances.Instance[]` 被本地 glob 拒绝；引用后实际调用确认现有 `devscope` OAuth refresh 返回 `400`，未取得 ECS 数据或修改云配置。当前签发方案无需 DNS/AccessKey；只有实际验证 443 云侧阻塞时才需要恢复云账号入口。
- HTTPS 尚无 listener 时匿名 TLS 探测仍为 `SSL_ERROR_SYSCALL`。限时、仅针对本次源端口的只读 SYN 观测未建立可靠的 443 放行证据，未据此声称安全组已开放；最终以 TLS edge 启动后的外部连接验证为准。
- 已根据独立计划 review 的边界提醒细化计划：HTTP 域名 server 保留其他项目 shared locations，避免根据“以前域名没放行”推断无人使用；实现/发布前审查将绑定更新后 plan，不复用旧 plan hash 作为新版本批准。
- Task 1 独立实现审查先发现共享请求体继承 P2，Worker 已以 `6a7813c` 修正并用真实 2MiB POST/超过10MiB负向请求验证；Reviewer 复审确认 ADDRESSED。Operator 另指出正常应用发布后的新 TLS upstream 刷新路径缺失，独立审查确认 P1；已更新 plan/brief，并派原 Worker 进行第 2 轮有界修复。仍未进行生产 mutation。
- 新 TLS 镜像由旧候选改为官网当前 stable Nginx 1.30.6：官方 Docker index `sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951`、amd64 manifest `sha256:84ed8c0dd296c188bfc24ed506f46589e9285fb0b11cf3a04d91d524d3067e11`，image 创建日期 2026-10-21；已通过官方 registry 元数据与实际 amd64 pull 核对。本地 archive `.planning/nginx-1.30.6-amd64.tar.gz` SHA-256 `72846f3d97fa27e5b3ed7876600e85f2b89032204f5f7ff9cd3d02d723be8b75`。旧共享 HTTP 镜像不升级、不重建。
- 版本选择参考 [官方下载](https://nginx.org/en/download.html) 与 [安全公告](https://nginx.org/en/security_advisories.html)：避免为新组件选择已不在修复范围的旧版本；没有声称当前共享配置已被攻击或完成漏洞适用性鉴定。其维护窗口不属于本次独立 TLS rollout。

## 尚未完成的门禁

Task 1 最终产品 head `d295c2fb7c32bcbd9ee2e83e1798cd972369ff3f`，独立实现 Reviewer 当前结论 `APPROVE`（见 [审查](code-review.md)）；原 P1/P2 均已关闭。Operator 另亲自执行完整 `pnpm lint/typecheck/test/build` 命令链与新 stable 镜像矩阵，整体 exit0：11 tests / OK，15.675s。日志在 ignored `.planning/operator-{lint,typecheck,test,build,https}.log`；仍为四项 package 任务缓存与实时 pipeline21/21，18既有warnings/1既有skip，不冒称冷跑。生产首装路径及systemd units均不存在，服务器工作树仍clean，复查 HEAD 仍791ebab9。

仍待 whole-branch release review、PR/required checks/merge、生产备份/配置切换、真实证书、外部认证/业务读取、续期 dry-run/timer、容器/共享路径不变量及最终 closeout。不得将此阶段性文件视为发布成功回执。
