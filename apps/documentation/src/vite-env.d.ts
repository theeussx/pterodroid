/// <reference types="vite/client" />

/**
 * Constantes injetadas no build pelo vite.config.ts (define).
 * Sem elas o site ainda funciona com os fallbacks de version.ts.
 */
declare const __DOCS_COMMIT__: string | undefined;
declare const __DOCS_BRANCH__: string | undefined;
declare const __DOCS_COMMIT_FULL__: string | undefined;
declare const __DOCS_UPDATED_AT__: string | undefined;
