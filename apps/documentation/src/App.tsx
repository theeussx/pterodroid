import { useCallback, useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/react';
import { useRoute, useScrollToTop } from './router';
import { Footer, Navbar, SearchModal, useSearchShortcut } from './components/chrome';
import { Landing } from './pages/Landing';
import { DownloadPage } from './pages/Download';
import { DocsPage } from './pages/Docs';

export default function App() {
  const route = useRoute();
  useScrollToTop(route);
  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  useSearchShortcut(openSearch);

  useEffect(() => {
    if (route === '/download') document.title = 'Download · Pterodroid';
    else if (!route.startsWith('/docs')) {
      document.title = 'Pterodroid — Painel self-hosted para Android, Termux, Linux e Docker';
    }
  }, [route]);

  let page;
  if (route.startsWith('/docs')) page = <DocsPage route={route} />;
  else if (route === '/download') page = <DownloadPage />;
  else page = <Landing />;

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-cyan-neon focus:px-3 focus:py-2 focus:text-ink"
      >
        Pular para o conteúdo
      </a>
      <Navbar route={route} onSearch={openSearch} />
      {page}
      <Footer />
      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
      <Analytics />
    </div>
  );
}
