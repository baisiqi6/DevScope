#!/usr/bin/env bash
# 正常应用发布后的定向 upstream 刷新；不签发/续期、不启停或创建容器。
set -euo pipefail

if [[ $# -ne 0 ]]; then
  echo '用法: https-reload-if-present.sh（固定目标 devscope-https）' >&2
  exit 2
fi
if ! command -v timeout >/dev/null; then
  echo '需要服务器 GNU coreutils timeout；拒绝无超时查询或 reload。' >&2
  exit 2
fi
docker_bounded=(timeout --foreground 30s docker)
# 先成功查询所有状态，才允许把空结果解释为未安装；daemon 错误非零传播。
edge=$("${docker_bounded[@]}" container ls --all --filter 'name=^/devscope-https$' --format '{{.Names}}')
if [[ -z $edge ]]; then
  echo '未安装 devscope-https，跳过独立 TLS reload。'
  exit 0
fi
if [[ $edge != devscope-https ]]; then
  echo 'TLS 容器查询结果与固定名称不一致，拒绝 reload。' >&2
  exit 1
fi
running=$("${docker_bounded[@]}" inspect --format '{{.State.Running}}' devscope-https)
if [[ $running != true ]]; then
  echo 'devscope-https 已安装但未运行，发布失败；不自动启动。' >&2
  exit 1
fi
"${docker_bounded[@]}" exec devscope-https nginx -t
"${docker_bounded[@]}" exec devscope-https nginx -s reload
