#!/usr/bin/env bash

set -u

echo "deploy.sh 已停用：旧脚本会在拉取失败后继续、隐式构建 latest 镜像，且无法安全处理数据库迁移。" >&2
echo "请按照 docs/PRODUCTION_RUNBOOK.md 使用手动触发的部署工作流，并显式确认目标提交、备份和迁移开关。" >&2
exit 1
