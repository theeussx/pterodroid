import { useMemo } from 'react';
import { api } from '../../lib/api';
import FileBrowser from './FileBrowser';

/**
 * Aba "Arquivos" de um serviço — o mesmo navegador da página global, só
 * que enraizado no workspace daquele serviço.
 *
 * Antes esse arquivo era uma segunda implementação, com menos recursos
 * (sem copiar, mover, renomear nem buscar). Agora é só o adapter de API
 * apontando pro escopo do serviço; qualquer melhoria no FileBrowser vale
 * automaticamente para as duas telas.
 */
export default function ServiceFileBrowser({ serviceId }) {
  // useMemo: sem isso, um adapter novo a cada render invalidaria os
  // useCallback do hook e recarregaria a listagem em loop.
  const adapter = useMemo(() => api.serviceFiles(serviceId), [serviceId]);

  return <FileBrowser adapter={adapter} compact listHeight="max-h-[50vh]" />;
}
