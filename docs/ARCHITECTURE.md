# Arquitetura e decisões técnicas

## Visão geral

O SaveSync usa uma arquitetura modular em um único processo Node.js. A separação é feita por responsabilidade:

- **Apresentação:** dashboard Vue, rotas Express e bridge IPC do Electron.
- **Aplicação:** coordenação de sync, watcher, versionamento, conflitos e agendamentos.
- **Políticas de domínio:** validação de caminhos e IDs, integridade de snapshots e regras de retenção.
- **Infraestrutura:** SQLite, filesystem, rclone, Syncthing, WebSocket e notificações do sistema.

As rotas convertem entrada HTTP em comandos da aplicação; regras de integridade e acesso a arquivos permanecem fora delas. Integrações externas são encapsuladas em clientes próprios e o dashboard nunca recebe autoridade para escolher um caminho de archive durante um restore.

No pacote desktop, `electron/main.js` executa o backend em um `utilityProcess`,
escolhe uma porta efêmera e só abre a janela após receber a confirmação de
prontidão. O arquivo de configuração fica no diretório de dados do usuário,
fora do ASAR somente leitura.

O build Windows força a recompilação do `better-sqlite3` para o ABI do Electron
antes de montar o ASAR e restaura o módulo para o ABI do Node.js no final. O
empacotador não executa um segundo rebuild implícito, evitando artefatos
dependentes do estado anterior do `node_modules`.

## Invariantes de dados

1. Cada snapshot publicado contém `manifest.json` e `payload`.
2. O manifesto registra jogo, identidade, tipo, tamanho, contagem de entradas e SHA-256 do payload.
3. O snapshot é construído em `.savesync-staging` e publicado por `rename` no mesmo volume.
4. Um evento de restore é obtido do SQLite por `event_id`; caminhos enviados pelo cliente não são aceitos.
5. Antes do restore, manifesto e payload são revalidados. Um snapshot alterado ou corrompido não toca no save ativo.
6. O estado atual vira um snapshot `pre_restore` antes da substituição.
7. A troca do save usa staging, backup e rollback no diretório de destino.
8. Links simbólicos e fontes que incluem a área de dados do SaveSync são rejeitados.

O filesystem e o SQLite não oferecem uma transação distribuída. Por isso, a publicação segue a ordem “payload durável → registro no banco”. Se o registro falhar, a publicação recém-criada é removida; se essa compensação falhar, a reconciliação consegue indexar o manifesto no próximo ciclo.

## Concorrência

Operações que alteram saves, snapshots, conflitos ou o índice passam por uma fila FIFO única (`sync-coordinator`). Isso evita restore concorrente com archive ou rclone.

O lock cobre somente a seção que precisa de exclusão:

- cópia, restore, rotação e `rclone bisync` permanecem serializados;
- chamadas HTTP ao Syncthing e notificações ficam fora da seção crítica;
- no shutdown, novas conexões são recusadas, timers e watchers são encerrados, a fila é drenada e só então o SQLite é fechado.

O rclone mantém o lock durante o `bisync` porque ele altera o mesmo arquivo de snapshots. O Syncthing apenas recebe uma solicitação de scan; sua replicação continua sendo assíncrona e conflitos são tratados pelo watcher.

## Desempenho e limites

- O watcher e o ciclo periódico usam um fingerprint de metadados da fonte para não criar snapshots idênticos.
- A reconciliação lê apenas o manifesto de snapshots já indexados; hashing completo é reservado para novos snapshots e restores.
- Configuração YAML e sondagens curtas do runtime rclone usam cache com invalidação controlada.
- Linhas do rclone são entregues ao WebSocket imediatamente, mas persistidas no SQLite em lotes.
- O parser VDF usa cursor linear, evitando remoções sucessivas do início de arrays.
- Scans e snapshots têm limite de 100.000 entradas para evitar uso não limitado de CPU, memória e I/O.
- Respostas normais do dashboard têm timeout; operações de snapshot/restore/sync usam limites explícitos maiores.

Snapshots continuam sendo completos por desenho. Isso privilegia restauração simples e independente, mas uma fonte muito grande ainda bloqueia o event loop durante cópia e hashing síncronos. Uma evolução futura deve mover esse trabalho para worker threads e adotar armazenamento incremental endereçado por conteúdo, sem enfraquecer as invariantes acima.

## Segurança

- Loopback é o padrão. Bind externo exige token com pelo menos 32 caracteres.
- HTTP e WebSocket aplicam a mesma proteção contra DNS rebinding e a mesma allowlist de origens.
- O token é comparado em tempo constante e nunca entra em URLs.
- Processos rclone usam argumentos separados, sem shell, com timeout e saída limitada.
- O fluxo OAuth só expõe URLs HTTP de loopback no caminho `/auth`; linhas com credenciais são redigidas antes de logs ou respostas.
- A API do Syncthing aceita apenas hosts explicitamente permitidos e não aceita credenciais na URL.

## Compatibilidade

O formato atual do snapshot é `2`. O campo `source_fingerprint` é opcional e serve apenas para eliminar trabalho duplicado; peers anteriores podem ignorá-lo. Snapshots de formato `1` continuam indexáveis com validação de tipo e tamanho. Migrações do SQLite são incrementais por `PRAGMA user_version`.
