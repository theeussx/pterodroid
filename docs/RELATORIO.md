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
