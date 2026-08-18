# Relatório de Teste Completo — Pterodroid

**Data da execução:** 18 de agosto de 2026  
**Repositório:** [theeussx/pterodroid](https://github.com/theeussx/pterodroid)  
**Commit avaliado:** `38cde85`  
**Autor:** **Manus AI**

## Sumário executivo

O Pterodroid foi submetido a uma auditoria prática do backend, frontend, suíte de integração, autenticação, gerenciamento de processos, terminal, arquivos, backups, bancos de dados e integração Docker simulada. O build de produção do frontend concluiu com sucesso e a maioria dos testes automatizados passou. Entretanto, a suíte completa terminou com **duas falhas no teste de terminal**, e a auditoria de dependências encontrou **uma vulnerabilidade alta no backend e sete vulnerabilidades no frontend**, incluindo três classificadas como altas pelo banco de advisories.

A recomendação é **não tratar a versão avaliada como pronta para exposição pública** antes de atualizar as dependências vulneráveis, investigar a falha intermitente do terminal e repetir os testes em um ambiente com Docker, PostgreSQL/MariaDB e cloudflared disponíveis.

## Resultado geral

| Área | Resultado | Observação |
| --- | --- | --- |
| Instalação das dependências | Passou | `npm ci --ignore-scripts` em backend e frontend concluiu. |
| Sintaxe do JavaScript | Passou | Os arquivos `.js` de `backend/src` e `backend/tests` passaram por `node --check`. |
| Build do frontend | Passou | Vite gerou `frontend/dist` sem erro. |
| Suíte automatizada | Parcial | Seis suítes passaram; a suíte de terminal registrou 21 sucessos e 2 falhas. |
| Autenticação e throttle | Passou | Login, senha errada, token inválido, troca de senha e bloqueio progressivo foram exercitados. |
| Processos locais e watchdog | Passou | Criação, início, logs, crash simulado, reinício automático e parada passaram. |
| Arquivos, workspaces e backups | Passou | Operações de workspace, ZIP, download, restauração e limpeza passaram nos cenários cobertos. |
| Docker | Parcial | O driver foi testado; não foi possível validar um daemon Docker real neste ambiente. |
| PostgreSQL/MySQL | Não executado | Os binários não estavam instalados no ambiente de teste. |
| Cloudflare Tunnel | Não executado | O binário e credenciais não estavam disponíveis para um teste real. |

## Falhas encontradas

### F-01 — O teste de terminal falha no controle de concorrência e no limite de saída

**Severidade:** Média para a confiabilidade da entrega; potencialmente alta se a falha refletir o runtime real.  
**Evidência:** `backend/tests/terminal-test.js`, resultados da execução de `npm test`.

A suíte completa produziu as seguintes falhas:

```text
❌ segundo comando é recusado com 409 — status 200
❌ truncou em vez de estourar
21 passaram, 2 falharam
```

O código de produção contém as proteções esperadas: `TerminalSession.run()` verifica `this.busy` e aplica `MAX_OUTPUT_BYTES = 256 * 1024`. Em um reprodutor isolado da classe, ambas as proteções funcionaram. Isso indica uma possível condição de corrida ou problema de sincronização no cenário HTTP/Socket.IO, e não uma ausência simples da lógica de proteção.

A falha ainda deve ser tratada como relevante porque o teste usa o mesmo fluxo do frontend: abre sessão por HTTP, executa comandos por HTTP e recebe eventos pelo Socket.IO. Uma condição de corrida nesse fluxo pode permitir duas execuções simultâneas, perder o estado de truncamento ou associar eventos de uma execução à seguinte.

**Reprodução observada:** executar `cd backend && npm test`. A suíte completa falhou; executar `node tests/terminal-test.js` isoladamente também reproduziu as duas falhas nesta auditoria. O reprodutor direto da classe, por outro lado, passou, reforçando a hipótese de problema no caminho de integração.

**Correção recomendada:** adicionar instrumentação e um identificador de execução a cada comando; fazer o endpoint retornar o estado e o `commandId`; filtrar eventos Socket.IO por `sessionId` e `commandId`; aguardar explicitamente o evento de saída antes de iniciar o próximo caso; e adicionar um teste de concorrência com duas requisições simultâneas reais. Também deve ser verificado se os listeners de Socket.IO podem receber eventos atrasados de comandos anteriores.

## Vulnerabilidades de dependências

### F-02 — `socket.io-parser` vulnerável a exaustão de memória

**Severidade:** Alta.  
**Pacote afetado:** cadeia de `socket.io-parser` entre `4.0.0` e `4.2.6`.  
**Advisory:** [GHSA-2m8v-j782-fhvr](https://github.com/advisories/GHSA-2m8v-j782-fhvr).

O `npm audit --omit=dev` do backend encontrou uma vulnerabilidade alta, com CVSS 7.5 e correção disponível. Como o Socket.IO é usado para logs e terminal em tempo real, o componente fica no caminho de tráfego acessível ao painel.

**Correção recomendada:** atualizar a cadeia do Socket.IO para uma versão que resolva `socket.io-parser >= 4.2.7`, regenerar os lockfiles e repetir `npm audit` e os testes de conexão.

### F-03 — Cadeia de desenvolvimento do frontend desatualizada

**Severidade:** Alta/moderada, conforme o pacote.  
**Comando:** `npm --prefix frontend audit`.

O frontend apresentou sete vulnerabilidades: três altas e quatro moderadas. A cadeia inclui `vite`, `esbuild`, `nanoid`, `postcss`, `react-router` e `react-router-dom`. Entre os avisos estão problemas de path traversal no Vite, risco relacionado a `esbuild` no servidor de desenvolvimento, vulnerabilidades de open redirect/fluxo de navegação no React Router e exaustão de recursos no `nanoid`.

A exploração de algumas dessas falhas depende do servidor de desenvolvimento ou de condições específicas, mas manter o conjunto vulnerável aumenta o risco operacional e pode contaminar pipelines de desenvolvimento e CI.

**Correção recomendada:** atualizar primeiro os pacotes diretos `vite`, `postcss` e `react-router-dom`, avaliar o impacto do salto de versão principal do Vite indicado pelo audit, regenerar `frontend/package-lock.json`, executar o build e repetir a auditoria. O backend também deve atualizar o Socket.IO de forma coordenada.

## Cobertura que passou

Os testes de autenticação confirmaram senha correta, rejeição de senha errada, mensagem não enumerável, bloqueio progressivo, cabeçalho `Retry-After`, troca de senha e rejeição de token inválido. Os testes de banco confirmaram validação de nomes, portas, credenciais, slug seguro, prevenção de injeção e não exposição da senha na listagem.

Os testes de serviço confirmaram criação, início, captura de logs, reinício após encerramento inesperado, parada e limpeza. Os testes de backup confirmaram criação de ZIP, listagem, limite, download, restauração e remoção junto com o serviço. Os testes de workspace e arquivos passaram nos cenários cobertos, assim como a validação do driver Docker sem exigir um daemon real.

## Limitações do ambiente

Não foi possível executar um teste funcional real de containers porque o ambiente de auditoria não disponibilizou um daemon Docker utilizável. Também não foi possível provisionar PostgreSQL/MariaDB nem autenticar um túnel Cloudflare. Portanto, os fluxos de criação, migração, parada, persistência e recuperação desses componentes permanecem sem validação ponta a ponta.

Também não foi realizada uma publicação externa nem um teste de carga prolongado. A avaliação de segurança foi feita em código e dependências, sem varredura autenticada de uma instância exposta à rede.

## Plano de correção priorizado

| Prioridade | Ação | Critério de aceite |
| --- | --- | --- |
| P0 | Atualizar `socket.io-parser` por meio da cadeia do Socket.IO. | `npm audit --omit=dev` do backend sem vulnerabilidade alta e todos os testes passando. |
| P0 | Corrigir e tornar determinístico o fluxo de terminal HTTP/Socket.IO. | Concorrência retorna 409 de forma consistente; saída longa gera evento de truncamento; teste repetido 20 vezes sem falha. |
| P1 | Atualizar Vite, PostCSS, React Router e dependências transitivas. | Build de produção passa e `npm audit` não retorna altas; moderadas restantes devem ser justificadas. |
| P1 | Executar matriz com Docker real, PostgreSQL/MariaDB e cloudflared. | Criar, iniciar, reiniciar, parar, restaurar e recuperar cada integração em ambiente descartável. |
| P2 | Adicionar teste de carga para login, Socket.IO, terminal e logs. | O painel mantém disponibilidade sob conexões e comandos concorrentes dentro dos limites documentados. |

## Comandos executados

```bash
gh repo clone theeussx/pterodroid /home/ubuntu/pterodroid
npm --prefix backend ci --ignore-scripts
npm --prefix frontend ci --ignore-scripts
npm --prefix backend audit --omit=dev
npm --prefix frontend audit
find backend/src backend/tests -name '*.js' -print0 | xargs -0 -n1 node --check
npm --prefix frontend run build
cd backend && npm test
```

## Conclusão

O projeto apresenta uma base funcional sólida nos fluxos locais e uma suíte de testes acima do mínimo, mas a auditoria não foi aprovada integralmente. Os dois pontos mais importantes são a falha do teste integrado de terminal e a atualização urgente das dependências vulneráveis, principalmente a cadeia Socket.IO. Depois dessas correções, a validação deve ser repetida com infraestrutura real para os caminhos Docker, bancos gerenciados e Cloudflare.

## Referências

[1]: https://github.com/theeussx/pterodroid "Repositório oficial do Pterodroid"
[2]: https://github.com/advisories/GHSA-2m8v-j782-fhvr "Socket.IO parser — Zero-attachment Memory Exhaustion"
[3]: https://github.com/advisories/GHSA-4w7w-66w2-5vf9 "Vite — Path Traversal in Optimized Deps .map Handling"
[4]: https://github.com/advisories/GHSA-67mh-4wv8-2f99 "esbuild — requests ao servidor de desenvolvimento"
[5]: https://github.com/advisories/GHSA-wrjc-x8rr-h8h6 "React Router — open redirect via backslash"
