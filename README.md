# SaveSync

SaveSync e uma ferramenta self-hosted poderosa projetada para sincronizar automaticamente saves de jogos de PC e emuladores. O projeto resolve o problema da fragmentacao de saves locais, garantindo uma integracao fluida tanto via P2P (ponto-a-ponto) quanto em provedores de nuvem (como o Google Drive). 

O foco do SaveSync e atuar de forma invisivel no plano de fundo. O PC principal atua como host, mantendo os arquivos atualizados em todas as suas maquinas e nuvem, protegendo contra perda de progresso com um sistema proprio de versionamento local e resolucao de conflitos.

---

## 1. Arquitetura do Sistema

O SaveSync opera dividindo a arquitetura em tres camadas centrais:

- **Backend / Daemon (Node.js + Express):**
  - O motor principal responsavel por orquestrar todo o fluxo. 
  - Utiliza `chokidar` para observar alteracoes em diretorios de saves em tempo real.
  - Mantem um banco de dados local (`better-sqlite3`) para registrar historicos, eventos de sincronizacao em nuvem e gerenciar a fila de dados.
- **Camada de Sincronizacao (P2P + Nuvem):**
  - **Syncthing:** Utilizado como motor para sincronizacao local ponto-a-ponto entre diferentes PCs ou dispositivos moveis de forma direta e descentralizada. O backend consome a API REST do Syncthing para coletar status e estados de erro.
  - **Rclone:** Utilizado como motor de integracao com a nuvem. O SaveSync utiliza o recurso `rclone bisync` para sincronizar os dados em mao-dupla com provedores remotos. A autorizacao com plataformas como Google Drive e gerida inteiramente de forma transparente pelo proprio servidor do SaveSync.
- **Frontend (Vue 3 + Vite):**
  - Um painel de controle (Dashboard) hospedado internamente. Ele e construido com Vue.js 3 e se comunica via API REST e WebSockets com o backend, oferecendo uma visao moderna para gestao de conflitos, historico e configuracoes de nuvem.

---

## 2. O Que o Sistema E Capaz de Fazer

O SaveSync e projetado para oferecer tranquilidade e automacao. Suas principais funcionalidades sao:

* **Monitoramento Ativo (Watchers):** Ao detectar que um arquivo de save mudou, ele faz backup local automatico, registrando aquele timestamp.
* **Backup e Versionamento Seguro:** O sistema mantem um limite personalizavel de "versoes" antigas de um save (por padrao 10). Assim, se o seu jogo corromper o arquivo mais recente, voce pode restaurar uma versao antiga a partir do dashboard.
* **Desativacao do Steam Cloud:** Se o jogo estiver sob tutela do Steam Cloud, existe grande risco de conflitos. O SaveSync sabe ler arquivos `.vdf` do Steam e oferece a possibilidade de desabilitar a nuvem do Steam daquele jogo especifico para focar 100% no motor do SaveSync.
* **Resolucao Inteligente de Conflitos:** Ao encontrar duas modificacoes simultaneas no mesmo save (ex: jogou no PC e no Notebook offline, e depois conectou ambos), o SaveSync coloca o arquivo conflitante em quarentena. O Dashboard permite que o usuario escolha ativamente qual versao deseja manter a partir de metadados como tamanho e data de modificacao.
* **Automacao OAuth com Google Drive:** Integracao nativa. O usuario pode abrir o painel em `Configuracoes -> Nuvem`, solicitar para conectar o Google Drive, e o servidor abrira automaticamente o consentimento no navegador. Sem necessidade de gerenciar chaves complexas de API.
* **Varredura e Deteccao de Jogos:** Ao ser iniciado, o sistema usa uma base de dados local (`known-games.json`) contendo dezenas de jogos populares e estruturas tipicas para encontrar os saves no computador automaticamente.

---

## 3. Instalacao e Uso Basico

### Requisitos
- Node.js 20+
- Rclone (detectado automaticamente se instalado globalmente ou em ~/.local/bin)
- Syncthing (opcional, para P2P)
- Android SDK + JDK 21+ para gerar APK Android

### Iniciar o Projeto em Modo de Desenvolvimento
O projeto contem scripts utilitarios que iniciam de forma concorrente o backend e o front-end:

```bash
npm install
npm run dev
```

* Backend / API: estara operando em `http://localhost:3000`
* Dashboard / UI: estara disponivel em `http://localhost:5173`

### Build para Producao
Para gerar os arquivos minificados do dashboard, utilize:

```bash
npm run build
```
Isso exportara os arquivos estaticos do Vue, que passarao a ser servidos diretamente pelo backend Node.js (na porta 3000).

### Build Android
O app Android usa Capacitor e empacota o dashboard Vue dentro de uma WebView. O backend Node.js continua rodando no computador host ou em um servidor acessivel pela rede.

```bash
npm run android:sync
npm run android:build
```

O APK debug sera gerado em `android/app/build/outputs/apk/debug/app-debug.apk`.

Para testar direto em um emulador conectado:

```bash
npm run start
npm run android:run
```

Em emuladores Android, o dashboard usa `http://10.0.2.2:3000/api` por padrao para alcançar o backend rodando no computador. Em Genymotion, dispositivos fisicos ou backends remotos, ajuste o endpoint em `Configuracoes -> Android e rede`.

Se o Gradle reclamar de `invalid source release: 21`, instale um JDK 21+ e rode novamente com `JAVA_HOME` apontando para ele.

---

## 4. Onde Editar e Configurar o Sistema

O principal ponto de interacao do usuario avancado com o SaveSync e o arquivo `config.yaml`, localizado na pasta raiz do projeto. 

As definicoes neste arquivo sobrepoem o comportamento padrao do backend. Todas as alteracoes salvas nele sao refletidas automaticamente sem precisar reiniciar o app.

### Estrutura do `config.yaml`

#### `savesync` (Configuracoes globais)
- `version_limit`: Define quantas versoes de historico de save de um mesmo jogo ficarao armazenadas (padrao: 10).
- `sync_on_change`: Se habilitado, inicia processos de sincronizacao (nuvem/p2p) logo apos perceber modificacoes (com um debouncer de seguranca).
- `scan_on_startup`: Define se o sistema deve procurar ativamente pelos jogos detectados ao ser inicializado.

#### `cloud` (Sincronizacao em Nuvem via Rclone)
A UI edita esse bloco diretamente atraves da API, mas caso prefira gerenciar no arquivo:
- `enabled`: Define `true` ou `false` se a sincronizacao de nuvem esta ativa.
- `provider`: Provedor configurado (ex: `google_drive`).
- `remote_name`: Nome do "Remote" salvo internamente na configuracao do Rclone. Recomendamos nao mudar a menos que gerencie o Rclone por fora.
- `sync_interval_minutes`: Frequencia com a qual o daemon verifica silenciosamente a nuvem buscando novos saves de fora (padrao: 5).

#### `syncthing` (Sincronizacao P2P)
- `api_url`: Endereco onde o motor daemon do syncthing esta escutando.
- `api_key`: Chave obrigatoria gerada na configuracao original do Syncthing para que o SaveSync consiga interagir.

#### `custom_games` (Jogos Manuais)
Array de definicoes de jogos inseridos fora da varredura automatica. Exemplo:
```yaml
custom_games:
  - name: Meu Jogo Desconhecido
    saves_path: C:/Caminho/Absoluto/Para/O/Save
    extensions:
      - .sav
```

#### `emulators` (Varredura de Emuladores)
Array semelhante a `custom_games`, usado especificamente para organizar emuladores. O SaveSync ja inclui deteccao padrao para RetroArch, Dolphin, Yuzu, Eden, Ryujinx, Cemu, PCSX2, RPCS3, MAME, DeSmuME, melonDS, PPSSPP, SNES9x e VisualBoyAdvance.

Cada `saves_path` ou `states_path` pode ser uma string simples, uma lista de caminhos ou um objeto por plataforma (`windows`, `linux`, `mac`). Quando uma lista e usada, o primeiro caminho existente no computador e usado:

```yaml
emulators:
  - name: Ryujinx
    saves_path:
      windows: "%APPDATA%\\Ryujinx\\bis\\user\\save"
      linux:
        - ~/.config/Ryujinx/bis/user/save
        - ~/.var/app/org.ryujinx.Ryujinx/config/Ryujinx/bis/user/save
      mac: ~/Library/Application Support/Ryujinx/bis/user/save
    extensions: []
    save_type: directory
```

---

## 5. Como Adicionar Regras ou Deteccoes Customizadas

### Adicionar Suporte Automativo a Novos Jogos
Se desejar que o SaveSync passe a achar automaticamente um determinado jogo em PCs diferentes, voce devera editar o arquivo `/server/known-games.json`. 

Esse arquivo contem um dicionario JSON, onde cada entrada suporta os metodos especificos da API da Steam, GOG, Epic Games ou pasta Documentos tradicional para mapear caminhos.

### Como Modificar o Banco de Dados
Todo o esquema SQLite e inicializado pelo arquivo `server/db.js`. O arquivo `savesync.sqlite` (ou localizado dentro da pasta oculta apontada pela variavel de ambiente `SAVESYNC_DATA_DIR`) armazena os jogos mapeados. Para zerar o banco ou ajustar tabelas, gerencie diretamente esses arquivos.

---

## 6. Logs e Manutencao
- O sistema intercepta o stdout de processos externos (como as rotinas `bisync` do rclone) e as re-transmite via WebSocket, permitindo que a visualizacao em tempo real seja feita por dentro do painel `Configuracoes -> Nuvem` do dashboard.
- Arquivos problematicos sem permissao de leitura (Comum no Windows Store Apps) apenas reportam um "warn" ou pulam a execucao, para garantir que o fluxo principal nunca parete. Acesso privilegiado ao processo do Node.js permite a contornar problemas de permissoes restritas nos saves.
