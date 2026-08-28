import { useState, type ReactNode } from 'react';
import { Link } from '../router';

/* ─────────────────────────── CodeBlock ─────────────────────────── */

function tokenizeBashLine(line: string, key: number): ReactNode {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#')) {
    return (
      <span key={key} className="tok-cmt">
        {line}
      </span>
    );
  }
  // tokenização leve: strings, variáveis, flags
  const parts: ReactNode[] = [];
  const regex = /("[^"]*"|'[^']*'|\$\([^)]*\)|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\s--?[A-Za-z][\w-]*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(line)) !== null) {
    if (m.index > last) parts.push(<span key={`${key}-p${i++}`}>{line.slice(last, m.index)}</span>);
    const tok = m[0];
    const cls = tok.trimStart().startsWith('-')
      ? 'tok-flag'
      : tok.startsWith('$')
        ? 'tok-var'
        : 'tok-str';
    parts.push(
      <span key={`${key}-t${i++}`} className={cls}>
        {tok}
      </span>,
    );
    last = m.index + tok.length;
  }
  if (last < line.length) parts.push(<span key={`${key}-e`}>{line.slice(last)}</span>);
  return <span key={key}>{parts}</span>;
}

export function CodeBlock({
  code,
  title,
  platform,
  description,
  lang = 'bash',
}: {
  code: string;
  title?: string;
  platform?: string;
  description?: string;
  lang?: 'bash' | 'text' | 'ini' | 'yaml';
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const lines = code.split('\n');
  return (
    <figure className="my-5 overflow-hidden rounded-lg border border-line bg-[#070c18]">
      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <span className="flex gap-1.5" aria-hidden="true">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a3b5e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a3b5e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#2a3b5e]" />
        </span>
        {title && <span className="ml-1 truncate font-mono text-xs text-fg-muted">{title}</span>}
        <span className="ml-auto flex items-center gap-2">
          {platform && (
            <span className="rounded border border-cyan-neon/30 bg-cyan-neon/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-cyan-neon">
              {platform}
            </span>
          )}
          <button
            type="button"
            onClick={copy}
            aria-label={copied ? 'Copiado' : 'Copiar comando'}
            className="rounded border border-line-2 px-2 py-0.5 font-mono text-[11px] text-fg-muted transition-colors hover:border-cyan-neon/50 hover:text-cyan-neon"
          >
            {copied ? '✓ copiado' : 'copiar'}
          </button>
        </span>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-fg" tabIndex={0}>
        <code>
          {lines.map((l, idx) => (
            <span key={idx} className="block">
              {lang === 'bash' ? tokenizeBashLine(l, idx) : l || '\u00a0'}
            </span>
          ))}
        </code>
      </pre>
      {description && (
        <figcaption className="border-t border-line/60 px-4 py-2 text-xs text-fg-dim">{description}</figcaption>
      )}
    </figure>
  );
}

/* ─────────────────────────── Callout ─────────────────────────── */

const calloutStyles = {
  note: { label: 'Nota', icon: 'ℹ', ring: 'border-blue-electric/40', bg: 'bg-blue-electric/5', text: 'text-blue-electric' },
  tip: { label: 'Dica', icon: '✦', ring: 'border-emerald-400/40', bg: 'bg-emerald-400/5', text: 'text-emerald-300' },
  warning: { label: 'Aviso', icon: '⚠', ring: 'border-amber-400/40', bg: 'bg-amber-400/5', text: 'text-amber-300' },
  important: { label: 'Importante', icon: '❗', ring: 'border-violet-400/40', bg: 'bg-violet-400/5', text: 'text-violet-300' },
  danger: { label: 'Perigo', icon: '✖', ring: 'border-red-400/40', bg: 'bg-red-400/5', text: 'text-red-300' },
} as const;

export type CalloutType = keyof typeof calloutStyles;

export function Callout({ type = 'note', title, children }: { type?: CalloutType; title?: string; children: ReactNode }) {
  const s = calloutStyles[type];
  return (
    <aside role="note" className={`my-5 rounded-lg border ${s.ring} ${s.bg} p-4`}>
      <p className={`mb-1.5 flex items-center gap-2 text-sm font-semibold ${s.text}`}>
        <span aria-hidden="true">{s.icon}</span>
        {title ?? s.label}
      </p>
      <div className="space-y-2 text-sm leading-relaxed text-fg-muted [&_code]:text-cyan-neon">{children}</div>
    </aside>
  );
}

/* ─────────────────────────── Tabs ─────────────────────────── */

export function Tabs({ tabs }: { tabs: { label: string; content: ReactNode }[] }) {
  const [active, setActive] = useState(0);
  return (
    <div className="my-5">
      <div role="tablist" aria-label="Alternar conteúdo" className="flex flex-wrap gap-1 rounded-t-lg border border-b-0 border-line bg-surface p-1.5">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            role="tab"
            aria-selected={active === i}
            onClick={() => setActive(i)}
            className={`rounded px-3 py-1.5 font-mono text-xs transition-colors ${
              active === i ? 'bg-cyan-neon/15 text-cyan-neon' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="rounded-b-lg border border-line bg-surface/40 px-4 py-1">
        {tabs[active].content}
      </div>
    </div>
  );
}

/* ─────────────────────────── Tipografia de docs ─────────────────────────── */

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group mt-12 mb-4 scroll-mt-24 border-b border-line pb-2 text-2xl font-bold tracking-tight text-fg">
      <a href={`#${window.location.hash.slice(1).split('#')[0]}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView(); }} className="hover:text-cyan-neon">
        {children}
      </a>
      <span className="ml-2 hidden text-cyan-neon/50 group-hover:inline" aria-hidden="true">#</span>
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mt-8 mb-3 scroll-mt-24 text-lg font-semibold text-fg">
      {children}
    </h3>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <p className="my-3 leading-relaxed text-fg-muted [&_strong]:text-fg">{children}</p>;
}

export function C({ children }: { children: ReactNode }) {
  return <code className="rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[0.85em] text-cyan-neon">{children}</code>;
}

export function Ul({ children }: { children: ReactNode }) {
  return <ul className="my-3 list-disc space-y-1.5 pl-6 text-fg-muted marker:text-cyan-neon/60 [&_strong]:text-fg">{children}</ul>;
}

export function Ol({ children }: { children: ReactNode }) {
  return <ol className="my-3 list-decimal space-y-1.5 pl-6 text-fg-muted marker:font-mono marker:text-cyan-neon/70 [&_strong]:text-fg">{children}</ol>;
}

export function Steps({ items }: { items: { title: string; body?: ReactNode }[] }) {
  return (
    <ol className="my-5 space-y-0">
      {items.map((s, i) => (
        <li key={i} className="relative flex gap-4 pb-6 last:pb-0">
          {i < items.length - 1 && <span aria-hidden="true" className="absolute top-8 left-[15px] h-full w-px bg-line" />}
          <span className="z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-neon/40 bg-surface font-mono text-sm text-cyan-neon">
            {i + 1}
          </span>
          <div className="min-w-0 flex-1 pt-1">
            <p className="font-semibold text-fg">{s.title}</p>
            {s.body && <div className="mt-1 text-sm leading-relaxed text-fg-muted">{s.body}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function DocTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-5 overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-surface">
            {head.map((h) => (
              <th key={h} scope="col" className="px-4 py-2.5 font-semibold text-fg">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line/50 last:border-0 odd:bg-surface/30">
              {r.map((c, j) => (
                <td key={j} className="px-4 py-2.5 align-top text-fg-muted">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DocLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="font-medium text-cyan-neon underline decoration-cyan-neon/40 underline-offset-2 hover:decoration-cyan-neon">
      {children}
    </Link>
  );
}

export function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-cyan-neon underline decoration-cyan-neon/40 underline-offset-2 hover:decoration-cyan-neon"
    >
      {children}
      <span aria-hidden="true" className="ml-0.5 text-xs">↗</span>
    </a>
  );
}

export function VersionBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-2 bg-surface px-2.5 py-1 font-mono text-xs text-fg-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 pulse-dot" aria-hidden="true" />
      branch main · MIT
    </span>
  );
}
