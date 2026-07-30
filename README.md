# SaveSync

SaveSync é uma ferramenta self-hosted para versionar e sincronizar saves de jogos. O backend usa Node.js, Express, SQLite e Chokidar; o painel usa Vue 3; rclone faz o `bisync` com Google Drive e Syncthing compartilha o arquivo de versões via P2P.

## Como os dados são protegidos

- Cada mudança gera um snapshot completo da raiz configurada para o jogo. O caminho que disparou o watcher é apenas metadado.
- O snapshot é copiado para staging e só aparece no histórico depois de um `rename` atômico.
- Restore, watcher e rclone passam por uma fila única de mutações.
- Antes de restaurar, o estado atual vira um snapshot `pre_restore`. A troca usa staging, backup e rollback no mesmo volume.
- O cliente nunca escolhe um caminho de arquivo para restore: a API recebe o `event_id` e resolve o caminho gravado no SQLite.
- Snapshots recebidos por rclone ou Syncthing são validados e indexados no Histórico. Eles não sobrescrevem automaticamente o save ativo; a aplicação é manual.
- Conflitos ficam em quarentena. Escolher a versão remota preserva uma cópia da versão local anterior.

Os snapshots ficam em `SAVESYNC_DATA_DIR/games/<game-id>/<snapshot-id>/`, com `manifest.json` e `payload`.

As fronteiras entre módulos, invariantes, decisões de concorrência e trade-offs estão documentados em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos

- Node.js 22.12 ou mais recente.
- rclone 1.71.0 ou mais recente para Google Drive. A imagem Docker inclui rclone 1.74.3.
- Syncthing opcional.
- JDK 21 e Android SDK apenas para o APK Capacitor.

## Desenvolvimento local

```bash
git clone https://github.com/GaussNoob/SaveSync.git
cd SaveSync
cp config.example.yaml config.yaml
npm ci
npm run dev
```

- Dashboard de desenvolvimento: `http://localhost:5173`
- API: `http://127.0.0.1:3000/api`
- Dashboard compilado: `npm run build && npm start`
- Testes: `npm test`
- Verificação completa: `npm run check`

`config.yaml`, `.env`, bancos SQLite e o arquivo do rclone são locais e não são versionados.

## Segurança da API

Por padrão o backend escuta somente em `127.0.0.1` e não exige token. Para expor o serviço na LAN ou em um container, configure um token aleatório com pelo menos 32 caracteres:

```bash
SAVESYNC_HOST=0.0.0.0
SAVESYNC_API_TOKEN=cole-aqui-um-token-aleatorio-longo
```

É possível gerar um token com Node:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

O painel salva o token em `Configurações > Geral > Token da API` e o envia como Bearer token. Origens adicionais devem entrar em `server.allowed_origins` no `config.yaml`:

```yaml
server:
  host: 0.0.0.0
  allowed_origins:
    - http://192.168.1.50:5173
```

O valor de `SAVESYNC_HOST` prevalece sobre o YAML. Não coloque `SAVESYNC_API_TOKEN` no repositório.

## Configuração

Comece por [config.example.yaml](config.example.yaml). As opções principais são:

```yaml
savesync:
  version_limit: 10
  sync_on_change: true
  notify_desktop: true
  scan_on_startup: true

cloud:
  enabled: false
  remote_name: savesync-gdrive
  remote_path: SaveSync/
  sync_interval_minutes: 5
  on_conflict: keep_both
  max_delete_percent: 10

syncthing:
  enabled: false
  api_url: http://localhost:8384
  folder_id: savesync-folder
  device_ids: []
```

O SaveSync só aceita a API do Syncthing em hosts locais conhecidos. Para um host LAN explícito, use `SAVESYNC_SYNCTHING_HOSTS=host1,192.168.1.20`. A pasta compartilhada é sempre o arquivo gerenciado em `SAVESYNC_DATA_DIR/games`; um caminho arbitrário vindo da API não é aceito.

Novas pastas Syncthing não são compartilhadas automaticamente com todos os dispositivos. Adicione os IDs permitidos em `syncthing.device_ids` ou faça o compartilhamento na UI do Syncthing.

Use `SYNCTHING_API_KEY` para manter a chave fora do YAML. O token OAuth do Google fica em `SAVESYNC_DATA_DIR/rclone/rclone.conf`, com permissão `0600` em Unix. O cache/baseline do bisync fica em `SAVESYNC_DATA_DIR/rclone-cache`.

### Jogos e emuladores personalizados

```yaml
custom_games:
  - name: Meu Jogo
    saves_path: C:/Jogos/MeuJogo/saves
    extensions: [.sav]

emulators:
  - name: Ryujinx
    saves_path:
      windows: "%APPDATA%\\Ryujinx\\bis\\user\\save"
      linux: ~/.config/Ryujinx/bis/user/save
      mac: ~/Library/Application Support/Ryujinx/bis/user/save
    save_type: directory
```

A fonte precisa existir, não pode ser a raiz do disco e não pode conter nem ficar dentro de `SAVESYNC_DATA_DIR`.

## rclone bisync

O SaveSync não usa `--force` e nunca aplica `--resync` automaticamente. Se o estado base não existir, o painel mostrará uma ação separada para reconstruí-lo, com confirmação explícita. Confira antes as duas pontas: `--resync` define um novo baseline e uma escolha errada pode propagar dados indesejados.

O rclone roda sem shell, com argumentos separados, timeout, saída limitada, `--max-delete`, `--check-access` e versão mínima verificada. O marcador de acesso remoto só é criado durante um baseline explicitamente confirmado.

## Docker Compose

Crie um `.env` local:

```dotenv
SAVESYNC_API_TOKEN=um-token-aleatorio-com-pelo-menos-32-caracteres
SYNCTHING_API_KEY=
```

Depois:

```bash
docker compose up --build
```

O compose publica Dashboard e UI do Syncthing apenas em loopback. A pasta `./saves` aparece como `/host-saves` no container; cadastre fontes usando esse caminho. Estado, snapshots e configuração Syncthing usam volumes separados e persistentes.

Para acessar de outro dispositivo, altere conscientemente o mapeamento `127.0.0.1:3000:3000` para `3000:3000`, mantenha o token obrigatório e configure a origem do painel. O fluxo OAuth que abre o navegador é mais simples fora do Docker; em ambiente headless, configure o remote `savesync-gdrive` com `docker compose exec savesync rclone config`.

## Android e Electron

```bash
npm run electron:start
npm run dist:win
npm run android:sync
npm run android:build
```

O APK contém somente o dashboard; o backend continua em um computador ou servidor. No emulador Android, o endpoint padrão é `http://10.0.2.2:3000/api`. Para aparelho físico, informe endpoint/token em Configurações. Fora de uma rede local confiável, coloque a API atrás de HTTPS, VPN ou túnel seguro: um Bearer token enviado por HTTP não é confidencial.

`npm run dist:win` gera um executável portátil x64 em `release/`. O pacote Electron inicia o backend com o runtime Node integrado ao próprio aplicativo; uma instalação externa do Node não é necessária. O binário não é assinado digitalmente, portanto o Windows SmartScreen pode solicitar confirmação na primeira execução.

## Banco e migrações

O SQLite usa WAL, foreign keys, `busy_timeout` e migrações incrementais via `PRAGMA user_version`. Não apague o banco para atualizar o schema. Eventos de save e atualização de `last_save_at` são gravados na mesma transação.

## CI

O workflow executa em Linux e Windows:

- `npm ci`;
- testes Vitest;
- build Vite;
- `npm audit`;
- validação da imagem Docker;
- build do APK Android debug com JDK 21.

Dependabot acompanha npm, Docker e GitHub Actions.
