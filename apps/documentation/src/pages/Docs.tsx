import { useEffect, useState } from 'react';
import { Link, navigate } from '../router';
import { site } from '../site';
import { docGroups, findDoc, groupOf, prevNext } from '../docs/registry';
import type { DocPage } from '../docs/types';

function Sidebar({ current, onNavigate }: { current: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Documentação" className="space-y-6">
      {docGroups.map((g) => (
        <div key={g.label}>
          <p className="mb-2 px-3 font-mono text-[10px] font-semibold tracking-widest text-fg-dim uppercase">{g.label}</p>
          <ul className="space-y-0.5">
            {g.pages.map((p) => {
              const active = p.slug === current;
              return (
                <li key={p.slug}>
                  <Link
                    to={`/docs/${p.slug}`}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`block rounded-md border-l-2 px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'border-cyan-neon bg-cyan-neon/10 font-medium text-cyan-neon'
                        : 'border-transparent text-fg-muted hover:bg-surface hover:text-fg'
                    }`}
                  >
                    {p.navLabel ?? p.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Toc({ page }: { page: DocPage }) {
  const [active, setActive] = useState('');
  useEffect(() => {
    const ids = page.sections.map((s) => s.id);
    const onScroll = () => {
      let cur = ids[0] ?? '';
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 120) cur = id;
      }
      setActive(cur);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [page]);

  if (page.sections.length === 0) return null;
  return (
    <nav aria-label="Nesta página" className="text-sm">
      <p className="mb-3 font-mono text-[10px] tracking-widest text-fg-dim uppercase">Nesta página</p>
      <ul className="space-y-1.5 border-l border-line">
        {page.sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#/docs/${page.slug}`}
              onClick={(e) => {
                e.preventDefault();
                document.getElementById(s.id)?.scrollIntoView();
              }}
              className={`-ml-px block border-l-2 py-0.5 pl-3 transition-colors ${
                active === s.id ? 'border-cyan-neon text-cyan-neon' : 'border-transparent text-fg-dim hover:text-fg'
              }`}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
      <a
        href={site.editBase + (page.sourcePath ?? 'README.md')}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex items-center gap-1.5 text-xs text-fg-dim transition-colors hover:text-cyan-neon"
      >
        ✎ Editar fonte no GitHub
      </a>
    </nav>
  );
}

export function DocsPage({ route }: { route: string }) {
  const slug = route === '/docs' ? 'introducao' : route.replace('/docs/', '');
  const page = findDoc(slug);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!page) return;
    document.title = `${page.title} · Pterodroid Docs`;
    return () => {
      document.title = 'Pterodroid — Painel self-hosted para Android, Termux, Linux e Docker';
    };
  }, [page]);

  useEffect(() => setMenuOpen(false), [route]);

  // rota de docs desconhecida → volta para o início das docs
  useEffect(() => {
    if (!page) navigate('/docs');
  }, [page]);

  if (!page) return null;

  const group = groupOf(page.slug);
  const { prev, next } = prevNext(page.slug);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 px-4">
      {/* Sidebar desktop */}
      <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-line py-8 pr-4 lg:block">
        <Sidebar current={page.slug} />
      </aside>

      {/* Conteúdo */}
      <main id="conteudo" className="min-w-0 flex-1 px-0 py-8 lg:px-10">
        {/* Navegação mobile */}
        <div className="mb-4 lg:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-expanded={menuOpen}
            className="flex w-full items-center justify-between rounded-lg border border-line bg-surface px-4 py-2.5 text-sm text-fg-muted"
          >
            <span>☰ Menu da documentação</span>
            <span aria-hidden="true" className="font-mono text-cyan-neon">{menuOpen ? '−' : '+'}</span>
          </button>
          {menuOpen && (
            <div className="mt-2 rounded-lg border border-line bg-surface p-4">
              <Sidebar current={page.slug} onNavigate={() => setMenuOpen(false)} />
            </div>
          )}
        </div>

        {/* Breadcrumbs */}
        <nav aria-label="Trilha de navegação" className="mb-3 flex flex-wrap items-center gap-1.5 font-mono text-xs text-fg-dim">
          <Link to="/" className="hover:text-cyan-neon">Início</Link>
          <span aria-hidden="true">/</span>
          <Link to="/docs" className="hover:text-cyan-neon">Docs</Link>
          {group && (
            <>
              <span aria-hidden="true">/</span>
              <span>{group.label}</span>
            </>
          )}
          <span aria-hidden="true">/</span>
          <span className="text-fg-muted">{page.navLabel ?? page.title}</span>
        </nav>

        <h1 className="text-3xl font-bold tracking-tight text-fg sm:text-4xl">{page.title}</h1>
        <p className="mt-2 text-lg leading-relaxed text-fg-muted">{page.description}</p>

        <article>{page.render()}</article>

        {/* Anterior / Próximo */}
        <nav aria-label="Páginas adjacentes" className="mt-14 grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
          {prev ? (
            <Link to={`/docs/${prev.slug}`} className="group rounded-lg border border-line bg-surface/40 p-4 transition-colors hover:border-cyan-neon/40">
              <span className="font-mono text-xs text-fg-dim">← Anterior</span>
              <span className="mt-1 block font-medium text-fg group-hover:text-cyan-neon">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link to={`/docs/${next.slug}`} className="group rounded-lg border border-line bg-surface/40 p-4 text-right transition-colors hover:border-cyan-neon/40">
              <span className="font-mono text-xs text-fg-dim">Próximo →</span>
              <span className="mt-1 block font-medium text-fg group-hover:text-cyan-neon">{next.title}</span>
            </Link>
          )}
        </nav>
      </main>

      {/* TOC desktop */}
      <aside className="sticky top-14 hidden max-h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto py-8 pl-4 xl:block">
        <Toc page={page} />
      </aside>
    </div>
  );
}
