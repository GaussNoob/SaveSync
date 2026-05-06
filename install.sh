#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ é necessário."
  exit 1
fi

npm install
npm run build

mkdir -p saves data

if ! command -v rclone >/dev/null 2>&1; then
  echo "Rclone não encontrado. Instale com: https://rclone.org/install/"
  echo "Depois rode: rclone config"
fi

if command -v docker >/dev/null 2>&1; then
  docker compose up -d
  echo "SaveSync web: http://localhost:3000"
  echo "Syncthing: http://localhost:8384"
else
  echo "Docker não encontrado. Use npm start ou npm run electron:start."
fi
