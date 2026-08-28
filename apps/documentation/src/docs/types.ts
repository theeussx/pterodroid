import type { ReactNode } from 'react';

export interface DocSection {
  id: string;
  title: string;
}

export interface DocPage {
  slug: string;
  title: string;
  /** Rótulo curto usado na sidebar (fallback: title). */
  navLabel?: string;
  description: string;
  /** Termos extras indexados pela busca (comandos, sinônimos, termos técnicos). */
  keywords: string[];
  sections: DocSection[];
  /** Arquivo do repositório que serve de fonte — usado no botão "Editar no GitHub". */
  sourcePath?: string;
  badge?: 'experimental' | 'novo';
  render: () => ReactNode;
}

export interface DocGroup {
  label: string;
  pages: DocPage[];
}
