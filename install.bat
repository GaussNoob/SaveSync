@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.12+ e necessario.
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number);process.exit(major^>22 ^|^| (major===22 ^&^& minor^>=12) ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 22.12+ e necessario.
  exit /b 1
)

if not exist config.yaml copy /y config.example.yaml config.yaml >nul

call npm ci
if errorlevel 1 exit /b 1
call npm run check
if errorlevel 1 exit /b 1
if not exist saves mkdir saves

where docker >nul 2>nul
if errorlevel 1 (
  where rclone >nul 2>nul
  if errorlevel 1 echo rclone 1.71+ nao encontrado. Instale em https://rclone.org/downloads/
  echo Docker nao encontrado. Use npm start ou npm run electron:start.
  exit /b 0
)

if not exist .env (
  for /f "delims=" %%T in ('node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"') do set "SAVESYNC_GENERATED_TOKEN=%%T"
  >.env echo SAVESYNC_API_TOKEN=%SAVESYNC_GENERATED_TOKEN%
  >>.env echo SYNCTHING_API_KEY=
  echo Token Docker criado em .env. Informe esse token no painel na primeira abertura.
)

docker compose up --build -d
if errorlevel 1 exit /b 1
echo SaveSync web: http://localhost:3000
echo Syncthing: http://localhost:8384
