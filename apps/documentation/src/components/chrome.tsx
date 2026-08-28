import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, navigate } from '../router';
import { site } from '../site';
import { searchDocs, type SearchResult } from '../docs/registry';

/* ───────── Busca global ───────── */

export function SearchModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = searchDocs(query);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelected(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  useEffect(() => setSelected(0), [query]);

  const go = useCallback(
    (r: SearchResult) => {
      onClose();
      navigate(`/docs/${r.page.slug}`);
      if (r.section) {
        setTimeout(() => document.getElementById(r.section!.id)?.scrollIntoView(), 80);
      }
    },
    [onClose],
  );

  if (!open) return null;

  // agrupa por categoria
  const grouped = new Map<string, SearchResult[]>();
  for (const r of results) {
    const arr = grouped.get(r.group) ?? [];
    arr.push(r);
    grouped.set(r.group, arr);
  }
  const flat = [...grouped.values()].flat();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/80 p-4 pt-[12vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Buscar na documentação"
      onClick={onClose}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-line-2 bg-surface shadow-2xl shadow-cyan-neon/5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <span aria-hidden="true" className="text-fg-dim">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, flat.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter' && flat[selected]) go(flat[selected]);
            }}
            placeholder="Pesquisar documentação… (ex.: docker mount, wake lock, porta)"
            aria-label="Pesquisar documentação"
            className="w-full bg-transparent py-3.5 text-sm text-fg placeholder:text-fg-dim focus:outline-none"
          />
          <kbd className="hidden rounded border border-line-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-dim sm:block">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-2">
          {query.trim().length >= 2 && flat.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-fg-dim">Nada encontrado para “{query}”.</p>
          )}
          {query.trim().length < 2 && (
            <p className="px-3 py-6 text-center text-sm text-fg-dim">
              Busque por títulos, comandos e termos técnicos — <span className="font-mono text-cyan-neon/80">DOCKER_GID</span>,{' '}
              <span className="font-mono text-cyan-neon/80">wake lock</span>, <span className="font-mono text-cyan-neon/80">tunnel</span>…
            </p>
          )}
          {[...grouped.entries()].map(([group, rs]) => (
            <div key={group}>
              <p className="px-3 pt-3 pb-1 font-mono text-[10px] tracking-widest text-fg-dim uppercase">{group}</p>
              {rs.map((r) => {
                const idx = flat.indexOf(r);
                return (
                  <button
                    key={r.page.slug + (r.section?.id ?? '')}
                    type="button"
                    onClick={() => go(r)}
                    onMouseEnter={() => setSelected(idx)}
                    className={`flex w-full items-baseline gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      idx === selected ? 'bg-cyan-neon/10 text-cyan-neon' : 'text-fg-muted'
                    }`}
                  >
                    <span className="font-medium text-fg">{r.page.title}</span>
                    {r.section && <span className="truncate text-xs text-fg-dim">› {r.section.title}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function useSearchShortcut(openSearch: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openSearch]);
}

/* ───────── Navbar ───────── */

export function Navbar({ route, onSearch }: { route: string; onSearch: () => void }) {
  const navLink = (to: string, label: string, active: boolean) => (
    <Link
      to={to}
      className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'text-cyan-neon' : 'text-fg-muted hover:text-fg'
      }`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </Link>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-4">
        <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-fg" aria-label="Pterodroid — início">
          <img src="./logo.png" alt="" width={28} height={28} className="rounded" />
          <span>Pterodroid</span>
        </Link>
        <span className="ml-1 hidden rounded-full border border-line-2 px-2 py-0.5 font-mono text-[10px] text-fg-dim sm:inline">
          {site.versionLabel}
        </span>
        <nav className="ml-auto flex items-center gap-0.5" aria-label="Navegação principal">
          {navLink('/docs', 'Docs', route.startsWith('/docs'))}
          {navLink('/download', 'Download', route === '/download')}
          <button
            type="button"
            onClick={onSearch}
            aria-label="Buscar na documentação (Ctrl+K)"
            className="mx-1 flex items-center gap-2 rounded-lg border border-line-2 bg-surface px-2.5 py-1.5 text-sm text-fg-dim transition-colors hover:border-cyan-neon/40 hover:text-fg"
          >
            <span aria-hidden="true">⌕</span>
            <span className="hidden md:inline">Buscar</span>
            <kbd className="hidden rounded border border-line-2 px-1 font-mono text-[10px] lg:block">⌘K</kbd>
          </button>
          <a
            href={site.repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            aria-label="Repositório no GitHub"
          >
            <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            <span className="hidden lg:inline">GitHub</span>
          </a>
        </nav>
      </div>
    </header>
  );
}

/* ───────── Footer ───────── */

export function Footer() {
  return (
    <footer className="border-t border-line bg-ink-2">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="flex items-center gap-2 font-semibold text-fg">
            <img src="./logo.png" alt="" width={22} height={22} className="rounded" />
            Pterodroid
          </p>
          <p className="mt-2 max-w-xs text-sm text-fg-muted">
            Painel self-hosted leve para Android/Termux, Linux e Docker. Licença {site.license}.
          </p>
        </div>
        <nav aria-label="Documentação">
          <p className="mb-3 font-mono text-xs tracking-widest text-fg-dim uppercase">Documentação</p>
          <ul className="space-y-2 text-sm">
            <li><Link to="/docs" className="text-fg-muted hover:text-cyan-neon">Comece aqui</Link></li>
            <li><Link to="/docs/instalacao" className="text-fg-muted hover:text-cyan-neon">Instalação</Link></li>
            <li><Link to="/docs/primeiro-servico" className="text-fg-muted hover:text-cyan-neon">Primeiro serviço</Link></li>
            <li><Link to="/docs/troubleshooting" className="text-fg-muted hover:text-cyan-neon">Troubleshooting</Link></li>
            <li><Link to="/docs/faq" className="text-fg-muted hover:text-cyan-neon">FAQ</Link></li>
          </ul>
        </nav>
        <nav aria-label="Guias">
          <p className="mb-3 font-mono text-xs tracking-widest text-fg-dim uppercase">Guias</p>
          <ul className="space-y-2 text-sm">
            <li><Link to="/docs/termux" className="text-fg-muted hover:text-cyan-neon">Termux (Android)</Link></li>
            <li><Link to="/docs/docker" className="text-fg-muted hover:text-cyan-neon">Docker</Link></li>
            <li><Link to="/docs/cloudflare" className="text-fg-muted hover:text-cyan-neon">Cloudflare Tunnel</Link></li>
            <li><Link to="/docs/bancos" className="text-fg-muted hover:text-cyan-neon">Bancos de dados</Link></li>
            <li><Link to="/docs/arquitetura" className="text-fg-muted hover:text-cyan-neon">Arquitetura</Link></li>
          </ul>
        </nav>
        <nav aria-label="Projeto">
          <p className="mb-3 font-mono text-xs tracking-widest text-fg-dim uppercase">Projeto</p>
          <ul className="space-y-2 text-sm">
            <li><a href={site.repo.url} target="_blank" rel="noopener noreferrer" className="text-fg-muted hover:text-cyan-neon">Repositório ↗</a></li>
            <li><a href={site.repo.issues} target="_blank" rel="noopener noreferrer" className="text-fg-muted hover:text-cyan-neon">Issues ↗</a></li>
            <li><a href={site.repo.releases} target="_blank" rel="noopener noreferrer" className="text-fg-muted hover:text-cyan-neon">Releases ↗</a></li>
            <li><Link to="/docs/desenvolvimento" className="text-fg-muted hover:text-cyan-neon">Contribuir</Link></li>
            <li><a href={site.repo.license} target="_blank" rel="noopener noreferrer" className="text-fg-muted hover:text-cyan-neon">Licença MIT ↗</a></li>
          </ul>
        </nav>
      </div>
      <div className="border-t border-line/60 py-4 text-center font-mono text-xs text-fg-dim">
        Pterodroid · self-hosted · sem systemd · feito para rodar no seu bolso
      </div>
    </footer>
  );
}
