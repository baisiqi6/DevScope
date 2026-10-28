# Issue #79 验证与生产回执

当前阶段：HTTPS、HTTP跳转、认证与自动续期已完成生产验证，独立生产closeout已APPROVE，Harness item已done。本文件由 `https-operator` 维护；实现证据见 [implementation.md](implementation.md)，稳定操作只维护在运行手册。

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
- SSH tunnel `127.0.0.1:18080 → server loopback:80` running；现有 MCP health 于 `2026-10-28T17:03:53.654Z` 返回 `ok`；只读列表返回已有数据。未触发采集或业务写入，不在公开回执列出用户收藏身份字段。

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

## 本地完成时的阶段门禁（历史快照）

Task 1 最终产品 head `d295c2fb7c32bcbd9ee2e83e1798cd972369ff3f`，独立实现 Reviewer 当前结论 `APPROVE`（见 [审查](code-review.md)）；原 P1/P2 均已关闭。Operator 另亲自执行完整 `pnpm lint/typecheck/test/build` 命令链与新 stable 镜像矩阵，整体 exit0：11 tests / OK，15.675s。日志在 ignored `.planning/operator-{lint,typecheck,test,build,https}.log`；仍为四项 package 任务缓存与实时 pipeline21/21，18既有warnings/1既有skip，不冒称冷跑。生产首装路径及systemd units均不存在，服务器工作树仍clean，复查 HEAD 仍791ebab9。

本地完成时尚待 whole-branch release review、PR/required checks/merge与生产各项门禁；后续实际执行见下文，不能用本地/CI结果代替它们。

## PR 与发布前提交核验

- [PR #80](https://github.com/baisiqi6/DevScope/pull/80) 已获 whole-branch 独立 `APPROVE`；required CI [40740514866](https://github.com/baisiqi6/DevScope/actions/runs/40740514866) 的 quality（2m18s）与 integration（57s）均成功。
- PR于 `2026-10-28T18:01:27Z` merge，合并/目标 SHA `e577c1e9eb9045ed74a1ed725516d1f19564a810`；remote main 读回相同。任务 head `3bf09a30fa3641b0c8eb2b28df55844e581ab4bb` 与合并目标 tree 无差异，精确 bundle 从 remote main ref 生成，不从脏主树复制文件。
- 四 SHA 分开核验：PR merge=e577c1e9；本地 canonical main=5b3f8420（旧缓存，三处他人修改保留）；remote main=e577c1e9；生产初始 HEAD=791ebab9（后续备份脚本再次断言）。本次不把旧主树当发布源。
- bundle SHA-256 `753d77b4fd6bda82e15492faeda0c8d9e1af077c94e5f832c61f9ce3670314cb`。只有 source/镜像校验、祖先与干净工作树 gate通过后，生产才允许 fast-forward；不触发常规应用重建 workflow。此时仍未签发或切换公网 HTTPS。

## 生产开始：备份与离线导入

- `/home/devscope/backups/devscope/pre-https-20261028-issue79/config.tar.gz` 已创建，目录700/archive600，gzip与tar可读检查成功；包含原.env/Nginx/原Compose，未输出凭据或复制到本机。原五容器ID/StartedAt均精确断言通过；无并行deploy run。
- staging `/home/devscope/deploy-staging/https-issue79-20261028` 已接收bundle与两镜像archive；三项checksum均OK，bundle完整且target/祖先核验通过。
- 首次bootstrap在“校验离线导入后的 registry@index 引用”处安全停止：Docker load只导入了已核验amd64 manifest ID，没有保留原registry/index别名。此时尚未fast-forward服务器、创建TLS配置或reload，只有可回收镜像与Git staging ref新增。
- 有界恢复选择：runtime env固定到同一官方平台manifest内容ID（Nginx `sha256:84ed8c0dd296c188bfc24ed506f46589e9285fb0b11cf3a04d91d524d3067e11`，Certbot `sha256:398c47284a6d6782825be71685f677ef3a1e65b8b5c278a8b1e99f6da84b4eb9`），逐一核验amd64。添加仅本任务的版本别名保留one-shot Certbot镜像，避免未来常规image prune把无tag镜像清走；运行仍按不可变ID，不改global latest、不执行公网pull、不修改任何原服务image/tag。
- 恢复后于 `2026-10-28T18:07:52Z` fast-forward与HTTP bootstrap完成，服务器HEAD=e577c1e9；protected-files校验.env、nginx main、shared-routes、auth conf、htpasswd与原两Compose全部OK。原五容器ID/image/StartedAt与备份相同，只对共享HTTP做 `nginx -t → reload`。
- 两域名从外部实际读取本轮各自token均200且正文精确，missing token404，主页仍401；没有发送公网HTTP凭据。服务器实际 one-shot `certbot --version`=5.8.0、`nginx -v`=1.30.6，证明平台内容ID可由独立Compose解析运行。未启动正式TLS edge，staging CA证书不会用于公网。
- staging 两域名签发成功，state与正式目录隔离。正式首次签发因 www 的 secondary validation 查询 CAA 得到 SERVFAIL 而失败，没有证书部署或HTTP redirect。随后分别检查本机/生产递归解析、dns9/dns10.hichina.com 权威查询、Google DoH（Status0/NOERROR、无CAA、ADfalse）均正常；A/NS未改动。依据明确的新诊断证据做一次有界正式重试，不弱化CAA/TLS或盲目改DNS。DNS侧错误与本地HTTP token/auth成功分开记录。
- Cloudflare DoH同样Status0/NOERROR；正式第2次签发成功，证书覆盖root/www，到期2027-01-26；未修改DNS或使用替代CA。证书state仍只在服务器；staging与正式账户/证书目录分离。下一阶段才启动公网TLS并验证可信链，不以签发成功替代实际加载成功。
- 首次以 `ssh bash -s` 发送启动脚本时，前置 `compose run nginx -t` 消耗了余下stdin，检查exit0却没有执行后续up；外部TLS实际探测ECONNRESET，服务器也没有443 listener。因此未把该exit0误判为启动成功，且尚未读取认证凭据或启用redirect。恢复为传输独立脚本文件执行，并为compose run显式 `</dev/null`，之后仍需实际容器/监听/外部TLS证据。
- `2026-10-28T18:19:17.920730966Z` 独立 TLS container `b679c7a2e9a0831319b567ecae2dc754e40cb3129b0c4373fefed8080dcf8bb4` 实际启动，image为批准的amd64 `84ed8c0d...`，只发布443；旧五容器不重建。
- 从外部实际握手 root/www 均为受信任 `TLSv1.3`，issuer `Let's Encrypt YE2`，SAN同时含两域名，线上指纹与磁盘一致 `52:90:1E:C0:AF:6C:6F:3E:57:F5:BA:9D:48:F0:27:ED:7F:3E:10:F9:79:CE:96:DA:CC:9E:C3:A9:0C:97:16:6A`；validTo `2027-01-26T17:17:17Z`。未关闭TLS校验。
- 两域名各5类未认证路径均401；只有这些可信TLS/负向检查成功后，才在本机私有进程从Keychain注入已有认证。两个域名的首页200、client health=ok、只读列表schema通过且非空；各自页面实际引用的17个静态资源均200。凭据/认证头未输出、未写文件、未经公网HTTP发送；未触发业务mutation。证书签发、实际上线与业务读取分别验证。
- `2026-10-28T18:22:39Z` 在上述验证后才安装精确域名 HTTP server，`nginx -t → reload` 成功。外部 root/www 的首页、tRPC（带query）及SSE路径均308到同域同path/query的HTTPS；HTTP ACME token仍200，两个域名下BillMapper共享path保持502且无Location，不被导向TLS Web。旧tunnel匿名仍401而非redirect。
- redirect安装后再次cmp原五容器 `.Id/.Image/.State.StartedAt` 与备份完全相同；protected-files中原.env/Nginx main/shared/auth/hash/原Compose全部OK。两原共享站点依然是基线502，不能据此称它们健康；配置及请求归属保留。

## 自动续期与最终运行审计

- 服务器执行正式 wrapper `https-renew.sh ... --dry-run` 成功：两域名完整模拟renewal通过，输出all simulated renewals succeeded；没有替换正式证书或reload。过程存在Certbot主动随机延迟360.520秒，已从仅该类日志行核对，不是无响应或超时。
- 安装并启用 scoped systemd service/timer：以`devscope:devscope`、Docker附加组运行；首次普通service于`2026-10-28T18:29:31Z`启动、18:29:37Z成功结束，`Result=success`、`ExecMainStatus=0`。本次证书未到期、No renewals were attempted；实际完成了`nginx -t → reload`，不能称已发生真实换证。
- timer为`enabled / active / waiting`，服务器timezone实际Asia/Shanghai；下一次计划`2026-10-29T04:27:15Z`（服务器12:27:15 CST）。本文件使用UTC记录机器事实，不把服务器时区当用户时区。schedule每日两次+随机延迟，独立于Mac/SSH登录。
- systemd-analyze verify通过；仅返回既有Alibaba cloudmonitor单元的KillMode/PIDFile弃用告警，未修改该无关服务。TLS runtime config目录700、env600、state目录700；unit文件644。Certbot保留本任务版本tag，避免未运行镜像被普通prune删除。
- 最终权限实测发现install创建叶子目录时，两个state根目录仍是中间目录默认755（私钥/账户本身未公开）；已只将本轮正式/staging两个根目录收紧为700，并更新runbook显式先创建根目录，不递归修改任何其他目录。私钥只核对target权限/owner，不读取内容。
- `2026-10-28T18:33:05Z` 生产实际执行`https-reload-if-present.sh`成功，只校验/reload新TLS edge；其container ID/StartedAt仍b679c7a2.../18:19:17Z。原五容器ID/image/StartedAt继续与备份相同。
- 对127.0.0.1、原IP、root、www四种Host分别读取两个共享path，8组请求状态与备份逐字cmp相同；protected-files全部OK，原Compose各服务running、PostgreSQL healthy；内部API health=ok、Web200。未迁移或直改业务库。
- 两条本轮公开测试token已从webroot移动到本轮受保护备份，不删除任何用户数据/证书/账户；Certbot one-shot无残留container，正式TLS仍running/restart0；服务器HEAD=e577c1e9，工作树clean。
- timer和定向reload之后，外部最终复测再次验证两域名受信任TLSv1.3/同一正式指纹、10类未认证401、认证首页200、各17静态资源200、真实仓库可读；另通过实际client base `/api`验证前端同源`/api/trpc` health=ok，不存在HTTP绝对后端/mixed-content切换。脱敏JSON输出仅保留ignored `.planning/live-https-final.log`（无凭据/认证头）。
- 现有MCP tunnel health于`2026-10-28T18:24:28.194Z`仍ok；未改用户宿主机MCP配置。未单独执行已登录浏览器GUI渲染回归（本轮无UI改动），不以HTML/API成功冒充全站GUI验收。
- 后续独立范围：备案号页脚公示、旧共享HTTP镜像维护/两既有502站点、未来真实到期换证/外部失败告警不由本轮成功证明；后续任务不得据本次TLS授权直接变更其他项目。

## 独立 closeout 与归档

- [生产终审](production-review.md)独立复核现场TLS/401/308、dry-run白名单日志、systemd实际执行、timer、权限与隔离不变量后APPROVE，无P0–P3。
- Reviewer实际阅读closeout packet SHA-256 `5d40ca9c41f3281f8ff82eaf7d834deb7695a9c760ffe67fc428e27684ba6587`，source plan SHA-256 `2d6e11a63f08d0f3a24073c9b9d6acf475486ea80e2be88ae0847a44226ac586`；approval后plan/packet未改动。
- Operator于`2026-10-28T18:46:57Z`通过installed runtime `mark-done`成功，CLOSE event `evt-20261028T184657Z-306cbb2d`；item done、lease释放、current pointer清空，state从source重新派生。仅文档/receipt归档PR后续合入，不再次部署或重建服务。
- 归档后的公开回执只保留运维/契约结果，不列用户收藏的名称、DB ID、note或采集时间；详细读取证据保留在ignored安全日志/当前授权诊断上下文，不作为产品数据导出。
