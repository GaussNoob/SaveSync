@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ e necessario.
  exit /b 1
)

npm install
npm run build

if not exist saves mkdir saves
if not exist data mkdir data

where rclone >nul 2>nul
if errorlevel 1 (
  echo Rclone nao encontrado. Instale em https://rclone.org/downloads/ e rode rclone config.
)

where docker >nul 2>nul
if errorlevel 1 (
  echo Docker nao encontrado. Use npm start ou npm run electron:start.
  exit /b 0
)

docker compose up -d
echo SaveSync web: http://localhost:3000
echo Syncthing: http://localhost:8384
