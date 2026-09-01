/**
 * Versão desta documentação — injetada no build pelo vite.config.ts a partir
 * do Git do repositório (branch, commit curto/data). Se o build rodar fora de
 * um clone Git (ex.: npm pack), cai nos fallbacks abaixo.
 *
 * A intenção é resolver o item C5 da auditoria: cada página deve informar a
 * que versão/commit da documentação (e do painel) se refere, em vez de um
 * genérico "branch main".
 */
export const DOCS_COMMIT: string =
  (typeof __DOCS_COMMIT__ !== 'undefined' && __DOCS_COMMIT__) || 'main';

export const DOCS_BRANCH: string =
  (typeof __DOCS_BRANCH__ !== 'undefined' && __DOCS_BRANCH__) || 'main';

export const DOCS_COMMIT_FULL: string =
  (typeof __DOCS_COMMIT_FULL__ !== 'undefined' && __DOCS_COMMIT_FULL__) || '';

export const DOCS_UPDATED_AT: string =
  (typeof __DOCS_UPDATED_AT__ !== 'undefined' && __DOCS_UPDATED_AT__) || '';

/** Rótulo curto: "main @ 8e57708". */
export const DOCS_VERSION_LABEL = `${DOCS_BRANCH} @ ${DOCS_COMMIT}`;

/** Linha de "última atualização" para exibir nas páginas. */
export function docsUpdatedLabel(): string {
  const commit = DOCS_COMMIT_FULL ? DOCS_COMMIT_FULL.slice(0, 7) : DOCS_COMMIT;
  if (DOCS_UPDATED_AT) return `${commit} (${DOCS_BRANCH}) · ${DOCS_UPDATED_AT}`;
  return `${commit} (${DOCS_BRANCH})`;
}
