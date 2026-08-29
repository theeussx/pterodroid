import type { DocGroup, DocPage } from './types';
import { instalacao, introducao, requisitos } from './content/intro';
import { docker, linux, proot, termux } from './content/install';
import { configuracao, primeiroAcesso, primeiroServico } from './content/firstSteps';
import { arquivos, bancos, dockerServices, terminal, tiposDedicados } from './content/guides';
import { cloudflare, monitoramento } from './content/remote';
import { seguranca } from './content/seguranca';
import { faq, troubleshooting } from './content/help';
import { arquitetura, changelog, desenvolvimento } from './content/project';

export const docGroups: DocGroup[] = [
  { label: 'Introdução', pages: [introducao, requisitos] },
  { label: 'Instalação', pages: [instalacao, termux, proot, docker, linux] },
  { label: 'Primeiros passos', pages: [primeiroAcesso, configuracao, primeiroServico] },
  { label: 'Guias', pages: [tiposDedicados, arquivos, terminal, dockerServices, bancos, cloudflare, monitoramento, seguranca] },
  { label: 'Ajuda', pages: [troubleshooting, faq] },
  { label: 'Projeto', pages: [arquitetura, desenvolvimento, changelog] },
];

export const allDocs: DocPage[] = docGroups.flatMap((g) => g.pages);

export function findDoc(slug: string): DocPage | undefined {
  return allDocs.find((d) => d.slug === slug);
}

export function groupOf(slug: string): DocGroup | undefined {
  return docGroups.find((g) => g.pages.some((p) => p.slug === slug));
}

export function prevNext(slug: string): { prev?: DocPage; next?: DocPage } {
  const i = allDocs.findIndex((d) => d.slug === slug);
  if (i === -1) return {};
  return { prev: allDocs[i - 1], next: allDocs[i + 1] };
}

/* ───────── Busca ───────── */

export interface SearchResult {
  page: DocPage;
  group: string;
  section?: { id: string; title: string };
  score: number;
}

function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function searchDocs(query: string): SearchResult[] {
  const q = norm(query.trim());
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  const results: SearchResult[] = [];

  for (const group of docGroups) {
    for (const page of group.pages) {
      const title = norm(page.title);
      const desc = norm(page.description);
      const keywords = norm(page.keywords.join(' '));
      let score = 0;
      let allMatch = true;
      for (const t of terms) {
        if (title.includes(t)) score += 10;
        else if (keywords.includes(t)) score += 6;
        else if (desc.includes(t)) score += 3;
        else allMatch = false;
      }
      // seções também contam
      let bestSection: { id: string; title: string } | undefined;
      for (const s of page.sections) {
        const st = norm(s.title);
        const matched = terms.filter((t) => st.includes(t)).length;
        if (matched === terms.length) {
          bestSection = s;
          score += 8;
          allMatch = true;
          break;
        }
        if (matched > 0 && !bestSection) {
          bestSection = s;
          score += 2;
        }
      }
      if (score > 0 && (allMatch || score >= 6)) {
        results.push({ page, group: group.label, section: bestSection, score });
      }
    }
  }
  return results.sort((a, b) => b.score - a.score).slice(0, 12);
}
