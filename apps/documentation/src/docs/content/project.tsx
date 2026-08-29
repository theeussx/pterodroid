import { C, Callout, CodeBlock, DocTable, Ext, H2, P, Ul } from '../../components/docui';
import { site } from '../../site';
import type { DocPage } from '../types';

/* Diagrama oficial do repositório, servido junto com o site de documentação. */
export function ArchDiagram({ compact = false }: { compact?: boolean }) {
  return (
    <figure className={`${compact ? '' : 'my-6'} overflow-hidden rounded-xl border border-line bg-[#070c18] shadow-2xl shadow-cyan-neon/5`}>
      <a
        href={site.repo.arquiteturaPng}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Abrir o diagrama de arquitetura do Pterodroid em tamanho original"
        className="group block focus:outline-none"
      >
        <img
          src="./arquitetura.png"
          alt="Diagrama da arquitetura do Pterodroid: o aplicativo se conecta ao API Gateway, que coordena autenticação, processos, bancos, Docker e túneis sobre processos locais e containers."
          width={4096}
          height={2736}
          loading="lazy"
          decoding="async"
          className="h-auto w-full transition-opacity duration-200 group-hover:opacity-90"
        />
      </a>
      {!compact && (
        <figcaption className="border-t border-line px-4 py-2.5 text-center text-xs text-fg-dim">
          Diagrama oficial da arquitetura do Pterodroid.{' '}
          <Ext href={site.repo.arquiteturaPng}>Abrir em tamanho original</Ext>
        </figcaption>
      )}
    </figure>
  );
}

export const arquitetura: DocPage = {
  slug: 'arquitetura',
  title: 'Arquitetura do sistema',
  navLabel: 'Arquitetura',
  description: 'O modelo Supervisor-Filho do Pterodroid, seus componentes internos e as escolhas de tecnologia.',
  keywords: ['supervisor', 'child_process', 'express', 'socket.io', 'sql.js', 'wasm', 'jwt', 'bcryptjs', 'stack', 'tecnologias', 'diagrama'],
  sourcePath: 'README.md',
  sections: [
    { id: 'modelo', title: 'Modelo Supervisor-Filho' },
    { id: 'diagrama', title: 'Diagrama' },
    { id: 'componentes', title: 'Componentes' },
    { id: 'tecnologias', title: 'Tecnologias e justificativas' },
  ],
  render: () => (
    <>
      <H2 id="modelo">Modelo Supervisor-Filho</H2>
      <P>
        O backend é o <strong>orquestrador central</strong>: ele gerencia diretamente todos os processos de serviço e
        de banco de dados como filhos (<C>child_process</C>), eliminando a dependência de <C>pm2</C> ou{' '}
        <C>systemd</C> — crucial para compatibilidade com Android/Termux.
      </P>

      <H2 id="diagrama">Diagrama</H2>
      <ArchDiagram />

      <H2 id="componentes">Componentes</H2>
      <DocTable
        head={['Componente', 'Responsabilidade']}
        rows={[
          ['API Gateway', <>REST (Express) + WebSocket (Socket.io) + autenticação JWT com sessões de 7 dias.</>],
          ['Service Recipes', <>Catálogo de receitas dedicadas por tipo de serviço (porta, comando, runtime e template de projeto inicial).</>],
          ['Process Manager', <>Ciclo de vida dos serviços locais, watchdog com backoff, monitoração de stdout/stderr, healthcheck por serviço e limites de recurso via <C>prlimit</C>.</>],
          ['Healthcheck', <>Verifica a URL de cada serviço; se o processo estiver vivo mas não responder, encerra e reinicia como um crash normal.</>],
          ['Alertas', <>Notifica via webhook (Telegram/Discord/ntfy.sh) quando um serviço cai, entra em crash-loop ou quando o painel inicia.</>],
          ['Cifra em repouso', <>AES-256-GCM para <C>git_token</C> e o ambiente dos serviços; texto claro legado é migrado no boot.</>],
          ['Senha padrão obrigatória', <>Trava as rotas de negócio até a senha padrão ser trocada (defesa em profundidade: backend + frontend).</>],
          ['Docker Manager', <>Cliente da Docker Engine API (unix/tcp), containers de serviço, bind mounts, <C>docker exec</C>.</>],
          ['Workspace Manager', <>Um diretório exclusivo por serviço em <C>data/workspaces/&lt;nome&gt;</C>, criado automaticamente.</>],
          ['File Manager', <>Operações de arquivo com validação de caminho, escrita atômica, uploads via multer e auditoria.</>],
          ['Terminal', <>Execução de comandos por serviço (sem PTY), com <C>cd</C> persistente e saída ao vivo.</>],
          ['Database Manager', <>Provisionamento de PostgreSQL e MySQL/MariaDB como processos filhos.</>],
          ['Monitor', <>Métricas de CPU/RAM/disco/rede/temperatura/processos lidas de <C>/proc</C>, <C>/sys</C>, <C>ps</C>, <C>df</C>.</>],
          ['Tunnel Manager', <>Orquestração do <C>cloudflared</C>: Quick Tunnel e Named Tunnel (CLI ou token).</>],
        ]}
      />

      <H2 id="tecnologias">Tecnologias e justificativas</H2>
      <DocTable
        head={['Camada', 'Tecnologia', 'Por quê']}
        rows={[
          ['Frontend', 'React, Vite, Tailwind CSS v3', 'UI reativa; Tailwind v3 evita o oxide do v4 e mantém compatibilidade com ARM.'],
          ['Backend', 'Node.js, Express, Socket.io', 'Stack JS unificada; tempo real para logs e status.'],
          ['Banco interno', 'SQLite via sql.js (WASM)', 'Zero node-gyp — funciona no Termux sem compilação nativa.'],
          ['Processos', 'child_process', 'Controle direto, sem pm2/systemd.'],
          ['Arquivos', 'fs, path, multer', 'Validação de caminho, uploads multipart, auditoria.'],
          ['Autenticação', 'JWT, bcryptjs', 'Sem dependências nativas.'],
          ['Acesso remoto', 'cloudflared', 'Túneis seguros sem abrir portas.'],
          ['Monitoramento', '/proc, /sys/class/thermal, ps, df', 'Leitura direta do sistema, sem agentes.'],
          ['Ícones', 'lucide-react', 'Leve e modular.'],
        ]}
      />
    </>
  ),
};

export const desenvolvimento: DocPage = {
  slug: 'desenvolvimento',
  title: 'Desenvolvimento e contribuição',
  navLabel: 'Contribuição',
  description: 'Estrutura do repositório, como rodar os testes (mais de 160, sem Docker) e o fluxo de contribuição do Pterodroid.',
  keywords: ['contribuir', 'pull request', 'fork', 'testes', 'npm test', 'estrutura do repositório', 'licença mit', 'backend', 'frontend'],
  sourcePath: 'README.md',
  sections: [
    { id: 'estrutura', title: 'Estrutura do repositório' },
    { id: 'testes', title: 'Testes' },
    { id: 'contribuir', title: 'Como contribuir' },
    { id: 'licenca', title: 'Licença' },
  ],
  render: () => (
    <>
      <H2 id="estrutura">Estrutura do repositório</H2>
      <CodeBlock
        lang="text"
        title="theeussx/pterodroid"
        code={`pterodroid/
├── apps/
│   ├── backend/          # Node + Express + Socket.io (supervisor)
│   │   └── src/
│   │       ├── server.js     # bootstrap do servidor
│   │       ├── config.js     # variáveis de ambiente e padrões
│   │       ├── db/           # SQLite via sql.js (WASM)
│   │       ├── middleware/   # autenticação JWT
│   │       ├── routes/       # auth, services, files, terminal, docker,
│   │       │                 # databases, monitor, backups, settings
│   │       └── services/     # process manager, docker client, recipes,
│   │                         # arquivos, setup, túneis...
│   ├── frontend/         # React + Vite + Tailwind v3
│   └── documentation/    # site de documentação (este site)
├── docs/                 # AUDITORIA.md, RELATORIO.md
├── install-termux.sh     # instalador Termux
├── install-ubuntu-proot.sh
├── panelctl.sh           # start|stop|restart|status|logs
├── Dockerfile / docker-compose.yml / .dockerignore
├── .env.example          # referência de configuração
├── COMECE-AQUI.md        # guia rápido
└── README.md`}
      />

      <H2 id="testes">Testes</H2>
      <CodeBlock platform="qualquer" code={`cd backend
npm test`} description="mais de 160 testes. Não precisam de Docker e nunca tocam no painel real — rodam em diretórios temporários e porta separada." />
      <P>A suíte cobre:</P>
      <Ul>
        <li>resolução de caminhos e proteção contra path traversal;</li>
        <li>operações de arquivo;</li>
        <li>parser de comandos do terminal;</li>
        <li>cliente da Docker Engine e montagem de container (incluindo a tradução de bind mount para o host);</li>
        <li>ciclo de vida completo de um serviço via HTTP.</li>
      </Ul>
      <Callout type="note" title="Relatórios internos">
        <p>
          O diretório <C>docs/</C> do repositório contém a <Ext href={site.repo.auditoria}>AUDITORIA.md</Ext>{' '}
          (levantamento de problemas com evidências) e o <Ext href={site.repo.relatorio}>RELATORIO.md</Ext> (o que foi
          corrigido, como foi validado e o que ainda está pendente — seção 9). Vale ler antes de uso sério.
        </p>
      </Callout>

      <H2 id="contribuir">Como contribuir</H2>
      <CodeBlock
        platform="git"
        code={`# 1. Faça um fork do projeto
# 2. Crie uma branch para sua feature/correção
git checkout -b feature/minha-nova-feature
# 3. Faça e comente suas alterações
# 4. Envie para o seu fork
git push origin feature/minha-nova-feature
# 5. Abra um Pull Request no repositório principal`}
        description="Fluxo padrão fork → branch → PR, como descrito no README."
      />
      <P>
        Bugs e ideias: <Ext href={site.repo.issues}>abra uma issue</Ext>.
      </P>

      <H2 id="licenca">Licença</H2>
      <P>
        Distribuído sob a <strong>Licença MIT</strong> — veja o <Ext href={site.repo.license}>LICENSE.md</Ext>.
      </P>
    </>
  ),
};

export const changelog: DocPage = {
  slug: 'changelog',
  title: 'Changelog',
  description: 'Onde acompanhar as mudanças do Pterodroid: commits, releases e o relatório técnico do repositório.',
  keywords: ['versões', 'releases', 'novidades', 'mudanças', 'histórico', 'commits', 'relatorio'],
  sections: [
    { id: 'como-acompanhar', title: 'Como acompanhar as mudanças' },
    { id: 'estado-atual', title: 'Estado atual do projeto' },
  ],
  render: () => (
    <>
      <H2 id="como-acompanhar">Como acompanhar as mudanças</H2>
      <P>
        O Pterodroid ainda <strong>não mantém um arquivo CHANGELOG formal nem releases versionadas</strong> — a
        referência oficial é a branch <C>main</C>. Para não duplicar informação que ficaria desatualizada, este site
        aponta para as fontes vivas:
      </P>
      <DocTable
        head={['Fonte', 'O que você encontra']}
        rows={[
          [<Ext key="1" href={site.repo.commits}>Commits na main</Ext>, 'Histórico completo e mais atual de mudanças.'],
          [<Ext key="2" href={site.repo.releases}>Releases no GitHub</Ext>, 'Versões empacotadas, quando publicadas.'],
          [<Ext key="3" href={site.repo.relatorio}>docs/RELATORIO.md</Ext>, 'O que foi corrigido recentemente, como foi validado e o que ainda está pendente (seção 9).'],
          [<Ext key="4" href={site.repo.auditoria}>docs/AUDITORIA.md</Ext>, 'Levantamento de problemas encontrados, com evidências.'],
        ]}
      />
      <H2 id="estado-atual">Estado atual do projeto</H2>
      <Callout type="important">
        <p>
          Antes de colocar o painel em uso sério, leia a <strong>seção 9 do RELATORIO.md</strong> — ela lista os pontos
          que <strong>não puderam ser testados</strong> no ambiente onde o código foi preparado. Funcionalidades citadas
          lá devem ser tratadas como experimentais.
        </p>
      </Callout>
    </>
  ),
};
