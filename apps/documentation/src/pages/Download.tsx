import { CodeBlock } from '../components/docui';
import { Link } from '../router';
import { site } from '../site';
import { BrandIcon, BRAND_ICONS } from '../components/BrandIcon';

const OPTIONS = [
  {
    icon: BRAND_ICONS.android,
    name: 'Android / Termux',
    desc: 'O caminho principal: painel completo rodando no celular, sem root.',
    to: '/docs/termux',
    platform: 'termux',
    code: `pkg update && pkg install git nodejs-lts cloudflared -y
git clone ${site.repo.clone}
cd pterodroid && chmod +x install-termux.sh panelctl.sh
./install-termux.sh && ./panelctl.sh start`,
  },
  {
    icon: BRAND_ICONS.ubuntu,
    name: 'Ubuntu Proot',
    desc: 'Userland Ubuntu completo dentro do Android, com o mesmo panelctl.sh.',
    to: '/docs/proot',
    platform: 'proot',
    code: `git clone ${site.repo.clone}
cd pterodroid && chmod +x install-ubuntu-proot.sh panelctl.sh
./install-ubuntu-proot.sh && ./panelctl.sh start`,
  },
  {
    icon: BRAND_ICONS.docker,
    name: 'Docker',
    desc: 'Compose com healthcheck, dados em ./data e gestão de containers do host.',
    to: '/docs/docker',
    platform: 'docker',
    code: `git clone ${site.repo.clone}
cd pterodroid && cp .env.example .env
echo "DOCKER_GID=$(getent group docker | cut -d: -f3)" >> .env
echo "JWT_SECRET=$(openssl rand -hex 32)" >> .env
docker compose up -d --build`,
  },
  {
    icon: BRAND_ICONS.linux,
    name: 'Linux',
    desc: 'Qualquer distro com Node 18+ — VPS, Raspberry Pi ou desktop.',
    to: '/docs/linux',
    platform: 'linux',
    code: `git clone ${site.repo.clone}
cd pterodroid/frontend && npm install && npm run build
cd ../backend && npm install && npm start`,
  },
];

export function DownloadPage() {
  return (
    <main id="conteudo" className="mx-auto max-w-5xl px-4 py-14">
      <p className="font-mono text-xs tracking-widest text-cyan-neon uppercase">Download · Get started</p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-fg">Escolha sua plataforma</h1>
      <p className="mt-3 max-w-2xl text-lg text-fg-muted">
        O Pterodroid é distribuído pelo código-fonte no GitHub — não há binários para baixar. Escolha o ambiente, copie os
        comandos e abra <code className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-sm text-cyan-neon">http://localhost:3001</code>.
      </p>

      <div className="mt-10 grid gap-6 lg:grid-cols-2">
        {OPTIONS.map((o) => (
          <section key={o.name} aria-label={o.name} className="flex flex-col rounded-xl border border-line bg-surface/40 p-5 transition-colors hover:border-cyan-neon/30">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-cyan-neon/30 bg-cyan-neon/10 text-cyan-neon" aria-hidden="true"><BrandIcon name={o.icon} className="h-7 w-7" /></span>
              <div>
                <h2 className="font-semibold text-fg">{o.name}</h2>
                <p className="text-sm text-fg-muted">{o.desc}</p>
              </div>
            </div>
            <CodeBlock code={o.code} platform={o.platform} />
            <Link
              to={o.to}
              className="mt-auto inline-block rounded-lg border border-line-2 bg-surface px-4 py-2 text-center text-sm font-semibold text-fg transition-colors hover:border-cyan-neon/50 hover:text-cyan-neon"
            >
              Tutorial completo →
            </Link>
          </section>
        ))}
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Repositório', href: site.repo.url, note: 'código-fonte na branch main' },
          { label: 'Releases', href: site.repo.releases, note: 'versões empacotadas, quando publicadas' },
          { label: 'Requisitos', to: '/docs/requisitos', note: 'o que cada ambiente precisa' },
          { label: 'Primeiro acesso', to: '/docs/primeiro-acesso', note: 'login, senha e verificação' },
        ].map((l) => (
          <div key={l.label} className="rounded-lg border border-line bg-surface/30 p-4">
            {l.href ? (
              <a href={l.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-neon hover:underline">
                {l.label} ↗
              </a>
            ) : (
              <Link to={l.to!} className="font-semibold text-cyan-neon hover:underline">
                {l.label}
              </Link>
            )}
            <p className="mt-1 text-xs text-fg-dim">{l.note}</p>
          </div>
        ))}
      </div>

      <p className="mt-10 rounded-lg border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-fg-muted">
        <strong className="text-amber-300">Atenção após a instalação:</strong> o login padrão é <code className="font-mono text-cyan-neon">admin</code>/
        <code className="font-mono text-cyan-neon">admin</code> — troque a senha imediatamente. O painel tem um terminal embutido: quem entrar
        com a senha padrão executa comandos no seu dispositivo.
      </p>
    </main>
  );
}
