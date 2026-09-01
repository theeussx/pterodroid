import { useEffect, useState, type AnchorHTMLAttributes } from 'react';

/** Normaliza URLs normais e mantém compatibilidade com links antigos usando hash. */
export function normalizeRoute(pathname: string, hash = ''): string {
  const hashRoute = hash.startsWith('#/') ? hash.slice(1) : '';
  let route = pathname && pathname !== '/' ? pathname : hashRoute || '/';
  if (!route.startsWith('/')) route = '/' + route;
  if (route.length > 1 && route.endsWith('/')) route = route.slice(0, -1);
  return route || '/';
}

export function normalizeHash(hash: string): string {
  return normalizeRoute('', hash);
}

export function useRoute(): string {
  const readRoute = () => normalizeRoute(window.location.pathname, window.location.hash);
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('popstate', onChange);
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('popstate', onChange);
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  return route;
}

export function navigate(to: string) {
  const target = to.startsWith('/') ? to : `/${to}`;
  window.history.pushState({}, '', target);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

export function Link({ to, children, ...rest }: LinkProps) {
  return (
    <a href={to.startsWith('/') ? to : `/${to}`} {...rest}>
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
