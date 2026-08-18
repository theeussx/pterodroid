# Relatório de Correções e Teste Local — Pterodroid

**Data:** 18 de agosto de 2026  
**Commit base:** `38cde85`  
**Projeto:** [theeussx/pterodroid](https://github.com/theeussx/pterodroid)

## Resultado final

As falhas encontradas na auditoria anterior foram corrigidas e o sistema foi hospedado localmente com **frontend e backend servidos juntos pelo backend na porta 3001**. O painel foi acessado pelo navegador como usuário real, com login, criação de serviço, inicialização, abertura do terminal, execução de comando, navegação pelo workspace e validação HTTP do serviço criado.

| Verificação | Resultado |
| --- | --- |
| Suíte completa do backend | **Passou: todas as suítes** |
| Teste integrado do terminal | **Passou: 26/26** |
| Build de produção do frontend | **Passou com Vite 8.2.1** |
| Auditoria backend, produção | **0 vulnerabilidades** |
| Auditoria frontend | **0 vulnerabilidades** |
| Login pelo navegador | **Passou** |
| Criação de serviço pelo frontend | **Passou** |
| Inicialização e restauração do serviço | **Passou** |
| Terminal pelo navegador | **Passou** |
| Arquivos do workspace pelo navegador | **Passou** |
| HTTP do painel em `3001` | **Passou** |
| HTTP do serviço em `3000` | **Passou** |

## Correções aplicadas

### Terminal e persistência de ambiente

O terminal estava apresentando falhas no cenário integrado: o segundo comando às vezes era aceito enquanto outro ainda estava em execução, o truncamento de saída não era observado de forma determinística e a captura de `export -p` podia copiar o ambiente inteiro para a sessão. Isso fazia o ambiente crescer entre comandos e podia provocar `spawn E2BIG`.

A implementação foi alterada para capturar somente `export` e `unset` explicitamente digitados pelo usuário. O ambiente herdado do painel deixou de ser reexportado e foi mantido um limite defensivo de variáveis persistidas. O teste passou a aguardar o estado real de ociosidade da sessão antes de iniciar novos cenários e a verificar o estado `busy` diretamente pela API.

Resultado do teste integrado:

```text
26 passaram, 0 falharam
```

### Isolamento da porta do painel

O teste manual revelou um problema funcional importante: quando o painel era executado com `PORT=3001`, um serviço novo sem porta explícita herdava essa mesma variável do processo pai. O serviço scaffoldado então tentava escutar em `3001`, entrava em conflito com o painel e era reiniciado até atingir o limite de tentativas.

O `processManager` foi corrigido para remover `PORT` do ambiente herdado quando o serviço não definiu uma porta explicitamente. Se o usuário fornecer `PORT` nas variáveis do próprio serviço, essa configuração continua sendo respeitada. Quando uma porta é informada no cadastro, a lógica existente de seleção de porta livre continua sendo usada.

Após reiniciar o backend com os mesmos dados, o serviço restaurado permaneceu em execução e respondeu corretamente em `http://127.0.0.1:3000/`, enquanto o painel continuou respondendo em `http://127.0.0.1:3001/api/health`.

### Dependências vulneráveis

Foram atualizadas as dependências diretas e transitivas relevantes:

| Componente | Alteração |
| --- | --- |
| `socket.io` e `socket.io-client` | Atualizados para `4.8.3`. |
| `socket.io-parser` | Fixado por `overrides` em `^4.2.7`. |
| `vite` | Atualizado para `8.2.1`. |
| `@vitejs/plugin-react` | Atualizado para `6.0.5`, compatível com Vite 8. |
| `react-router-dom` | Atualizado para `7.18.2`. |
| `postcss` | Atualizado para `8.5.26`. |
| `nanoid` | Atualizado transitivamente para versão corrigida. |

As auditorias finais retornaram zero vulnerabilidades no backend e no frontend.

## Teste manual pelo navegador

A instância foi iniciada com dados descartáveis usando `DATA_ROOT=/tmp/pterodroid-live-data`, `JWT_SECRET=local-test-secret` e `PORT=3001`. O navegador acessou `http://127.0.0.1:3001`, foi redirecionado para `/login` e exibiu corretamente a interface do Pterodroid.

O login com o usuário padrão de teste funcionou. Na área de serviços, foi criado o serviço `teste-browser` com o comando `node index.js`. O painel exibiu a confirmação de criação, permitiu iniciar o serviço e abriu o detalhe individual.

Na aba Terminal, foi criada uma sessão no workspace `/tmp/pterodroid-live-data/workspaces/teste-browser`. O comando `printf 'teste-browser-ok\n'` foi executado pelo navegador e retornou `teste-browser-ok` no painel. Na aba Arquivos, o workspace exibiu `index.js`, `package.json`, `README.md`, `tsconfig.json` e a pasta `src`.

O teste também confirmou a recuperação após reinício do backend: o serviço foi restaurado automaticamente e o cartão visual passou a exibir um serviço online com o botão **Parar**, indicando estado ativo.

## Comandos principais executados

```bash
npm --prefix backend install --ignore-scripts
npm --prefix frontend install --ignore-scripts
npm --prefix backend audit --omit=dev
npm --prefix frontend audit
npm --prefix frontend run build
npm --prefix backend test
PORT=3001 DATA_ROOT=/tmp/pterodroid-live-data \
  JWT_SECRET=local-test-secret node backend/src/server.js
curl http://127.0.0.1:3001/api/health
curl http://127.0.0.1:3000/
```

## Arquivos modificados

| Arquivo | Motivo |
| --- | --- |
| `backend/src/services/terminalManager.js` | Captura segura e limitada de variáveis do terminal; correção do crescimento de ambiente. |
| `backend/tests/terminal-test.js` | Cenários integrados determinísticos para concorrência, interrupção e truncamento. |
| `backend/src/services/processManager.js` | Impede que serviços sem porta explícita herdem a porta do painel. |
| `backend/package.json` e `backend/package-lock.json` | Atualização do Socket.IO e override de `socket.io-parser`. |
| `frontend/package.json` e `frontend/package-lock.json` | Atualização de Vite, plugin React, React Router, PostCSS, Socket.IO e override do parser. |

## Limitações restantes

O ambiente não possui um daemon Docker funcional, PostgreSQL/MariaDB instalado nem credenciais do Cloudflare. Portanto, os fluxos dessas integrações não foram validados contra serviços reais nesta execução. Os testes automatizados cobrem o driver Docker e a validação das rotas, mas não substituem uma execução real com esses componentes.

## Conclusão

Depois das correções, o Pterodroid passou pela suíte automatizada completa, pelo build de produção, pela auditoria de dependências e por um teste manual de uso real com frontend e backend hospedados localmente. O problema de conflito de porta descoberto durante o teste manual também foi corrigido e validado com o serviço respondendo em sua própria porta.
