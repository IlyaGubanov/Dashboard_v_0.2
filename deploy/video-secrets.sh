#!/usr/bin/env bash
# Generate missing video secrets once. Never rotate an existing key automatically.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
[[ -f .env ]] || { echo 'Сначала создайте .env из .env.example' >&2; exit 1; }
for name in VIDEO_ENCRYPTION_KEY VIDEO_SERVICE_TOKEN VIDEO_CDN_TOKEN; do
  existing=$(sed -n "s/^$name=//p" .env | tr -d '\r')
  [[ -n "$existing" ]] && continue
  if [[ "$name" == VIDEO_ENCRYPTION_KEY ]]; then
    value=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
  else
    value=$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')
  fi
  if grep -q "^$name=" .env; then
    sed -i "s|^$name=.*|$name=$value|" .env
  else
    printf '\n%s=%s\n' "$name" "$value" >>.env
  fi
done
chmod 600 .env
echo 'Ключ и внутренние токены видеонаблюдения подготовлены. Значения не выводятся.'
