# Relatório técnico de evolução do Pterodroid

> **Nota de arquivamento (Fase 0):** este documento é o relatório técnico de
> evolução recebido em 19/09/2026, arquivado verbatim como referência. A
> validação linha a linha dele contra o commit analisado — incluindo 7
> correções/achados (entre eles o achado D1: painel rodando como root no
> container) e o plano de execução detalhado da Fase 0 — está em
> [VALIDACAO-E-PLANO-FASE-0.md](VALIDACAO-E-PLANO-FASE-0.md).

**Data da análise:** 19 de setembro de 2026
**Commit analisado:** `3e281a65e755415e06a186df3d226c77a370c8ec`
**Repositório:** `theeussx/pterodroid`

## 1. Conclusão executiva

O Pterodroid já deixou de ser apenas um protótipo para Android. O código atual possui uma base funcional relevante: backend Node.js/Express, frontend React/Vite, persistência SQLite via WebAssembly, gerenciamento de processos locais, driver Docker, instâncias PostgreSQL/MySQL/MariaDB, gerenciador de arquivos, backups, terminal orientado a comandos, monitoramento, health checks, alertas por webhook, autenticação JWT e integração com Cloudflare Tunnel.

A análise também confirmou que a revisão anterior corrigiu grande parte dos defeitos críticos registrados em `docs/AUDITORIA.md`. A suíte do backend passou após a instalação limpa das dependências, e o frontend compilou em produção. Portanto, o problema principal não é começar do zero. O problema é **transformar uma aplicação pessoal funcional em um produto operacionalmente confiável, seguro e competitivo em Linux**.

A recomendação central é posicionar o produto como um **painel local-first de hospedagem e operação de serviços**, com três características que podem diferenciá-lo:

1. **Instalação simples em Linux e Docker**, sem exigir a pilha pesada de um painel tradicional.

1. **Suporte unificado a processos locais, containers Docker e bancos**, mantendo a possibilidade de operar em hardware pequeno.

1. **Experiência direta para uma pessoa ou pequena equipe**, com terminal, arquivos, logs, backups e domínios em uma única interface.

Não é recomendável tentar copiar integralmente Pterodactyl, Coolify e aaPanel ao mesmo tempo. Cada um tem uma proposta diferente. O Pterodactyl é mais forte em servidores isolados e game hosting; o Coolify é mais forte em deploy, Git, automação e múltiplos servidores; o aaPanel é mais forte em hospedagem Linux ampla, websites, bancos, firewall e extensões. As fontes oficiais confirmam essas diferenças. [2] [3] [4]

O caminho de maior retorno é evoluir primeiro a **confiabilidade de produção**, depois o **deploy moderno**, e só então adicionar multi-host e multiusuário. A expansão prematura de escopo aumentaria a superfície de segurança e poderia destruir a principal vantagem do projeto: ser mais simples de instalar e manter.

## 2. Escopo e evidências da análise

A avaliação foi feita diretamente sobre o repositório, considerando backend, frontend, scripts shell, Dockerfile, Compose, testes e documentação. Também foi realizada uma comparação documental com as fontes oficiais de Pterodactyl, Coolify e aaPanel.

A validação executada foi a seguinte:

| Verificação | Resultado | Observação |
| --- | --- | --- |
| `npm ci` do backend | Passou | Dependências instaladas a partir do lockfile |
| `npm test` no backend | Passou | Todas as suítes do runner passaram, com saída final de sucesso |
| `npm ci` do frontend | Passou | Dependências instaladas a partir do lockfile |
| `npm run build` do frontend | Passou | Vite 8.2.1; 1.636 módulos transformados |
| Docker Engine real | Não validado nesta máquina | Existem testes com API simulada e smoke test separado |
| PostgreSQL/MySQL/MariaDB reais | Não validados nesta máquina | Dependem dos binários e permissões do host |
| Cloudflare Tunnel real | Não validado | Depende de credenciais, DNS e rede externa |
| ARM físico | Não validado | A compatibilidade é planejada, mas precisa de matriz de hardware |

A primeira tentativa de validação falhou porque `node_modules` não estava instalado e porque o comando do frontend foi executado a partir do diretório errado. Após `npm ci`, o frontend compilou e a suíte backend passou. Essa diferença é importante: **o projeto precisa documentar e automatizar o pré-voo de dependências para que esse tipo de falso negativo não ocorra em contribuições futuras**.

## 3. Estado atual do produto

### 3.1 O que já está bem encaminhado

A arquitetura é relativamente modular para o tamanho do projeto. O backend separa rotas, gerenciadores de processo, drivers Docker, gerenciamento de bancos, arquivos, backups, terminal, monitoramento e túneis. O frontend possui páginas dedicadas para dashboard, serviços, bancos, arquivos, logs, monitoramento, Docker hosts e configurações.

A revisão atual já contém boas decisões técnicas:

- `WORKSPACES_ROOT` tornou-se a raiz canônica dos projetos.

- Operações de arquivo utilizam validação de caminho, proteção contra travessia, tratamento de symlinks e escrita atômica.

- Uploads usam área temporária e evitam sobrescrita silenciosa.

- O driver de processos separa estado desejado de estado observado.

- Falhas de `spawn` passam por finalização comum, evitando serviços órfãos no mapa de processos.

- O setup de projetos foi movido para fluxo assíncrono, evitando bloquear o request durante `git clone` ou `npm install`.

- O driver Docker traduz caminhos de bind mount quando o painel roda em container.

- O Compose possui health check, limite de logs e um bind único para `./data`.

- O banco de aplicação possui migrações incrementais para colunas novas.

- Backups de serviço ficam fora da raiz do workspace, evitando que um backup contenha a si próprio.

- O login possui bloqueio progressivo, bcrypt também para usuário inexistente e bloqueio de rotas enquanto a senha padrão não é alterada.

- O terminal possui limite de saída, timeout, sinalização de grupo de processo e persistência do diretório de trabalho.

Esses pontos formam uma base boa para uma versão Linux legítima. Eles não devem ser reescritos sem necessidade; devem receber testes de integração e hardening operacional.

### 3.2 Limitações atuais de produto

O próprio projeto declara que é single-user. Isso é aceitável para uma primeira versão, mas limita a competição com painéis que já possuem equipes, subusuários, quotas e permissões por recurso. O Pterodactyl confirma subusuários por servidor; o Coolify confirma equipes e papéis; o aaPanel confirma subcontas e quotas. [2] [3] [4]

O Pterodroid também ainda está mais próximo de um **orquestrador de processos e containers** do que de uma plataforma completa de deploy. Ele tem campos para Git e setup inicial, mas ainda precisa amadurecer:

- fila de deployments;

- histórico de versões;

- rollback seguro;

- webhooks de Git com assinatura;

- build isolado;

- logs separados de build e runtime;

- previews temporários;

- templates versionados;

- atualização sem indisponibilidade quando possível.

O modelo atual de banco em memória, baseado em `sql.js`, é uma boa escolha para Termux e ambientes sem compilador nativo. Em Linux de produção, porém, ele aumenta o custo de cada flush e exige atenção especial para concorrência, crash recovery e tamanho do banco. A arquitetura deve preservar `sql.js` no modo portátil e oferecer SQLite nativo ou PostgreSQL opcional no modo servidor.

## 4. Posicionamento competitivo recomendado

A comparação abaixo não é uma tentativa de dizer que um produto é “melhor” em todos os casos. Ela mostra onde cada referência é forte e onde o Pterodroid pode se diferenciar.

| Produto | Força principal | O que o Pterodroid deve aprender | Oportunidade de diferenciação |
| --- | --- | --- | --- |
| Pterodactyl | Isolamento de servidores, Docker, limites, console, arquivos, SFTP, backups e subusuários | modelo de recursos, limites, permissões, templates e API | operar também processos locais, bancos e workloads genéricos sem exigir a arquitetura Panel + Wings |
| Coolify | Git, Compose, builds, deploy automático, previews, rollback, múltiplos servidores, equipes, API e automação | pipeline de deploy, destinos, histórico e integração de infraestrutura | instalação mais leve, modo local-first e operação funcional mesmo em hardware pequeno |
| aaPanel | websites, runtimes, bancos, domínios, SSL, firewall, monitoramento, backups e plugins | cobertura de hospedagem Linux e onboarding guiado | menor complexidade, menos dependência de plugins e melhor integração com Docker/Tunnel |

O diferencial não deve ser “ter centenas de recursos”. Deve ser uma promessa operacional clara:

> **Instale em um Linux limpo, conecte ou descubra seus serviços, gerencie processos locais e containers, configure domínio, veja logs e faça backup sem precisar montar uma pilha complexa.**

O projeto deve manter um **modo pessoal** simples. Multiusuário e multi-host devem ser recursos opcionais, ativados quando o operador precisar deles. Essa abordagem evita que uma pessoa instalando o painel em uma Raspberry Pi seja obrigada a configurar equipes, filas, Redis, workers e serviços externos.

## 5. Arquitetura-alvo para Linux

### 5.1 Separar três modos de operação

O Pterodroid deveria assumir oficialmente três modos, com limites de segurança explícitos:

**Modo portátil:** Termux, Ubuntu proot e hardware ARM limitado. Usa `sql.js`, processos locais, baixa dependência e nenhum requisito de `systemd`.

**Modo Linux nativo:** Debian/Ubuntu, Fedora/RHEL-like, Arch e openSUSE. Usa usuário de serviço não privilegiado, opção de integração com `systemd` ou OpenRC, SQLite nativo quando disponível e binários externos descobertos por pré-voo.

**Modo Docker:** painel e backend dentro de container, com `./data` persistente. O controle do Docker do host deve ser tratado como uma integração privilegiada, não como uma configuração normal sem aviso.

A configuração deve mostrar claramente o modo detectado e os recursos habilitados. Um painel dentro de container com acesso a `/var/run/docker.sock` pode controlar o host; isso equivale a conceder capacidade administrativa significativa ao container. O usuário precisa confirmar esse risco na documentação e no onboarding.

### 5.2 Introduzir uma camada de runtime estável

A aplicação já possui distinção entre processo e Docker, mas a interface do runtime deve ser formalizada:

```
RuntimeAdapter
├── LocalProcessAdapter
├── DockerContainerAdapter
├── ComposeAdapter        (fase futura)
├── SystemdAdapter        (opcional em Linux nativo)
└── SshRemoteAdapter      (fase futura)
```

Cada adapter deve implementar o mesmo contrato:

- `validate()`;

- `create()`;

- `start()`;

- `stop()`;

- `restart()`;

- `delete()`;

- `getStatus()`;

- `getLogs()`;

- `getStats()`;

- `exec()`;

- `getWorkspace()`;

- `applyLimits()`;

- `healthCheck()`.

A rota HTTP não deve conhecer detalhes de `child_process`, Docker ou SSH. Isso reduz regressões e permite adicionar Compose sem duplicar as regras de serviços.

### 5.3 Criar uma fila de jobs

Operações lentas não devem depender do ciclo de vida de um request HTTP. A fila deve controlar:

- clone e pull de Git;

- instalação de dependências;

- build de imagem;

- criação de backup;

- restauração;

- dump de banco;

- provisionamento de banco;

- atualização de serviço;

- limpeza de logs e arquivos temporários.

Cada job precisa ter `id`, estado, progresso, timestamps, serviço associado, logs, cancelamento e erro serializado. O frontend deve conseguir fechar e reabrir a página sem perder a operação.

No modo portátil, a fila pode ser persistida no SQLite e executada pelo próprio processo. Em uma evolução posterior, pode existir um worker separado. Redis não deve ser incluído apenas por hábito: ele só deve aparecer quando houver uma necessidade comprovada de fila distribuída ou pub/sub externo.

## 6. Melhorias prioritárias para Linux nativo

### Prioridade P0 — confiabilidade de instalação e execução

1. Criar um comando único de pré-voo, por exemplo `./panelctl.sh doctor`, que verifique Node, npm, permissões, portas, espaço em disco, arquitetura, `cloudflared`, Docker, `prlimit`, shells disponíveis e binários de banco.

1. Fazer o instalador apresentar uma matriz final de recursos: “Docker disponível”, “PostgreSQL disponível”, “MariaDB disponível”, “Tunnel disponível” e “modo de execução”.

1. Nunca executar o painel como root por padrão. Criar um usuário dedicado, diretórios com ownership correto e permissões mínimas.

1. Oferecer unidade `systemd` opcional para Linux nativo, sem tornar `systemd` requisito do produto. A unidade deve usar `Restart=on-failure`, `NoNewPrivileges`, diretórios protegidos, limites de arquivos e ambiente externo.

1. Manter `panelctl.sh` para Termux, proot e ambientes sem init.

1. Adicionar `flock` ou mecanismo equivalente para impedir dois processos do painel usando o mesmo `panel.db`.

1. Criar backup automático do banco de aplicação antes de migrações.

1. Documentar claramente as versões suportadas de Node, distribuições, arquiteturas e kernels.

### Prioridade P0 — segurança de execução

1. Remover qualquer possibilidade de o usuário do painel executar comandos com privilégios maiores que os do usuário de serviço.

1. Separar terminal de workspace, terminal de host e `docker exec`. O terminal de host deve ser desabilitado por padrão e exigir uma permissão explícita.

1. Aplicar allowlist de comandos apenas onde o produto oferecer tarefas automatizadas. Comandos livres devem receber aviso claro de que equivalem a acesso ao sistema.

1. Cifrar todos os segredos persistidos, incluindo tokens Git, credenciais de bancos, chaves Docker TLS e tokens Cloudflare. A chave mestre deve ficar fora do banco e ter procedimento de recuperação documentado.

1. Não exibir senha gerada de banco depois da criação, salvo em ação explícita de revelação. Registrar acesso a segredos na auditoria.

1. Adicionar rotação e revogação de JWT, sessões ativas e logout global.

1. Adicionar 2FA TOTP antes de multiusuário. Depois, considerar passkeys ou SSO/OIDC.

1. Configurar headers de segurança, limite de tamanho de request, upload por serviço, limite de arquivos, limite de decompression e rate limit por rota.

1. Validar URLs de webhook para reduzir SSRF. Bloquear loopback, redes privadas e metadados de cloud por padrão, salvo configuração explícita.

1. Adicionar política de origem CORS fechada por padrão em instalação pública.

### Prioridade P1 — operação confiável

1. Adicionar `desired_state`, `actual_state`, motivo da última transição e causa do último crash na interface.

1. Implementar circuit breaker para crash-loop, com backoff exponencial e botão de desbloqueio manual.

1. Fazer o watchdog distinguir processo vivo, porta aberta e aplicação saudável.

1. Aplicar limites reais de CPU, memória, PIDs, arquivos abertos e espaço de workspace. Quando o host não suportar um limite, informar “não aplicado” em vez de marcar como ativo.

1. Implementar retenção de logs por serviço e por banco, compressão e exportação.

1. Centralizar auditoria em uma tela com filtros por usuário, serviço, origem, IP, ação e resultado.

1. Adicionar métricas históricas de CPU, memória, disco, rede, temperatura e uptime, com retenção configurável.

1. Enviar alertas para queda, crash-loop, disco cheio, backup falho, restauração concluída e expiração de certificado.

1. Implementar shutdown gracioso que pare jobs, sessões de terminal, streams, túneis e processos filhos sem deixar órfãos.

1. Criar testes de reinício do painel durante backup, deploy, instalação e gravação de logs.

## 7. Docker para produção

O Compose atual é um bom ponto inicial, mas o modo Docker precisa ser tratado como uma instalação de produção e não apenas como um comando `docker compose up`.

### 7.1 Imagem

- Usar imagem base fixa por digest em releases de produção.

- Publicar imagens versionadas, além de `latest`.

- Gerar SBOM e verificar vulnerabilidades no pipeline.

- Executar como usuário não root.

- Manter `tini` ou init equivalente.

- Remover ferramentas desnecessárias da imagem final.

- Separar imagem de build e imagem runtime quando houver build do frontend no CI.

- Incluir apenas `curl` ou ferramenta mínima necessária ao health check.

### 7.2 Compose

O Compose deve oferecer dois arquivos ou perfis:

- `compose.local.yml`: painel sem socket Docker, para quem só deseja processos ou uso administrativo limitado;

- `compose.docker.yml`: painel com acesso ao Docker Engine, explicitamente documentado como privilegiado.

Adicionar as seguintes variáveis obrigatórias ou verificadas:

- `JWT_SECRET`;

- `DATA_ROOT`;

- `HOST_WORKSPACES_ROOT`;

- `DOCKER_GID`;

- `CORS_ORIGINS`;

- `TZ`;

- limites de upload e retenção;

- URL pública do painel, quando houver proxy.

O Compose deve falhar cedo se `HOST_WORKSPACES_ROOT` não existir ou não corresponder ao bind mount real. Um erro de caminho nesse ponto é mais perigoso do que simplesmente não iniciar o serviço.

### 7.3 Docker socket

Acesso direto ao socket deve receber uma seção de segurança destacada. Como evolução, considerar:

- Docker socket proxy com allowlist de endpoints;

- conexão TLS com daemon remoto;

- host agent separado com API mínima;

- escopo por host e auditoria de cada chamada;

- bloqueio de `privileged`, host network e mounts arbitrários por padrão.

O objetivo é evitar que uma vulnerabilidade web no painel se transforme automaticamente em controle irrestrito do host.

## 8. Funcionalidades que mais aumentariam a competitividade

### 8.1 Deploy moderno

A próxima grande frente de produto deve ser o pipeline de deploy:

- GitHub, GitLab, Bitbucket e Gitea;

- deploy key e token cifrado;

- webhook assinado;

- branch e tag configuráveis;

- build Node, Python, PHP, estático, Dockerfile e Compose;

- logs de clone, build, publish e start separados;

- histórico de releases;

- rollback para release anterior;

- variáveis de ambiente por ambiente;

- ambientes de produção, homologação e preview;

- cancelamento e fila de deploy;

- health check antes de promover a versão.

O Coolify confirma esse conjunto de capacidades como referência de PaaS self-hosted. [3] O Pterodroid pode implementar uma versão menor, mas deve manter um contrato de deploy previsível.

### 8.2 Templates e receitas

O catálogo atual de receitas deve evoluir para templates versionados em YAML ou JSON, com schema validado. Cada template deve declarar:

- nome e versão;

- runtime;

- imagem ou comando;

- portas;

- volumes;

- variáveis obrigatórias;

- health check;

- recursos mínimos;

- procedimento de backup;

- riscos e permissões;

- documentação;

- compatibilidade de arquitetura.

Templates de terceiros devem ser assinados ou instalados apenas após confirmação. Não é suficiente permitir que um template execute qualquer comando sem mostrar o conteúdo ao usuário.

### 8.3 Rede, domínio e TLS

A integração Cloudflare Tunnel é um diferencial real e deve ser profissionalizada:

- cadastro seguro da credencial;

- criação e remoção de tunnel;

- hostnames e ingress por serviço;

- DNS e status de propagação;

- health do `cloudflared`;

- reconexão automática;

- logs e diagnóstico;

- suporte a proxy HTTP/HTTPS e WebSocket;

- documentação específica para bancos e TCP;

- prevenção de loops entre HTTP e HTTPS;

- certificado local ou proxy reverso para instalações sem Cloudflare.

Também é necessário adicionar proxy reverso local com Caddy, Nginx ou Traefik opcional, TLS automático e roteamento por domínio. O aaPanel confirma a expectativa de domínio, proxy reverso, SSL e administração de websites; o Coolify confirma proxy integrado, domínios e Cloudflare Tunnel. [3] [4]

### 8.4 Backups de produção

Os backups atuais de serviço devem ser ampliados para quatro camadas:

1. **Backup do painel:** banco, configurações e definições.

1. **Backup do workspace:** arquivos do serviço.

1. **Backup de banco:** dump consistente de PostgreSQL, MariaDB e MySQL.

1. **Backup off-site:** S3, Cloudflare R2, MinIO, FTP ou destino compatível.

Cada backup deve mostrar origem, tamanho, checksum, destino, versão, criptografia e resultado de restauração. A aplicação deve oferecer restauração seletiva e restauração completa. Um teste de restore automatizado deve ser possível em um workspace temporário.

A documentação de Coolify destaca que persistência não equivale a backup e que backups de aplicação, banco e volumes têm tratamentos diferentes. [3] Essa mesma distinção deve aparecer no Pterodroid.

### 8.5 Usuários, equipes e permissões

Não é necessário abandonar o modo single-user. A evolução pode ser gradual:

- fase 1: single-user com 2FA, sessões e auditoria;

- fase 2: usuários adicionais com papel administrador ou operador;

- fase 3: equipes, projetos e permissões por serviço;

- fase 4: quotas, convites, tokens e SSO.

As permissões devem ser definidas por capacidade, não por tela. Exemplos: iniciar serviço, editar arquivos, abrir terminal, ver segredos, restaurar backup, administrar Docker host e alterar configurações do painel.

## 9. Melhorias no frontend e experiência de uso

A interface já tem boa cobertura funcional, mas deve adotar um modelo de operação orientado a estados e risco.

### Dashboard

O dashboard deve mostrar saúde geral, serviços degradados, jobs em andamento, backups atrasados, disco disponível, alertas recentes e acesso rápido ao diagnóstico. Não deve mostrar apenas contadores.

### Criação de serviço

O fluxo deve ser dividido em etapas: origem, runtime, recursos, rede, variáveis, armazenamento, health check e revisão. A revisão final deve mostrar exatamente quais comandos serão executados e quais permissões serão concedidas.

### Logs

A tela de logs deve unificar logs de runtime, deploy, terminal e auditoria, mas manter filtros separados. Deve suportar busca, nível, período, download, pausa de stream e retenção.

### Terminal

O projeto deve continuar declarando que o terminal atual é orientado a comandos e não um PTY completo. Depois, pode oferecer PTY opcional em Linux e Docker, com resize, stdin, encerramento e permissão própria. O terminal do host nunca deve ser confundido com o terminal do container.

A preferência de interação recomendada para o painel é: ao abrir ou receber a primeira interação, exibir imediatamente o painel principal; quando o usuário enviar texto fora das ações disponíveis, responder de forma conversacional e orientar para a função correspondente. Essa lógica mantém a navegação guiada sem transformar entradas inesperadas em erro seco.

### Operações destrutivas

Remover serviço, apagar workspace, apagar volume, restaurar backup e remover Docker host devem exigir confirmação contextual. A confirmação deve mostrar o nome, caminho, volume, tamanho estimado e o que não poderá ser recuperado.

## 10. Qualidade, CI/CD e manutenção

O repositório precisa de um pipeline oficial. A ausência de `.github/workflows` no estado analisado indica que a qualidade depende principalmente de execução manual.

Pipeline recomendado:

1. `npm ci` em backend, frontend e documentação.

1. lint e formatação.

1. testes unitários.

1. testes HTTP de integração.

1. build de frontend e documentação.

1. verificação de scripts shell com ShellCheck.

1. validação de `docker build` e `docker compose config`.

1. teste com Docker Engine real em job separado.

1. teste de migração a partir de um banco fixture de cada versão.

1. `npm audit` ou ferramenta equivalente com política documentada.

1. geração de SBOM.

1. publicação de imagem versionada somente após todos os checks.

Também é necessário corrigir o runner para que qualquer teste abortado, dependência ausente ou servidor que não subiu gere uma falha claramente classificada. O fato de uma execução inicial produzir vários erros secundários de JSON quando o servidor não iniciou mostra que os smoke tests precisam verificar pré-condições e preservar o erro raiz.

## 11. Roadmap recomendado

### Fase 0 — estabilização, 1 a 2 semanas

- adicionar CI;

- adicionar `panelctl doctor`;

- validar instalação limpa em Ubuntu 22.04/24.04;

- validar Fedora e ARM64;

- adicionar unidade systemd opcional;

- eliminar execução root padrão;

- melhorar mensagens do smoke test;

- testar migrações e backup do banco;

- documentar matriz de compatibilidade.

**Critério de saída:** uma instalação limpa em Linux cria o usuário de serviço, inicia, reinicia, atualiza e restaura dados sem intervenção manual inesperada.

### Fase 1 — produção pessoal, 3 a 6 semanas

- fila de jobs;

- retenção de logs;

- métricas históricas;

- alertas por limiar;

- 2FA;

- sessões e revogação;

- auditoria centralizada;

- backups off-site;

- dump engine-aware dos bancos;

- proxy reverso e TLS;

- hardening do Docker socket.

**Critério de saída:** o operador consegue instalar em VPS, publicar um serviço, receber alerta de falha, recuperar um backup e auditar a operação.

### Fase 2 — deploy e templates, 6 a 12 semanas

- Git e webhooks assinados;

- deploy assíncrono;

- build Dockerfile/Compose;

- releases e rollback;

- templates versionados;

- ambientes de staging;

- importação de Compose existente;

- API OpenAPI e tokens scoped.

**Critério de saída:** uma aplicação pode ser publicada a partir de Git, atualizada por webhook, ver logs de build e voltar à release anterior.

### Fase 3 — equipes e multi-host, 3 a 6 meses

- usuários e papéis;

- equipes e projetos;

- hosts remotos por SSH ou agent;

- políticas por host;

- quotas;

- SSO/OIDC;

- notificações e integrações externas;

- marketplace seguro de templates.

**Critério de saída:** uma pequena equipe consegue compartilhar serviços sem expor segredos ou conceder acesso global ao Docker.

## 12. Matriz de prioridades

| Item | Impacto | Risco | Prioridade |
| --- | --- | --- | --- |
| Execução sem root e hardening do socket | Muito alto | Muito alto | P0 |
| CI, pré-voo e instalação limpa | Muito alto | Alto | P0 |
| Fila de jobs e estados persistentes | Muito alto | Alto | P0 |
| Backups off-site e restore testável | Muito alto | Alto | P0 |
| 2FA, sessões e auditoria central | Alto | Alto | P0 |
| systemd opcional e health operacional | Alto | Médio | P1 |
| Métricas históricas e alertas | Alto | Médio | P1 |
| Proxy reverso, TLS e domínio | Alto | Médio | P1 |
| Git/webhook/build/rollback | Muito alto | Alto | P1 |
| Templates versionados | Alto | Médio | P1 |
| Multiusuário e RBAC | Alto | Alto | P2 |
| Multi-host | Alto | Muito alto | P2 |
| Marketplace de plugins | Médio | Alto | P3 |
| PTY completo | Médio | Médio | P3 |

## 13. Decisões que precisam ser tomadas pelo projeto

Antes de implementar tudo, o mantenedor deve registrar decisões explícitas:

1. O produto continuará pessoal ou terá objetivo comercial multiusuário?

1. O runtime principal será processo local, Docker ou ambos com o mesmo nível de suporte?

1. O acesso ao Docker socket será aceito como padrão ou somente via agent/proxy?

1. `sql.js` continuará sendo o banco de todos os modos ou haverá SQLite nativo/PostgreSQL opcional?

1. Cloudflare Tunnel será diferencial central ou apenas integração opcional?

1. O painel terá suporte oficial a systemd, ou continuará deliberadamente independente de init?

1. O foco será hosting de aplicações web, bots, bancos, game servers ou uma combinação com templates?

1. Haverá um modo de produção com upgrades e migrações suportados, separado do modo experimental para Termux?

A recomendação é responder “ambos” apenas quando houver uma fronteira técnica clara. Suportar tudo sem definir limites gera interfaces ambíguas, permissões excessivas e testes incompletos.

## 14. Veredito final

O Pterodroid é viável como painel Linux e já possui componentes suficientes para atingir uma versão de produção pessoal. Ele não precisa ser refeito. A próxima etapa deve ser uma **versão Linux 1.0**, com instalação não-root, CI, jobs persistentes, backups confiáveis, segurança de Docker, 2FA, métricas, alertas, proxy/TLS e documentação de recuperação.

Depois disso, o projeto poderá competir de forma honesta em três nichos:

- contra painéis pessoais pesados, pela simplicidade e operação local-first;

- contra soluções de deploy, pela combinação de processos locais, Docker, bancos e terminal em uma interface única;

- contra painéis Linux tradicionais, pela integração moderna com containers, Git e Cloudflare Tunnel.

A principal métrica de sucesso não deve ser a quantidade de telas. Deve ser a capacidade de um usuário instalar o painel em um Linux limpo, publicar um serviço, atualizá-lo, detectar uma falha, restaurar os dados e compreender exatamente o que o sistema fez.

## Referências

[1]: https://github.com/theeussx/pterodroid "Repositório oficial do Pterodroid"

[2]: https://pterodactyl.io/ "Pterodactyl — site oficial"

[3]: https://coolify.io/docs/core/what-is-coolify "Coolify — documentação oficial: o que é o Coolify"

[4]: https://www.aapanel.com/docs/guide/quickstart.html "aaPanel — documentação oficial de início rápido"

[5]: https://github.com/pterodactyl/panel "Pterodactyl Panel — repositório oficial"

[6]: https://github.com/pterodactyl/wings "Pterodactyl Wings — repositório oficial"

[7]: https://coolify.io/docs/applications/deployments/overview "Coolify — documentação oficial de deployments"

[8]: https://coolify.io/docs/core/backup-and-recovery/instance-backup "Coolify — documentação oficial de backup e recuperação"

[9]: https://coolify.io/docs/integrations/cloudflare/tunnels/all-resource "Coolify — documentação oficial de Cloudflare Tunnel"

[10]: https://www.aapanel.com/docs/Function/Docker.html "aaPanel — documentação oficial do gerenciamento Docker"

[11]: https://www.aapanel.com/docs/Function/Monitor.html "aaPanel — documentação oficial de monitoramento"

[12]: https://www.aapanel.com/docs/Function/Account.html "aaPanel — documentação oficial de contas e subcontas"

[13]: https://pterodactyl.io/panel/1.0/configuration.html "Pterodactyl — documentação oficial de configuração do Panel"

[14]: https://pterodactyl.io/wings/1.0/configuration.html "Pterodactyl — documentação oficial de configuração do Wings"

[15]: https://coolify.io/docs/core/team/roles-and-permissions "Coolify — documentação oficial de equipes e permissões"

[16]: https://www.aapanel.com/docs/Function/Terminal.html "aaPanel — documentação oficial do terminal"

[17]: https://www.aapanel.com/docs/Function/Tutorial/How_to_Backup_Data_to_Cloudflare_R2_Object_Storage_using_Aws_S3.html "aaPanel — documentação oficial de backup em Cloudflare R2 via S3"

[18]: https://coolify.io/docs/core/security-model "Coolify — documentação oficial do modelo de segurança"

[19]: https://pterodactyl.io/guides/mounts.html "Pterodactyl — documentação oficial de mounts"

[20]: https://coolify.io/docs/api "Coolify — documentação oficial da API"

[21]: https://www.aapanel.com/docs/api/api-list.html "aaPanel — documentação oficial da API"

[22]: https://github.com/coollabsio/coolify "Coolify — repositório oficial"

[23]: https://github.com/aapanel/aaPanel "aaPanel — repositório oficial"

[24]: https://www.aapanel.com/docs/Function/Logs.html "aaPanel — documentação oficial de logs"

[25]: https://coolify.io/docs/core/observability/monitoring/overview "Coolify — documentação oficial de monitoramento"

[26]: https://pterodactyl.io/panel/1.0/webserver_configuration.html "Pterodactyl — documentação oficial de configuração do web server"

[27]: https://coolify.io/docs/core/notifications/overview "Coolify — documentação oficial de notificações"

[28]: https://www.aapanel.com/docs/Function/Deployment.html "aaPanel — documentação oficial de deployment"

[29]: https://coolify.io/docs/mcp/what-is-mcp "Coolify — documentação oficial de MCP"

[30]: https://www.aapanel.com/docs/Function/AppStore.html "aaPanel — documentação oficial da App Store"

[31]: https://pterodactyl.io/panel/1.0/additional_configuration.html "Pterodactyl — documentação oficial de configuração adicional"

[32]: https://coolify.io/docs/databases/backups "Coolify — documentação oficial de backups de bancos"

[33]: https://www.aapanel.com/docs/Function/Security.html "aaPanel — documentação oficial de segurança"

[34]: https://coolify.io/docs/core/infrastructure/servers/web-terminal "Coolify — documentação oficial do Web Terminal"

[35]: https://www.aapanel.com/docs/SubaaPanel/Overview.html "aaPanel — documentação oficial de subcontas"

[36]: https://pterodactyl.io/tutorials/mysql_setup.html "Pterodactyl — documentação oficial de configuração MySQL"

[37]: https://coolify.io/docs/core/security/credentials/api-tokens "Coolify — documentação oficial de tokens de API"

[38]: https://www.aapanel.com/docs/Function/Node.html "aaPanel — documentação oficial de Node.js"

[39]: https://coolify.io/docs/services/introduction "Coolify — documentação oficial de serviços"

[40]: https://www.aapanel.com/docs/Function/MySQL.html "aaPanel — documentação oficial de MySQL"

[41]: https://pterodactyl.io/guides/backup.html "Pterodactyl — documentação oficial de backups"

[42]: https://coolify.io/docs/core/networking/domains "Coolify — documentação oficial de domínios e proxy"

[43]: https://www.aapanel.com/docs/Function/Tutorial/panel_access_using_domain.html "aaPanel — documentação oficial de acesso por domínio"

[44]: https://pterodactyl.io/panel/1.0/getting_started.html "Pterodactyl — documentação oficial de instalação inicial"

[45]: https://coolify.io/docs/core/backup-and-recovery/overview "Coolify — documentação oficial de backup e recuperação"

[46]: https://www.aapanel.com/docs/Function/Plug-ins.html "aaPanel — documentação oficial de plugins"

[47]: https://pterodactyl.io/panel/1.0/api.html "Pterodactyl — documentação oficial de API"

[48]: https://coolify.io/docs/core/observability/log-drains/overview "Coolify — documentação oficial de log drains"

[49]: https://www.aapanel.com/docs/Function/DNS.html "aaPanel — documentação oficial de DNS"

[50]: https://pterodactyl.io/security/ "Pterodactyl — página oficial de segurança"

[51]: https://coolify.io/docs/core/notifications/overview "Coolify — documentação oficial de notificações e alertas"

[52]: https://www.aapanel.com/docs/Function/Firewall.html "aaPanel — documentação oficial de firewall"

[53]: https://pterodactyl.io/wings/1.0/installing.html "Pterodactyl — documentação oficial de instalação do Wings"

[54]: https://coolify.io/docs/core/security/authentication/oauth/overview "Coolify — documentação oficial de OAuth"

[55]: https://www.aapanel.com/docs/Function/Settings.html "aaPanel — documentação oficial de configurações do painel"

[56]: https://pterodactyl.io/guides/mounts.html "Pterodactyl — documentação oficial de mounts permitidos"

[57]: https://coolify.io/docs/applications/builds/overview "Coolify — documentação oficial de builds"

[58]: https://www.aapanel.com/docs/Function/Monitor.html "aaPanel — documentação oficial de monitoramento do sistema"

[59]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial do Panel 1.x"

[60]: https://coolify.io/docs/core/infrastructure/servers/overview "Coolify — documentação oficial de servidores"

[61]: https://www.aapanel.com/docs/guide/deploywebsite.html "aaPanel — documentação oficial de deployment de websites"

[62]: https://pterodactyl.io/guides/creating_custom_docker_image.html "Pterodactyl — documentação oficial de imagens Docker personalizadas"

[63]: https://coolify.io/docs/core/team/roles-and-permissions "Coolify — documentação oficial de papéis e permissões"

[64]: https://www.aapanel.com/docs/Function/Backup.html "aaPanel — documentação oficial de backups"

[65]: https://pterodactyl.io/panel/1.0/users.html "Pterodactyl — documentação oficial de usuários"

[66]: https://coolify.io/docs/core/observability/overview "Coolify — documentação oficial de observabilidade"

[67]: https://www.aapanel.com/docs/Function/CloudFlare.html "aaPanel — documentação oficial de Cloudflare"

[68]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial do painel e servidores"

[69]: https://coolify.io/docs/core/backup-and-recovery/instance-backup "Coolify — documentação oficial de backup da instância"

[70]: https://www.aapanel.com/docs/guide/quickstart.html "aaPanel — documentação oficial de instalação"

[71]: https://pterodactyl.io/wings/1.0/ "Pterodactyl — documentação oficial do Wings"

[72]: https://coolify.io/docs/core/security/credentials/api-tokens "Coolify — documentação oficial de tokens scoped"

[73]: https://www.aapanel.com/docs/Function/Deployment.html "aaPanel — documentação oficial de deployment e WebHook"

[74]: https://pterodactyl.io/guides/ "Pterodactyl — guias oficiais"

[75]: https://coolify.io/docs/core/networking/domains "Coolify — documentação oficial de networking"

[76]: https://www.aapanel.com/docs/Function/Logs.html "aaPanel — documentação oficial de logs e diagnóstico"

[77]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial de painel e servidores"

[78]: https://coolify.io/docs/core/observability/monitoring/overview "Coolify — documentação oficial de métricas"

[79]: https://www.aapanel.com/docs/Function/Account.html "aaPanel — documentação oficial de quotas e contas"

[80]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial de subusuários"

[81]: https://coolify.io/docs/core/infrastructure/servers/web-terminal "Coolify — documentação oficial de terminal"

[82]: https://www.aapanel.com/docs/Function/Terminal.html "aaPanel — documentação oficial de terminal de servidor"

[83]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial de ciclo de vida"

[84]: https://coolify.io/docs/core/security-model "Coolify — documentação oficial de responsabilidade de segurança"

[85]: https://www.aapanel.com/docs/Function/Security.html "aaPanel — documentação oficial de segurança do painel"

[86]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial de alocações"

[87]: https://coolify.io/docs/integrations/cloudflare/tunnels/all-resource "Coolify — documentação oficial de Tunnel para todos os recursos"

[88]: https://www.aapanel.com/docs/Function/Docker.html "aaPanel — documentação oficial de containers, Compose e volumes"

[89]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial de console WebSocket"

[90]: https://coolify.io/docs/core/notifications/overview "Coolify — documentação oficial de notificações"

[91]: https://www.aapanel.com/docs/Function/Plug-ins.html "aaPanel — documentação oficial de extensões"

[92]: https://pterodactyl.io/wings/1.0/configuration.html "Pterodactyl — documentação oficial de limites e configuração"

[93]: https://coolify.io/docs/core/backup-and-recovery/overview "Coolify — documentação oficial de recuperação"

[94]: https://www.aapanel.com/docs/Function/Backup.html "aaPanel — documentação oficial de backups agendados"

[95]: https://pterodactyl.io/guides/backup.html "Pterodactyl — documentação oficial de backup por servidor"

[96]: https://coolify.io/docs/core/observability/log-drains/overview "Coolify — documentação oficial de log drains"

[97]: https://www.aapanel.com/docs/Function/Monitor.html "aaPanel — documentação oficial de métricas e processos"

[98]: https://pterodactyl.io/panel/1.0/api.html "Pterodactyl — documentação oficial de API e automação"

[99]: https://coolify.io/docs/mcp/what-is-mcp "Coolify — documentação oficial de MCP e automação"

[100]: https://www.aapanel.com/docs/api/api-list.html "aaPanel — documentação oficial de API"

[101]: https://pterodactyl.io/panel/1.0/ "Pterodactyl — documentação oficial do painel web"

[102]: https://coolify.io/docs/core/what-is-coolify "Coolify — documentação oficial do produto"

[103]: https://www.aapanel.com/docs/guide/quickstart.html "aaPanel — documentação oficial do produto"
