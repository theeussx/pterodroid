import { useState, type ReactNode } from 'react';
import { C, Callout, CodeBlock, DocLink, Ext, H2, P, Ul } from '../../components/docui';
import { site } from '../../site';
import type { DocPage } from '../types';

/* ───────── Componente de problema (sintomas/causa/solução) ───────── */

function Problem({
  id,
  title,
  symptoms,
  cause,
  solution,
  commands,
}: {
  id: string;
  title: string;
  symptoms: string;
  cause: string;
  solution: ReactNode;
  commands?: { code: string; platform?: string; description?: string };
}) {
  return (
    <section id={id} className="my-6 scroll-mt-24 rounded-lg border border-line bg-surface/40 p-5">
      <h3 className="mb-3 text-lg font-semibold text-fg">{title}</h3>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="font-mono text-xs tracking-wide text-amber-300 uppercase">Sintomas</dt>
          <dd className="mt-0.5 text-fg-muted">{symptoms}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs tracking-wide text-blue-electric uppercase">Causa provável</dt>
          <dd className="mt-0.5 text-fg-muted">{cause}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs tracking-wide text-emerald-300 uppercase">Solução</dt>
          <dd className="mt-0.5 text-fg-muted [&_code]:text-cyan-neon">{solution}</dd>
        </div>
      </dl>
      {commands && <CodeBlock code={commands.code} platform={commands.platform} description={commands.description} />}
    </section>
  );
}

export const troubleshooting: DocPage = {
  slug: 'troubleshooting',
  title: 'Troubleshooting',
  description: 'Central de problemas do Pterodroid: sintomas, causa provável, solução e comandos para cada caso.',
  keywords: ['erro', 'não inicia', 'porta ocupada', 'página em branco', 'DOCKER_GID', 'wake lock', 'logs', 'upload falha', 'cloudflared', 'container', 'debug'],
  sourcePath: 'apps/documentation/src/docs/content/help.tsx',
  sections: [
    { id: 'coletar-logs', title: 'Antes de tudo: colete os logs' },
    { id: 'painel-nao-inicia', title: 'Painel não inicia' },
    { id: 'pagina-em-branco', title: 'Interface em branco' },
    { id: 'porta-ocupada', title: 'Porta 3001 ocupada' },
    { id: 'docker-nao-encontrado', title: 'Painel não enxerga o Docker' },
    { id: 'container-sem-arquivos', title: 'Container sobe sem os arquivos' },
    { id: 'servico-reinicia', title: 'Serviço reinicia em loop' },
    { id: 'arquivos-upload', title: 'Arquivos não aparecem / upload falha' },
    { id: 'cloudflare-nao-conecta', title: 'Cloudflare não conecta' },
    { id: 'termux-encerra', title: 'Termux encerra em segundo plano' },
  ],
  render: () => (
    <>
      <H2 id="coletar-logs">Antes de tudo: colete os logs</H2>
      <P>O log responde a maioria das perguntas. Sempre comece por ele:</P>
      <CodeBlock
        platform="termux/linux"
        code={`./panelctl.sh logs        # segue data/panel.out.log em tempo real
./panelctl.sh status      # o painel está de pé?`}
      />
      <CodeBlock platform="docker" code={`docker compose ps         # deve mostrar "healthy"
docker compose logs -f    # logs do container do painel`} />

      <Problem
        id="painel-nao-inicia"
        title="Painel não inicia"
        symptoms="panelctl.sh start falha ou o processo morre poucos segundos após nascer."
        cause="Erro de inicialização: porta ocupada, banco corrompido ou dependências do backend ausentes. O panelctl espera o healthcheck real em /api/health, então ele detecta esses casos e imprime as últimas linhas do log."
        solution={<>Leia as últimas linhas exibidas pelo próprio <C>panelctl.sh</C>. Se faltar <C>node_modules</C>, rode o instalador do seu ambiente novamente.</>}
        commands={{ code: `./panelctl.sh logs\ncd apps/backend && npm install   # se as dependências estiverem ausentes`, platform: 'termux/linux' }}
      />

      <Problem
        id="pagina-em-branco"
        title="Interface em branco"
        symptoms="O backend responde, mas o navegador mostra uma página vazia."
        cause="O frontend não foi compilado — o backend serve apps/frontend/dist, que não existe ainda. O panelctl.sh avisa sobre isso no start."
        solution={<>Compile o frontend e recarregue a página.</>}
        commands={{ code: `cd apps/frontend && npm install && npm run build`, platform: 'qualquer' }}
      />

      <Problem
        id="porta-ocupada"
        title="Porta 3001 ocupada"
        symptoms="Erro EADDRINUSE no log, ou o healthcheck nunca responde."
        cause="Outro processo (ou uma instância antiga do painel) já usa a porta 3001."
        solution={<>Defina outra porta com <C>PORT</C> no <C>apps/backend/.env</C> (ou no <C>.env</C> da raiz, no caso do Docker), ou encerre o processo antigo com <C>./panelctl.sh stop</C>.</>}
        commands={{ code: `echo "PORT=3002" >> apps/backend/.env\n./panelctl.sh restart`, platform: 'termux/linux' }}
      />

      <Problem
        id="docker-nao-encontrado"
        title="Painel não enxerga o Docker / containers"
        symptoms="A área Docker mostra erro de conexão ou nenhuma informação do daemon."
        cause="No modo Docker, o DOCKER_GID do .env não corresponde ao GID real do grupo docker do host — o container (sem privilégios) não consegue acessar /var/run/docker.sock. No modo local, o usuário pode não estar no grupo docker."
        solution={<>Confira o GID e ajuste o <C>.env</C>, depois recrie o container.</>}
        commands={{ code: `getent group docker | cut -d: -f3   # compare com DOCKER_GID no .env
docker compose up -d --build        # recrie após ajustar`, platform: 'host' }}
      />

      <Problem
        id="container-sem-arquivos"
        title="Container do serviço sobe sem os arquivos"
        symptoms="O container inicia, mas o diretório de trabalho está vazio dentro dele."
        cause="O painel roda dentro de um container e o bind mount usa um caminho que não existe no host."
        solution={<>Defina <C>HOST_WORKSPACES_ROOT</C> no <C>.env</C> com o caminho dos workspaces <strong>como o host o enxerga</strong>. Veja <DocLink to="/docs/docker-services">Serviços Docker</DocLink>.</>}
        commands={{ code: `HOST_WORKSPACES_ROOT=/home/voce/pterodroid/data/workspaces`, platform: '.env' }}
      />

      <Problem
        id="servico-reinicia"
        title="Serviço reinicia em loop"
        symptoms="O watchdog reinicia o serviço repetidamente, com intervalos crescentes (backoff)."
        cause="O processo está morrendo logo após iniciar: erro no código, dependência faltando, variável de ambiente ausente."
        solution={<>Abra os logs ao vivo do serviço e olhe a última exceção. Use o <DocLink to="/docs/terminal">terminal</DocLink> do serviço para rodar <C>npm install</C> ou testar o comando manualmente. O contador de reinícios zera após o serviço ficar estável por <C>RESTART_STABLE_MS</C> (padrão 60s).</>}
      />

      <Problem
        id="arquivos-upload"
        title="Arquivos não aparecem / upload falha"
        symptoms="Arquivos esperados não aparecem no gerenciador, ou o upload é rejeitado."
        cause="A visão global só mostra o que está dentro de FILES_ROOT (padrão: a raiz de workspaces). Uploads acima de UPLOAD_MAX_BYTES (padrão 2 GB) são rejeitados; o editor não abre arquivos acima de EDITOR_MAX_BYTES (2 MB)."
        solution={<>Confirme em qual raiz você está navegando e ajuste <C>FILES_ROOT</C>/<C>UPLOAD_MAX_BYTES</C> no <C>.env</C> se necessário — veja <DocLink to="/docs/configuracao">Configuração</DocLink>.</>}
      />

      <Problem
        id="cloudflare-nao-conecta"
        title="Cloudflare não conecta"
        symptoms="Túnel não sobe, ou o hostname não responde."
        cause="cloudflared ausente do PATH; Named Tunnel sem login (opção A); roteamento do hostname não configurado no dashboard (opção B); ou tentativa de acessar banco de dados via Quick Tunnel (não suportado)."
        solution={
          <Ul>
            <li>Instale o binário (<C>pkg install cloudflared</C> no Termux) ou aponte <C>CLOUDFLARED_BIN</C>.</li>
            <li>Opção A: rode <C>cloudflared tunnel login</C> antes de criar o túnel no painel.</li>
            <li>Opção B: configure o “Public Hostname” no dashboard Zero Trust — os campos de domínio do painel não se aplicam nesse modo.</li>
            <li>Bancos: apenas Named Tunnel + <C>cloudflared access tcp</C> no cliente.</li>
          </Ul>
        }
      />

      <Problem
        id="termux-encerra"
        title="Termux encerra em segundo plano"
        symptoms="O painel funciona com o Termux aberto, mas 'morre' quando a tela apaga ou após algum tempo."
        cause="O Android suspende ou mata o Termux para economizar bateria."
        solution={<>Ative o wake lock e desative a otimização de bateria para o Termux — passo a passo em <DocLink to="/docs/termux">Instalação no Termux</DocLink>.</>}
        commands={{ code: `pkg install termux-api -y\ntermux-wake-lock`, platform: 'termux' }}
      />

      <Callout type="note" title="Ainda travado?">
        <p>
          A seção 9 do <Ext href={site.repo.relatorio}>docs/RELATORIO.md</Ext> lista o que ainda não pôde ser testado
          pelo projeto. Se o seu caso não está aqui, abra uma issue em{' '}
          <Ext href={site.repo.issues}>github.com/theeussx/pterodroid/issues</Ext> com as últimas linhas do log.
        </p>
      </Callout>
    </>
  ),
};

/* ───────── FAQ ───────── */

function FaqItem({ q, children }: { q: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-line/60">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-4 text-left font-medium text-fg transition-colors hover:text-cyan-neon"
      >
        {q}
        <span aria-hidden="true" className={`font-mono text-cyan-neon transition-transform ${open ? 'rotate-45' : ''}`}>+</span>
      </button>
      {open && <div className="pb-4 text-sm leading-relaxed text-fg-muted [&_code]:text-cyan-neon">{children}</div>}
    </div>
  );
}

export const faq: DocPage = {
  slug: 'faq',
  title: 'Perguntas frequentes (FAQ)',
  navLabel: 'FAQ',
  description: 'Respostas diretas: root, Docker, Termux, Windows, bots de Discord, domínios próprios, backup e mais.',
  keywords: ['root', 'windows', 'discord bot', 'api', 'domínio', 'backup', 'dados', 'remoto', 'multi-usuário', 'sem docker'],
  sourcePath: 'apps/documentation/src/docs/content/help.tsx',
  sections: [{ id: 'perguntas', title: 'Perguntas' }],
  render: () => (
    <>
      <H2 id="perguntas">Perguntas</H2>
      <div className="my-4">
        <FaqItem q="Preciso de root no Android?">
          <p>
            <strong>Não.</strong> O Pterodroid roda inteiramente no userland do Termux (ou do Ubuntu proot). Nenhum
            passo da instalação exige root.
          </p>
        </FaqItem>
        <FaqItem q="Funciona sem Docker?">
          <p>
            <strong>Sim.</strong> O modo principal é gerenciar serviços como processos locais via{' '}
            <C>child_process</C> — é assim que ele roda no Termux e no proot, onde Docker não existe. O Docker é um
            runtime <em>adicional</em> quando há um Engine disponível.
          </p>
        </FaqItem>
        <FaqItem q="Funciona no Termux?">
          <p>
            <strong>Sim — é o ambiente principal do projeto.</strong> Toda a stack foi escolhida para evitar
            compilação nativa justamente para funcionar no Termux (SQLite via WASM, bcryptjs puro-JS etc.). Guia:{' '}
            <DocLink to="/docs/termux">Instalação no Termux</DocLink>.
          </p>
        </FaqItem>
        <FaqItem q="Funciona no Windows?">
          <p>
            <strong>Não há suporte oficial.</strong> Os caminhos suportados são Termux, Ubuntu proot, Linux e Docker.
            Rodar via Docker Desktop ou WSL pode funcionar, mas não é validado pelo projeto — trate como experimental.
          </p>
        </FaqItem>
        <FaqItem q="Posso hospedar bots de Discord?">
          <p>
            <strong>Sim.</strong> É um dos casos de uso centrais: clone via Git, <C>npm install</C> automático,
            watchdog com backoff e logs ao vivo. Veja <DocLink to="/docs/primeiro-servico">Primeiro serviço</DocLink>.
          </p>
        </FaqItem>
        <FaqItem q="Posso hospedar APIs e sites?">
          <p>
            <strong>Sim.</strong> APIs Node/TypeScript (com starter automático) e sites estáticos. Para expô-los à
            internet, use <DocLink to="/docs/cloudflare">Cloudflare Tunnel</DocLink>.
          </p>
        </FaqItem>
        <FaqItem q="Posso usar domínios próprios?">
          <p>
            <strong>Sim</strong>, via Named Tunnel da Cloudflare — gerenciado pelo painel (CLI) ou por token do
            dashboard Zero Trust. Detalhes em <DocLink to="/docs/cloudflare">Cloudflare</DocLink>.
          </p>
        </FaqItem>
        <FaqItem q="Posso acessar o painel remotamente?">
          <p>
            <strong>Sim.</strong> Quick Tunnel para acesso rápido/temporário (URL <C>*.trycloudflare.com</C>) ou Named
            Tunnel para URL fixa com seu domínio — sempre sem abrir portas no roteador. Troque a senha padrão antes de
            expor o painel.
          </p>
        </FaqItem>
        <FaqItem q="Onde ficam meus dados?">
          <p>
            Tudo em uma pasta só — banco, workspaces e configuração do cloudflared: <C>apps/backend/data/</C> (Termux,
            proot, Linux) ou <C>./data/</C> na raiz do projeto (Docker). Cada serviço tem seu workspace em{' '}
            <C>data/workspaces/&lt;nome&gt;</C>.
          </p>
        </FaqItem>
        <FaqItem q="Como faço backup?">
          <p>
            <strong>Backup = copiar a pasta de dados.</strong> Para começar do zero, apague-a. Para bancos de dados,
            pare a instância antes de copiar, garantindo consistência.
          </p>
        </FaqItem>
        <FaqItem q="Tem multi-usuário?">
          <p>
            <strong>Não.</strong> O Pterodroid é deliberadamente <strong>pessoal e single-user</strong> — não é uma
            plataforma multi-tenant nem um marketplace.
          </p>
        </FaqItem>
        <FaqItem q="O terminal roda vim/htop?">
          <p>
            <strong>Não.</strong> O terminal é orientado a comandos (sem PTY) — escolha deliberada para funcionar no
            Termux sem módulos nativos. Edite arquivos pelo <DocLink to="/docs/arquivos">editor do painel</DocLink> e
            monitore pelo <DocLink to="/docs/monitoramento">monitoramento</DocLink>.
          </p>
        </FaqItem>
      </div>
    </>
  ),
};
