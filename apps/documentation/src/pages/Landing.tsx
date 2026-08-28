import { useEffect, useRef, useState } from 'react';
import { Link } from '../router';
import { site } from '../site';
import { ArchDiagram } from '../docs/content/project';

/* ───────── Terminal animado (comandos reais de instalação) ───────── */

const TERMINAL_SCRIPT: { cmd?: string; out?: string[] }[] = [
  { cmd: 'pkg install git nodejs-lts cloudflared -y', out: ['✔ pacotes instalados'] },
  { cmd: 'git clone https://github.com/theeussx/pterodroid.git', out: ["Cloning into 'pterodroid'... done."] },
  { cmd: 'cd pterodroid && ./install-termux.sh', out: ['✔ dependências do backend e frontend prontas'] },
  { cmd: './panelctl.sh start', out: ['Iniciando Pterodroid...', 'Rodando (pid 21437) em http://localhost:3001', 'Logs em: data/panel.out.log'] },
];

function TerminalDemo() {
  const [lines, setLines] = useState<{ text: string; type: 'cmd' | 'out' }[]>([]);
  const [typing, setTyping] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      const all: { text: string; type: 'cmd' | 'out' }[] = [];
      for (const step of TERMINAL_SCRIPT) {
        if (step.cmd) all.push({ text: step.cmd, type: 'cmd' });
        for (const o of step.out ?? []) all.push({ text: o, type: 'out' });
      }
      setLines(all);
      return;
    }
    let cancelled = false;
    const run = async () => {
      const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
      await sleep(600);
      for (const step of TERMINAL_SCRIPT) {
        if (cancelled) return;
        if (step.cmd) {
          for (let i = 1; i <= step.cmd.length; i++) {
            if (cancelled) return;
            setTyping(step.cmd.slice(0, i));
            await sleep(18);
          }
          await sleep(250);
          setLines((l) => [...l, { text: step.cmd!, type: 'cmd' }]);
          setTyping('');
        }
        for (const o of step.out ?? []) {
          await sleep(320);
          if (cancelled) return;
          setLines((l) => [...l, { text: o, type: 'out' }]);
        }
        await sleep(400);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="overflow-hidden rounded-xl border border-line-2 bg-[#060b16] shadow-2xl shadow-cyan-neon/10">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-3 w-3 rounded-full bg-red-500/60" />
          <span className="h-3 w-3 rounded-full bg-amber-400/60" />
          <span className="h-3 w-3 rounded-full bg-emerald-400/60" />
        </span>
        <span className="ml-2 font-mono text-xs text-fg-dim">termux — instalação real</span>
        <span className="ml-auto rounded border border-cyan-neon/30 bg-cyan-neon/10 px-1.5 py-0.5 font-mono text-[10px] text-cyan-neon uppercase">android</span>
      </div>
      <div className="h-64 overflow-hidden p-4 font-mono text-[12.5px] leading-relaxed sm:h-72" aria-hidden="true">
        {lines.map((l, i) => (
          <p key={i} className={l.type === 'cmd' ? 'text-fg' : 'text-fg-dim'}>
            {l.type === 'cmd' && <span className="tok-prompt">$ </span>}
            {l.text}
          </p>
        ))}
        <p className="text-fg">
          <span className="tok-prompt">$ </span>
          {typing}
          <span className="cursor-blink inline-block h-4 w-2 translate-y-0.5 bg-cyan-neon" />
        </p>
      </div>
    </div>
  );
}

/* ───────── Mockup ilustrativo do painel ───────── */

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="flex justify-between font-mono text-[10px] text-fg-dim">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/60">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function PanelMockup() {
  return (
    <figure className="overflow-hidden rounded-xl border border-line-2 bg-[#070c18] shadow-2xl shadow-blue-deep/10">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-3 w-3 rounded-full bg-line-2" />
          <span className="h-3 w-3 rounded-full bg-line-2" />
          <span className="h-3 w-3 rounded-full bg-line-2" />
        </span>
        <span className="mx-auto flex items-center gap-1.5 rounded-md border border-line bg-ink px-3 py-1 font-mono text-[11px] text-fg-dim">
          <span aria-hidden="true" className="text-emerald-400">🔒</span> localhost:3001
        </span>
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-5">
        {/* serviços */}
        <div className="rounded-lg border border-line bg-surface/60 p-3 sm:col-span-3">
          <p className="mb-2 font-mono text-[10px] tracking-widest text-fg-dim uppercase">Serviços</p>
          {[
            { name: 'discord-bot', state: 'rodando', dot: 'bg-emerald-400', extra: 'node . · workspace/discord-bot' },
            { name: 'node-api', state: 'rodando', dot: 'bg-emerald-400', extra: 'src/index.ts · auto-update' },
            { name: 'postgres-dev', state: 'parado', dot: 'bg-fg-dim', extra: 'PostgreSQL · porta local' },
          ].map((s) => (
            <div key={s.name} className="mb-1.5 flex items-center gap-2 rounded-md border border-line/60 bg-ink/60 px-3 py-2 last:mb-0">
              <span className={`h-2 w-2 rounded-full ${s.dot} ${s.state === 'rodando' ? 'pulse-dot' : ''}`} aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate font-mono text-xs text-fg">{s.name}</p>
                <p className="truncate font-mono text-[10px] text-fg-dim">{s.extra}</p>
              </div>
              <span className={`ml-auto font-mono text-[10px] ${s.state === 'rodando' ? 'text-emerald-400' : 'text-fg-dim'}`}>{s.state}</span>
            </div>
          ))}
        </div>
        {/* monitoramento */}
        <div className="space-y-2.5 rounded-lg border border-line bg-surface/60 p-3 sm:col-span-2">
          <p className="font-mono text-[10px] tracking-widest text-fg-dim uppercase">Monitoramento</p>
          <Meter label="CPU" value={34} color="bg-cyan-neon" />
          <Meter label="RAM" value={58} color="bg-blue-electric" />
          <Meter label="Disco" value={41} color="bg-violet-400" />
          <div className="flex justify-between font-mono text-[10px] text-fg-dim">
            <span>↓ 1,2 MB/s · ↑ 240 KB/s</span>
            <span>38 °C</span>
          </div>
        </div>
        {/* logs */}
        <div className="rounded-lg border border-line bg-ink/80 p-3 font-mono text-[10.5px] leading-relaxed text-fg-dim sm:col-span-5">
          <p className="mb-1 text-[10px] tracking-widest uppercase">logs · discord-bot (ao vivo)</p>
          <p><span className="text-cyan-neon">[ws]</span> conectado ao gateway</p>
          <p><span className="text-emerald-400">[ok]</span> 42 comandos registrados</p>
          <p><span className="text-blue-electric">[info]</span> pronto — latência 87ms</p>
        </div>
      </div>
      <figcaption className="border-t border-line/60 px-4 py-2 text-center font-mono text-[10px] text-fg-dim">
        Representação ilustrativa do painel — componentes reais: serviços, monitoramento e logs ao vivo.
      </figcaption>
    </figure>
  );
}

/* ───────── Dados das seções ───────── */

const FEATURES = [
  { icon: '📱', title: 'Nasceu no Android', desc: 'Projetado para Termux e Ubuntu proot — sem systemd, sem root, sem compilação nativa.', to: '/docs/termux' },
  { icon: '🗂️', title: 'Workspaces isolados', desc: 'Cada serviço ganha um diretório exclusivo criado automaticamente. Você nunca toca no filesystem à mão.', to: '/docs/primeiro-servico' },
  { icon: '🛡️', title: 'Watchdog inteligente', desc: 'Serviços que caem voltam sozinhos, com backoff. Bancos ficam de fora — proteção contra corrupção.', to: '/docs/primeiro-servico' },
  { icon: '📁', title: 'Arquivos completos', desc: 'Editor integrado, upload de até 2 GB, escrita atômica, busca e log de auditoria.', to: '/docs/arquivos' },
  { icon: '💻', title: 'Terminal no navegador', desc: 'npm install, git pull e afins direto no workspace — com histórico, cd persistente e Ctrl+C.', to: '/docs/terminal' },
  { icon: '🐳', title: 'Docker de verdade', desc: 'Serviços em containers com bind mount do workspace, logs e exec — quando há um Engine disponível.', to: '/docs/docker-services' },
  { icon: '🗄️', title: 'Bancos locais', desc: 'PostgreSQL e MySQL/MariaDB provisionados como processos filhos, sem containers obrigatórios.', to: '/docs/bancos' },
  { icon: '🌐', title: 'Cloudflare Tunnel', desc: 'Quick Tunnel para testes e Named Tunnel com domínio próprio — sem abrir portas no roteador.', to: '/docs/cloudflare' },
  { icon: '📈', title: 'Monitoramento real', desc: 'CPU, RAM, disco, rede, temperatura e top 20 processos, lidos direto de /proc e /sys.', to: '/docs/monitoramento' },
  { icon: '📝', title: 'Logs ao vivo', desc: 'stdout/stderr em tempo real via WebSocket, com histórico em memória e no banco.', to: '/docs/primeiro-servico' },
  { icon: '🔒', title: 'Seguro por padrão', desc: 'JWT de 7 dias, senhas com bcryptjs e proteção contra path traversal coberta por testes.', to: '/docs/primeiro-acesso' },
  { icon: '🪶', title: 'Leve de verdade', desc: 'SQLite em WASM, zero node-gyp, zero agentes — roda até em hardware modesto.', to: '/docs/arquitetura' },
];

const PLATFORMS = [
  { icon: '🤖', name: 'Android', note: 'via Termux ou proot', to: '/docs/termux' },
  { icon: '🐚', name: 'Termux', note: 'ambiente principal', to: '/docs/termux' },
  { icon: '📦', name: 'Ubuntu Proot', note: 'userland completo', to: '/docs/proot' },
  { icon: '🐧', name: 'Linux', note: 'Node 18+, qualquer distro', to: '/docs/linux' },
  { icon: '🐳', name: 'Docker', note: 'compose com healthcheck', to: '/docs/docker' },
  { icon: '🍓', name: 'Raspberry Pi', note: 'ARM sem compilação nativa', to: '/docs/linux' },
  { icon: '☁️', name: 'VPS', note: 'manual ou Docker', to: '/docs/linux' },
  { icon: '🖥️', name: 'PC', note: 'Linux desktop', to: '/docs/linux' },
];

/* ───────── Página ───────── */

export function Landing() {
  return (
    <main id="conteudo">
      {/* HERO */}
      <section className="bg-grid relative overflow-hidden border-b border-line">
        <div aria-hidden="true" className="absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-blue-deep/20 blur-[120px]" />
        <div aria-hidden="true" className="absolute top-20 right-0 h-72 w-72 rounded-full bg-cyan-neon/10 blur-[100px]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-2">
          <div>
            <div className="fade-up flex flex-wrap items-center gap-2">
              <img src="./logo.png" alt="Logo do Pterodroid" width={44} height={44} className="rounded-lg border border-line-2" />
              <span className="rounded-full border border-cyan-neon/30 bg-cyan-neon/10 px-3 py-1 font-mono text-xs text-cyan-neon">painel self-hosted</span>
              <span className="rounded-full border border-line-2 bg-surface px-3 py-1 font-mono text-xs text-fg-muted">MIT · branch {site.versionLabel}</span>
            </div>
            <h1 className="fade-up-1 mt-6 text-4xl leading-tight font-bold tracking-tight text-fg sm:text-6xl">
              Seu servidor.
              <br />
              No seu <span className="bg-gradient-to-r from-cyan-neon to-blue-electric bg-clip-text text-transparent">dispositivo</span>.
              <br />
              Sob seu controle.
            </h1>
            <p className="fade-up-2 mt-6 max-w-xl text-lg leading-relaxed text-fg-muted">
              Um painel self-hosted leve para gerenciar <strong className="text-fg">serviços, containers, arquivos, bancos e túneis</strong>{' '}
              diretamente pelo navegador — inspirado no Pterodactyl, mas feito para rodar até no seu Android com Termux. Sem
              systemd. Sem root. Sem servidor alugado.
            </p>
            <div className="fade-up-3 mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/download"
                className="rounded-lg bg-gradient-to-r from-cyan-neon to-blue-electric px-6 py-3 font-semibold text-ink shadow-lg shadow-cyan-neon/25 transition-transform hover:scale-[1.03]"
              >
                Começar agora
              </Link>
              <Link to="/docs" className="rounded-lg border border-line-2 bg-surface px-6 py-3 font-semibold text-fg transition-colors hover:border-cyan-neon/50">
                Ver documentação
              </Link>
              <a
                href={site.repo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-line-2 px-6 py-3 font-semibold text-fg-muted transition-colors hover:border-line-2 hover:text-fg"
              >
                GitHub ↗
              </a>
            </div>
            <p className="fade-up-3 mt-6 font-mono text-xs text-fg-dim">
              Node.js · React · SQLite (WASM) · cloudflared — zero dependências nativas
            </p>
          </div>
          <div className="fade-up-2">
            <TerminalDemo />
          </div>
        </div>
      </section>

      {/* MOCKUP DO PAINEL */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:py-20" aria-labelledby="demo-title">
        <div className="mb-8 max-w-2xl">
          <p className="font-mono text-xs tracking-widest text-cyan-neon uppercase">O painel</p>
          <h2 id="demo-title" className="mt-2 text-3xl font-bold tracking-tight text-fg">Tudo pelo navegador — até do celular</h2>
          <p className="mt-3 text-fg-muted">
            Serviços, logs ao vivo, arquivos, terminal e monitoramento em uma interface responsiva construída com React e
            Tailwind, servida pelo próprio backend na porta 3001.
          </p>
        </div>
        <PanelMockup />
      </section>

      {/* DIFERENCIAIS */}
      <section className="border-y border-line bg-ink-2" aria-labelledby="feat-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:py-20">
          <p className="font-mono text-xs tracking-widest text-cyan-neon uppercase">Diferenciais</p>
          <h2 id="feat-title" className="mt-2 max-w-xl text-3xl font-bold tracking-tight text-fg">
            O que faz o Pterodroid ser diferente
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {FEATURES.map((f) => (
              <Link
                key={f.title}
                to={f.to}
                className="group rounded-xl border border-line bg-surface/50 p-5 transition-all hover:-translate-y-0.5 hover:border-cyan-neon/40 hover:bg-surface"
              >
                <span className="text-2xl" aria-hidden="true">{f.icon}</span>
                <h3 className="mt-3 font-semibold text-fg group-hover:text-cyan-neon">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{f.desc}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* FEITO PARA */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:py-20" aria-labelledby="plat-title">
        <p className="font-mono text-xs tracking-widest text-cyan-neon uppercase">Feito para rodar em</p>
        <h2 id="plat-title" className="mt-2 text-3xl font-bold tracking-tight text-fg">Do bolso ao datacenter</h2>
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PLATFORMS.map((p) => (
            <Link
              key={p.name}
              to={p.to}
              className="group flex flex-col items-center rounded-xl border border-line bg-surface/40 p-5 text-center transition-all hover:border-cyan-neon/40"
            >
              <span className="text-3xl" aria-hidden="true">{p.icon}</span>
              <span className="mt-2 font-semibold text-fg group-hover:text-cyan-neon">{p.name}</span>
              <span className="mt-0.5 font-mono text-[11px] text-fg-dim">{p.note}</span>
            </Link>
          ))}
        </div>
        <p className="mt-4 font-mono text-xs text-fg-dim">
          Windows não tem suporte oficial — veja o <Link to="/docs/faq" className="text-cyan-neon underline decoration-cyan-neon/40 underline-offset-2">FAQ</Link>.
        </p>
      </section>

      {/* ARQUITETURA */}
      <section className="border-y border-line bg-ink-2" aria-labelledby="arch-title">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-16 sm:py-20 lg:grid-cols-2">
          <div>
            <p className="font-mono text-xs tracking-widest text-cyan-neon uppercase">Arquitetura</p>
            <h2 id="arch-title" className="mt-2 text-3xl font-bold tracking-tight text-fg">Supervisor-Filho, sem intermediários</h2>
            <p className="mt-4 leading-relaxed text-fg-muted">
              O backend é o orquestrador central: gerencia serviços e bancos como processos filhos diretos —{' '}
              <strong className="text-fg">sem pm2, sem systemd</strong> — o que torna tudo compatível com Android. Quando há um
              Docker Engine, ele também vira runtime de serviços.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm text-fg-muted">
              <li className="flex gap-2"><span className="text-cyan-neon" aria-hidden="true">▸</span> REST + WebSocket com autenticação JWT</li>
              <li className="flex gap-2"><span className="text-cyan-neon" aria-hidden="true">▸</span> SQLite interno via sql.js (WASM) — zero compilação nativa</li>
              <li className="flex gap-2"><span className="text-cyan-neon" aria-hidden="true">▸</span> 163 testes no backend, rodando sem Docker</li>
            </ul>
            <Link to="/docs/arquitetura" className="mt-6 inline-block rounded-lg border border-line-2 bg-surface px-5 py-2.5 text-sm font-semibold text-fg transition-colors hover:border-cyan-neon/50">
              Explorar a arquitetura →
            </Link>
          </div>
          <ArchDiagram compact />
        </div>
      </section>

      {/* CTA FINAL */}
      <section className="mx-auto max-w-4xl px-4 py-20 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">
          Do <span className="bg-gradient-to-r from-cyan-neon to-blue-electric bg-clip-text text-transparent">git clone</span> ao primeiro serviço
          em minutos
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-fg-muted">
          A documentação leva você de “nunca ouvi falar” até o painel instalado e o primeiro serviço rodando — no Termux, no
          Docker ou no Linux.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/download" className="rounded-lg bg-gradient-to-r from-cyan-neon to-blue-electric px-6 py-3 font-semibold text-ink shadow-lg shadow-cyan-neon/25 transition-transform hover:scale-[1.03]">
            Escolher plataforma
          </Link>
          <Link to="/docs" className="rounded-lg border border-line-2 bg-surface px-6 py-3 font-semibold text-fg transition-colors hover:border-cyan-neon/50">
            Comece aqui
          </Link>
        </div>
      </section>
    </main>
  );
}
