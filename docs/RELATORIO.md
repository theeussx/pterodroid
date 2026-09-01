# Relatório — Backups

Continuação do trabalho documentado em `RELATORIO.md`. Esta rodada partiu de
uma auditoria completa do repositório recebido (backend inteiro, frontend
inteiro, os 163 testes existentes) e focou em três frentes: bugs reais
encontrados na auditoria, funcionalidades que existem no painel oficial do
Pterodactyl e ainda faltavam aqui, e fricções de uso — sobretudo em celular.

Tudo abaixo foi validado rodando de verdade (`npm test`, build do frontend,
subir o servidor com o build embutido), não só lido no código.

## 1. Bugs corrigidos

**Favicon de 5,2 MB.** `favicon.svg` era um SVG com uma imagem raster
embutida em base64 — carregava em toda página, pesado especialmente em rede
móvel. Trocado por um `favicon.png` gerado a partir do logo (94 KB) e um
`apple-touch-icon.png` (52 KB) para quem adicionar o painel à tela inicial.

**Edição de banco de dados inacessível pela interface.** O backend já tinha
`PUT /api/databases/:id` pronto (pensado para corrigir conflito de porta sem
perder o diretório de dados provisionado) e o `DatabaseFormModal` já tinha
toda a lógica de modo-edição (`isEdit`) — só nunca foi ligado a nada. Faltava
a função no `api.js` do frontend e um botão em algum lugar. Adicionado botão
de editar no card da lista e no modal de detalhes; o campo de usuário
continua bloqueado em modo edição de propósito (renomear ali não renomeia o
usuário de verdade dentro do MySQL/Postgres, só a nossa cópia local — isso já
estava certo no modal, só não era alcançável).

**Log ao vivo do MySQL/MariaDB provavelmente mudo.** O driver redirecionava
`--log-error` para um arquivo com um comentário explicando que isso evitava
"entupimento do pipe". Só que o pipe já é consumido continuamente pelo
`dbInstanceManager` (`stdio: ['ignore','pipe','pipe']` com handlers de
`data`) — não havia risco de back-pressure a evitar, e o único efeito real
era silenciar a aba de logs do painel para instâncias MySQL. Removido, para
ficar consistente com o driver do PostgreSQL (que nunca teve esse problema).

**Título da página "Arquivos".** Faltava uma entrada no mapa de títulos do
`Layout.jsx` — a página funcionava normalmente, só o cabeçalho mostrava
"Pterodroid" em vez de "Arquivos".

**`pterodroid.png` era um JPEG disfarçado.** Mesmo conteúdo de
`frontend/public/images/logo.jpg`, só que com a extensão errada. Recodificado
como PNG de verdade e redimensionado (era exibido em 200×200 no README; não
precisava dos 1254×1254 originais).

**`smoke-test.sh` nunca reportava falha de verdade.** Este eu encontrei ao
escrever os testes novos de backup: o script tinha `pass()`/`fail()`, mas
`fail()` só imprimia a linha — não incrementava contador nenhum nem afetava
o código de saída do processo. Ou seja, `run-all.sh` podia mostrar
"✅ Todas as suítes passaram" mesmo com asserções de verdade falhando lá
dentro, contanto que o script não travasse. Corrigido com um contador de
falhas e `exit $FAILURES` no final.

## 2. Funcionalidade nova: Backups

O painel oficial do Pterodactyl tem uma aba de Backups por servidor; aqui não
existia nada (nem rota, nem tabela, nem UI). Construída em cima do que já
existia e já era testado — sem reinventar compactação:

- `backupManager.js` (novo) usa o mesmo `fileManager` da aba Arquivos (mesma
  proteção de caminho) e o mesmo `archiveManager` do compactador de arquivos
  (mesmos limites contra zip bomb / zip slip).
- Fica salvo fora de `WORKSPACES_ROOT`, numa pasta própria
  (`data/backups/service-<id>/`) — um backup nunca pode acabar incluído
  dentro de si mesmo.
- Limite de 10 backups por serviço (configurável via `MAX_BACKUPS_PER_SERVICE`
  no `.env`), mesmo espírito do limite que a maioria dos provedores usa.
- **Restaurar sobrescreve só o que existe no backup** — arquivos criados
  depois do backup e que não estavam nele não são apagados. Foi uma escolha
  consciente: um "restaurar" que apaga tudo primeiro é mais fiel ao
  Pterodactyl, mas é um risco maior de perda de dados silenciosa num painel
  pessoal. A interface deixa esse comportamento explícito antes de confirmar.
- Rotas em `/api/services/:id/backups` (GET lista, POST cria, GET
  `/:id/download` baixa, POST `/:id/restore` restaura, DELETE `/:id` apaga).
  Apagar um serviço agora também apaga os backups dele (arquivo + registro).
- Nova aba "Backups" dentro do modal de cada serviço.
- Testado de ponta a ponta contra um servidor real em `smoke-test.sh`: cria,
  lista, respeita o limite, baixa um `.zip` válido de verdade, restaura e
  confirma que o conteúdo original volta, apaga, e confirma que a pasta some
  do disco quando o serviço é removido.

## 3. Funcionalidades restauradas/completadas

**Uso de disco por serviço.** A função `usage()` já existia em
`workspaceManager.js` mas não era chamada em lugar nenhum. Agora tem um
endpoint dedicado (`GET /api/services/:id/disk-usage`, com cache de 20s) —
fica de fora do `GET /:id` de propósito, porque a varredura é síncrona e não
deveria rodar toda vez que a lista de serviços atualiza, só quando a aba
"Visão Geral" é aberta.

**Aba Arquivos liberada antes do primeiro start (serviços Docker).** Ela
dependia de `container_id` existir, mas o gerenciamento de arquivos opera
direto na pasta do host (`working_directory`, montada em `/app`), sem
precisar do container. Essa checagem nunca fez sentido para Arquivos — só
fazia sentido para o Terminal, que de fato usa `docker exec`. Agora dá pra
enviar os arquivos do projeto antes mesmo de iniciar o serviço pela primeira
vez, que é o fluxo mais natural.

## 4. Usabilidade

**Variáveis de ambiente.** Eram um textarea de JSON cru — funcional, mas
nada amigável no celular (aspas, chaves, vírgulas fora de lugar quebravam
tudo silenciosamente até tentar salvar). Agora são campos de nome/valor,
como já existia para volumes Docker, com um "Modo avançado (JSON)" opcional
para quem preferir editar o texto direto. Compatível com serviços já
existentes: se o JSON salvo não for um objeto simples, abre no modo avançado
em vez de arriscar perder algo que a interface simples não sabe representar.

**Conexão de banco de dados.** O modal de detalhes agora tem botões de
copiar para host:porta e usuário, em vez de só mostrar o texto.

## 5. O que ficou de fora, de propósito

- **`npm audit`** aponta o `react-router-dom` (correção existe, mas exige
  major 7.x — risco de quebra sem um ciclo de teste dedicado) e o `esbuild`
  do Vite (só afeta o servidor de desenvolvimento, não o build de produção).
  Nenhum dos dois foi forçado nesta rodada, pelo mesmo motivo que o `multer`
  ficou de fora da rodada anterior: não misturar upgrade de dependência
  quebrando API com correção de bug.
- **2FA e log de atividade centralizado** (hoje o log de auditoria só
  aparece dentro da aba Arquivos, mesmo cobrindo login/terminal/arquivos)
  ficam como boas próximas frentes, mas não estavam quebrados nem
  bloqueavam o uso — ficaram fora para manter esta rodada focada.

## 6. Testes

`npm test` (163 testes originais + a nova bateria de backups) passando, mais
o build de produção do frontend (`npm run build`, 1646 módulos, sem erros).
O `.zip` final foi extraído numa pasta limpa, com `npm install` do zero e o
servidor subindo com o build embutido, para garantir que o que está sendo
entregue funciona exatamente como o usuário vai receber — não só na pasta de
trabalho onde foi editado.

## 7. Configuração inicial de serviços e suporte a TypeScript

Nesta rodada, a criação e edição de serviços ganhou uma camada de setup inicial
persistente e opcional, acessível diretamente no painel. O usuário pode
configurar, a qualquer momento, os campos abaixo sem precisar re-criar o
serviço:

- repositório Git e branch;
- arquivo principal (`main_file`), com suporte a caminhos relativos e comandos
  completos como `node .`;
- pacotes Node para instalação automática em background;
- argumentos de execução, auto-update e permissões de upload.

No backend, o fluxo de bootstrap passou a:

- semear um projeto Node inicial com `package.json`, `tsconfig.json` e
  `src/index.ts` quando o workspace ainda não existe;
- inferir o comando de inicialização de forma mais robusta para projetos
  TypeScript e JavaScript;
- rodar `git clone`/`npm install` em sessões de terminal paralelas, sem
  travar o request HTTP do painel.

Também foram corrigidos os problemas que causavam falha ao salvar a
configuração inicial, como o `ReferenceError` durante `PUT /api/services/:id` e
o uso indevido de caminhos absolutos como `/src/index.ts`.

## 8. Estado da auditoria (o que foi fechado)

A tabela abaixo cruza os problemas registrados em `docs/AUDITORIA.md` com o
código entregue nesta revisão. “Fechado” significa que há uma correção no
código e/ou na interface; a validação contra binários e ambientes externos que
não estavam disponíveis continua separada na seção 9.

| Área | Itens | Fechamento no código atual |
|---|---|---|
| **Workspaces** | P1–P4 | `config.js` cria `DATA_ROOT`, `WORKSPACES_ROOT`, `FILES_ROOT` e `BACKUPS_ROOT` no boot. `WORKSPACES_ROOT` é a raiz canônica, `FILES_ROOT` aponta para ela por padrão, e `workspaceManager` concentra slugificação, normalização e criação dos diretórios. Caminhos legados como `/home/appuser/projects` são remapeados, não usados como destino novo; workspaces removidos por fora são recriados sob demanda. |
| **Arquivos e upload** | P5–P11 | O `fileManager` valida travessia, caminhos absolutos, symlinks e nomes; gravações criam os pais e são atômicas. Uploads usam uma área temporária dentro da raiz, criam o destino, renomeiam sem sobrescrever (`arquivo (2).ext`) e limpam restos de falha. `fileRoutesFactory` fornece listagem, leitura, escrita, criação, renomear, mover, copiar, busca, download, upload e auditoria tanto para a área global quanto para o serviço; os ramos/imports mortos da implementação anterior foram removidos. |
| **Processos** | P12–P17 | `restoreAll()` separa processos locais de serviços Docker e usa `desired_state`. Saídas `exit` e `error` passam pelo mesmo `finalize`, evitando entradas órfãs; updates parciais não quebram; clone/install/build foram movidos para o setup assíncrono; `commandParser` trata comandos com sintaxe de shell e é compartilhado; o contador de reinícios é resetado depois de um período estável. |
| **Docker** | P18–P22 | Bind mounts sob o workspace são traduzidos para o caminho visto pelo daemon por `HOST_WORKSPACES_ROOT`; `DOCKER_API_VERSION` chega ao cliente; o comando inferido não instala dependências durante o start (isso pertence ao setup); o polling de 3 s para quando não há container ativo; e o restart reconecta o stream de logs e o túnel. A RestartPolicy nativa limita os reinícios do container. |
| **Infra / Compose** | P23–P27 | O serviço Redis sem consumidor foi retirado. Dockerfile e Compose têm `HEALTHCHECK`, o Compose não força mais `user: "root"`, e o armazenamento foi reunido no bind `./data:/data`. `tini` é o processo inicial da imagem para fazer reap de filhos órfãos. O entrypoint ainda ajusta ownership do volume antes de iniciar o painel, portanto o comportamento final de permissões deve ser conferido no ambiente de implantação. |
| **Banco, logs e performance** | P28–P32 | `auditLog` aplica retenção por idade e teto de `LOG_MAX_DB` por origem, além de limitar a auditoria. O Express aceita o tamanho previsto pelo editor (`JSON_BODY_LIMIT`, 8 MB por padrão); `df`/`ps` usam chamadas assíncronas e cache; o loop de snapshots só vive enquanto há clientes; e a persistência do SQLite WASM é atômica e debounced, sem serializar o banco a cada linha de saída. |
| **Instâncias de banco** | P44–P47 | Provisionamento e inicialização usam argumentos (`execFileSync`), sem shell para interpretar nomes ou caminhos. O nome da instância é validado e convertido em slug; senhas são geradas com `crypto.randomBytes`; e portas são limitadas ao intervalo não privilegiado de 1024–65535, com conflito reportado claramente. |
| **Frontend** | P33–P38/P48 | A troca de serviço limpa o estado antigo; o navegador de arquivos global e o do serviço usam o mesmo hook/adaptador e oferecem copiar, mover e buscar; a remoção tem confirmação explícita para apagar o workspace; eventos de status são agrupados por debounce; e formulários exibem erros do servidor. O progresso de upload continua sendo do lote inteiro, não individual por arquivo (P38); essa limitação cosmética está registrada na seção 9.3. |
| **Autenticação** | P40–P43 | O login tem atraso progressivo e bloqueio temporário por IP+usuário, com limpeza após sucesso; a senha padrão não pode ser dispensada e as rotas de negócio ficam bloqueadas até a troca; bcrypt é executado também para usuário inexistente, evitando a diferença de tempo; e a nova senha exige pelo menos 8 caracteres. |
| **Terminal** | P39 | Foi implementado terminal por serviço, com sessões locais ou `docker exec`, diretório de trabalho persistente, histórico limitado, saída em tempo real via Socket.io, interrupção de processos locais e encerramento de sessões ociosas. Ele é deliberadamente sem PTY; os limites dessa escolha estão na seção 9.2. |

## 9. O que ainda está pendente / não pôde ser testado

A suíte automatizada cobre o código sem depender de todos os recursos do
ambiente. Os itens abaixo não devem ser interpretados como garantia de
funcionamento em qualquer dispositivo ou instalação.

### 9.1 Best-effort (depende de ambiente/binário externo)

- **Docker Engine real:** o cliente, os mocks e a montagem do spec são
  exercitados, mas é necessário validar com um daemon real, socket/permissões
  e imagens reais.
- **Cloudflared Quick Tunnel e Named Tunnel:** dependem do binário, rede,
  login/credenciais e configuração da conta Cloudflare.
- **PostgreSQL, MySQL e MariaDB reais:** o provisionamento depende dos
  binários instalados, permissões, versão do engine e comportamento do sistema
  de arquivos.
- **Java e a receita de Minecraft:** a receita/comando precisa de uma JVM e
  de um `server.jar`/arquivos do servidor reais.
- **`prlimit` e limites de CPU/memória:** a aplicação dos limites de processos
  locais é best-effort e depende do util-linux e das permissões do host.
- **Sensores de temperatura:** `/sys/class/thermal` pode não existir ou ser
  inacessível; a métrica fica indisponível nesses aparelhos.
- **`DOCKER_GID` do host:** o GID do grupo `docker` varia entre instalações e
  precisa ser conferido no host antes de subir o Compose.
- **Painel dentro de container gerenciando containers do host:** requer
  socket Docker, permissões e um mapeamento correto de
  `HOST_WORKSPACES_ROOT`; esse fluxo precisa ser testado na instalação real.

### 9.2 Limitações assumidas por design

- **Terminal sem PTY:** é um terminal orientado a comandos, não um emulador de
  terminal interativo. Programas como `vim`, `htop` e `nano` não são suportados
  como numa sessão TTY completa.
- **Quick Tunnel:** suporta apenas tráfego HTTP/HTTPS e a URL gerada não é
  persistente; ela pode mudar quando o túnel é recriado. Não serve para o
  protocolo de conexão de bancos.
- **Single-user:** o painel é pessoal e não oferece modelo de usuários,
  equipes, tenants ou permissões por recurso.
- **Sem refresh token:** o JWT tem validade de 7 dias; depois disso é preciso
  fazer login novamente.
- **Windows:** não foi validado e não há suporte oficial neste momento.
- **ARM real:** compatibilidade foi pensada para Termux, mas não foi validada
  em hardware ARM real nesta rodada.

### 9.3 Dívida técnica adiada e fora de escopo

- **`npm audit`:** a atualização de `react-router-dom` exigiria o major 7.x,
  com risco de quebra, e o `esbuild` apontado pertence ao servidor de
  desenvolvimento; nenhum upgrade foi forçado nesta rodada.
- **2FA e log de atividade centralizado:** permanecem como uma próxima frente;
  o registro de auditoria atual não substitui um histórico central de
  atividade da conta.
- **Duplicação/legado para consolidar:** ainda vale revisar a relação entre
  `routes/files.js` e `routes/serviceFiles.js`, as três ocorrências históricas
  de `slugify` e a consolidação final do tokenizador de comando, mesmo com a
  fábrica de rotas e o `commandParser` já reduzindo essa duplicação.
- **Progresso de upload por arquivo (P38):** o indicador é do lote inteiro;
  individualizá-lo é uma melhoria cosmética, não uma correção de integridade.
- **Fora de escopo:** multi-usuário, marketplace, PTY completo e suporte
  oficial a Windows.
