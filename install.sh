#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.12+ é necessário."
  exit 1
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)" || {
  echo "Node.js 22.12+ é necessário; encontrado $(node --version)."
  exit 1
}

if [[ ! -f config.yaml ]]; then
  cp config.example.yaml config.yaml
fi

npm ci
npm run check
mkdir -p saves

if command -v docker >/dev/null 2>&1; then
  if [[ ! -f .env ]]; then
    token="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
    printf 'SAVESYNC_API_TOKEN=%s\nSYNCTHING_API_KEY=\n' "$token" > .env
    chmod 600 .env
    echo "Token Docker criado em .env. Informe esse token no painel na primeira abertura."
  fi
  docker compose up --build -d
  echo "SaveSync web: http://localhost:3000"
  echo "Syncthing: http://localhost:8384"
else
  if ! command -v rclone >/dev/null 2>&1; then
    echo "rclone não encontrado. Instale uma versão 1.71+ em https://rclone.org/install/"
  fi
  echo "Docker não encontrado. Use npm start ou npm run electron:start."
fi
