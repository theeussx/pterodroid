import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

/**
 * useFileBrowser — todo o comportamento de um navegador de arquivos, sem
 * nenhuma marcação.
 *
 * A página global (Files.jsx) e o navegador dentro do serviço
 * (ServiceFileBrowser.jsx) tinham cópias quase idênticas desse estado, e
 * já haviam divergido: só o global tinha copiar/buscar. Com o hook, os
 * dois compartilham exatamente o mesmo comportamento e recebem apenas um
 * "adapter" com as chamadas de API do seu escopo.
 *
 * Também resolve dois bugs que as duas cópias tinham:
 *  - respostas fora de ordem: navegar rápido entre pastas podia deixar a
 *    listagem de uma pasta anterior na tela (a requisição mais lenta
 *    chegava por último);
 *  - seleção obsoleta: itens continuavam selecionados depois de deixarem
 *    de existir.
 */
export function useFileBrowser(adapter, { initialPath = '' } = {}) {
  const [path, setPath] = useState(initialPath);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const [busy, setBusy] = useState(false);

  // Cada carregamento recebe um número; só o mais recente pode escrever no
  // estado. Sem isso, clicar rápido em várias pastas deixa a tela mostrando
  // o conteúdo da pasta errada.
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async (targetPath = path) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError('');
    try {
      const result = await adapter.list(targetPath);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      const list = result.entries || [];
      setEntries(list);
      // Descarta da seleção o que não existe mais (arquivo apagado por
      // fora, ou renomeado por outra aba).
      setSelected((prev) => {
        if (prev.size === 0) return prev;
        const names = new Set(list.map((e) => e.name));
        const next = new Set([...prev].filter((n) => names.has(n)));
        return next.size === prev.size ? prev : next;
      });
    } catch (e) {
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      setError(e.message);
      setEntries([]);
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) setLoading(false);
    }
  }, [adapter, path]);

  // Trocar de pasta zera a seleção — manter selecionado o que está em outra
  // pasta faria a próxima ação agir sobre caminhos que nem estão na tela.
  useEffect(() => {
    setSelected(new Set());
    setSelectionMode(false);
    load(path);
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => {
    const sorters = {
      name: (a, b) => a.name.localeCompare(b.name),
      size: (a, b) => b.size - a.size,
      date: (a, b) => b.mtime - a.mtime,
      type: (a, b) => (a.ext || '').localeCompare(b.ext || ''),
    };
    const compare = sorters[sortBy] || sorters.name;
    // Pastas sempre primeiro, independentemente do critério.
    return [...entries].sort((a, b) => (a.type === b.type ? compare(a, b) : a.type === 'dir' ? -1 : 1));
  }, [entries, sortBy]);

  const toggleSelect = useCallback((entry) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(entry.name)) next.delete(entry.name);
      else next.add(entry.name);
      return next;
    });
  }, []);

  const startSelection = useCallback((entry) => {
    setSelectionMode(true);
    setSelected(new Set([entry.name]));
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setSelectionMode(false);
  }, []);

  const selectAll = useCallback(() => {
    setSelected(new Set(entries.map((e) => e.name)));
  }, [entries]);

  const joinCurrent = useCallback((name) => (path ? `${path}/${name}` : name), [path]);
  const selectedPaths = useCallback(() => [...selected].map(joinCurrent), [selected, joinCurrent]);

  /**
   * Envolve qualquer mutação: marca ocupado, recarrega ao final e devolve
   * o erro de forma consistente. Antes cada handler repetia esse
   * try/catch/finally com pequenas diferenças de comportamento.
   */
  const run = useCallback(async (fn, { reload = true } = {}) => {
    setBusy(true);
    try {
      const result = await fn();
      if (reload) await load(path);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  }, [load, path]);

  return {
    path, setPath,
    entries: sorted,
    rawEntries: entries,
    loading, error, busy,
    sortBy, setSortBy,
    selected, selectionMode, setSelectionMode,
    toggleSelect, startSelection, clearSelection, selectAll,
    selectedPaths, joinCurrent,
    load, run,
  };
}
