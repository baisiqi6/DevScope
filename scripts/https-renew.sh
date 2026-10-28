#!/usr/bin/env bash
# 由服务器 systemd 或操作者运行；不依赖 Mac/SSH 会话，不读取业务 .env。
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 || ( $# -eq 2 && $2 != --dry-run ) ]]; then
  echo '用法: https-renew.sh /absolute/path/tls.env [--dry-run]' >&2
  exit 2
fi
tls_env=$1
if [[ $tls_env != /* || ! -f $tls_env || ! -r $tls_env ]]; then
  echo 'TLS runtime env 必须是可读文件的绝对路径' >&2
  exit 2
fi
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
# 显式 project/file/env，避免调用者的 COMPOSE_* 指向业务服务。
unset COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_PROFILES COMPOSE_ENV_FILES
unset DEVSCOPE_TLS_NGINX_IMAGE DEVSCOPE_TLS_CERTBOT_IMAGE DEVSCOPE_TLS_CONF_DIR DEVSCOPE_TLS_STATE_DIR DEVSCOPE_TLS_NETWORK
if ! command -v timeout >/dev/null; then
  echo '需要服务器 GNU coreutils timeout；拒绝无超时运行续期。' >&2
  exit 2
fi
compose=(docker compose --project-name devscope-https --env-file "$tls_env" --file "$repo_dir/docker-compose.https.yml")
renew=(renew --non-interactive --cert-name devscope.cn)
if [[ ${2:-} == --dry-run ]]; then
  renew+=(--dry-run)
fi

timeout --foreground 15m "${compose[@]}" --profile certbot run --rm --no-deps certbot "${renew[@]}"
if [[ ${2:-} == --dry-run ]]; then
  echo 'ACME dry-run 完成；未 reload，也未声称真实证书已续期。'
  exit 0
fi
# 即使本轮还不到续期时间，也验证并平滑 reload，只影响独立 TLS edge。
timeout --foreground 30s "${compose[@]}" exec -T https nginx -t
timeout --foreground 30s "${compose[@]}" exec -T https nginx -s reload
