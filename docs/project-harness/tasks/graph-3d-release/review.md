# 3D 图谱发布前独立审查

- Verdict: **APPROVE**（代码与发布计划审查；不是生产 closeout）
- Reviewer: `graph_release_reviewer`
- Context mode: `limited-fresh`。以底层视觉/交互目标、当前计划、真实 diff 和必要证据独立判断，未接收前轮 verdict。
- Reviewed HEAD: `17d743d3ba29fa993d03008354c5922b74823c51`
- Compared base: `main` / `35cb69d8f635675cbd735a26505816434ff09938`
- Reviewed packet: `docs/project-harness/current/review-packet.md`
- Packet SHA-256: `727930d5841ddddd605dc42e44ff31da8a5559ebebd32c30aacc192c7a15fe80`
- Canonical plan SHA-256: `bdcdd2c5a44066d44675bf04818af314df1b8eb93137bc87cc258016ca492400`

## 结论与范围

未发现需要阻塞发布的具体缺陷。`main...HEAD` 的六个文件仅涉及 Web 图谱实现、透镜选择测试、架构说明与既有 dogfood 登记册；没有数据库、API、鉴权、凭据或部署机制变更。代码直接回应球体纯色、八面体过量光晕、侧视黑洞退化和搜索不激活焦点的问题，没有加入第二套图谱模型或外部依赖。

## 代码与视觉核验

| 目标 | 当前实现及证据 | 判断 |
| --- | --- | --- |
| 球体与八面体层次 | 程序化颜色/粗糙度、受光材质和一次生成的环境反射，删除全场景 Bloom；四张截图中的球体可见表面变化、八面体轮廓清楚 | 与目标一致 |
| 多视角黑洞 | 相机朝向的观测图像结合固定轨道法线；独立查看 `face-on.png`、`edge-on.png`、`back.png`，侧面保留圆形核心和上下光弧 | 消除了侧视仅剩平面环的主要问题 |
| 搜索与交互 | `handleSearch` 同时设置 `selectedId` 和相机请求；`focusId` 进入材质、邻域和透镜优先级；截图可见 TypeScript 选中详情 | 状态链路一致 |
| 开销与生命周期 | 8 个透镜上限、离屏/亚像素剔除、局部像素早退、重叠取最强、一次场景采样；画布与 composer 像素比上限 1.5；移除 pass、释放环境 target 和各节点材质/标签/环面并取消 rAF | 有明确预算和释放路径 |
| 减少动态效果 | 现有 `useMediaQuery` 驱动 2D 回退；3D 内部冻结时间并关闭透镜；默认 2D 与移动端/WebGL 能力边界保持 | 没有发现新阻塞回归 |

上述截图是作者提供的本地浏览器证据，我独立查看了图像，但没有重新操作浏览器或独立测量帧率。它们支持具体视觉变化，不能代替用户最终审美认可。`DF-20260905-001` 应继续保留待验证状态。

## 验证证据的来源

- 独立执行：`git diff --check main...HEAD` 通过；`corepack pnpm --filter @devscope/web test -- src/lib/graph-black-hole.test.ts` 为 1 file / 3 tests 通过，覆盖预算、焦点优先、离屏及宽窄视口边界。
- 独立只读查询 GitHub：PR #67 head 与上述 HEAD 相同，`quality`、`integration` 均为 `SUCCESS`，CI run `34013295834`。
- 审阅作者原始日志：`.planning/2026-09-05-graph-craft/{lint,typecheck,test,build}.log` 全部成功；lint 18 warning / 0 error，Web 28 tests 通过，Web 构建为新执行。其余包部分使用缓存；Worker 的一个集成测试跳过按原 verification 保留说明。我没有独立重跑四项全仓库门禁。
- 审阅作者 runtime 记录：多视角、主题、视口、动态减少运动、重挂载、3 passes 和 shader 编译错误 0。GPU 采样只证明该设备该窗口的局部成本，不证明稳定 60 FPS。

## 发布与 closeout 边界

canonical plan 使用既有 `deploy.yml`，要求干净工作树、可读备份、精确合并 SHA 和回滚镜像，且 `apply_database_migration=false`、`technology_stack_legacy_cleanup=false`；与 runbook 一致。该计划可继续推进。Reviewer 本轮没有访问生产、修改产品代码或执行 commit/push/merge/deploy。

生产成功、实际备份与回滚 locator、运行 revision、认证 401/200、容器/Nginx/外部请求和生产浏览器证据尚待 Operator 执行并形成 receipt；这些不是本轮已验证事实。本次 approval 不关闭发布 item，最终必须重新审查当前 closeout packet。
