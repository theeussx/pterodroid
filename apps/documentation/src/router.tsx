import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

// Router mínimo baseado em hash — o site é servido como um único arquivo
// estático, então rotas por hash funcionam em qualquer host sem configuração.

export function normalizeHash(hash: string): string {
  let r = hash.replace(/^#/, '');
  if (!r.startsWith('/')) r = '/' + r;
  if (r.length > 1 && r.endsWith('/')) r = r.slice(0, -1);
  return r || '/';
}

export function useRoute(): string {
  const [route, setRoute] = useState(() => normalizeHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(normalizeHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(to: string) {
  window.location.hash = to;
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, children, ...rest }: LinkProps) {
  return (
    <a href={'#' + to} {...rest}>
      {children}
    </a>
  );
}

/** Rola para o topo quando a rota muda (respeitando reduced motion). */
export function useScrollToTop(route: string) {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [route]);
}
