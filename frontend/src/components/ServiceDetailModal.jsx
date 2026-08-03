import { useEffect, useState } from 'react';
import Modal from './Modal';
import Button from './Button';
import { Label, Input } from './Field';
import StatusDot from './StatusDot';
import LogViewer from './LogViewer';
import ServiceFileBrowser from './files/ServiceFileBrowser';
import ServiceTerminal from './ServiceTerminal';
import ServiceSetupTab from './ServiceSetupTab';
import BackupsTab from './BackupsTab';
import { api } from '../lib/api';
import { useLiveLogs } from '../lib/hooks';
import { useToast } from '../stores/ToastContext';
import { formatBytes } from './files/fileUtils';
import { Play, Square, RotateCw, Container, LayoutGrid, ScrollText, FolderOpen, TerminalSquare, HardDrive, Archive, Settings } from 'lucide-react';

const TABS = [
  { id: 'overview', label: 'Visão Geral', icon: LayoutGrid },
  { id: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'files', label: 'Arquivos', icon: FolderOpen },
  { id: 'backups', label: 'Backups', icon: Archive },
  { id: 'config', label: 'Config Inicial', icon: Settings },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
];

export default function ServiceDetailModal({ open, onClose, serviceId, onChanged }) {
  const [service, setService] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('overview');
  const [diskUsage, setDiskUsage] = useState(null);
  const { notify } = useToast();
  const { lines, seedOnce } = useLiveLogs('service', serviceId);

  useEffect(() => {
    if (!open || !serviceId) {
      setService(null);
      return undefined;
    }
    // Limpar antes de buscar evita mostrar por um instante os dados do
    // serviço aberto anteriormente — com botões de start/stop que agiriam
    // sobre o serviço certo, mas exibindo o estado do errado (P33).
    setService(null);
    setTab('overview');
    setDiskUsage(null);

    let cancelled = false;
    api.getService(serviceId)
      .then((data) => {
        if (cancelled) return;
        setService(data);
        seedOnce(data.recentLogs || []);
      })
      .catch((e) => { if (!cancelled) notify(e.message, 'error'); });

    // Fechar o modal (ou trocar de serviço) antes da resposta chegar não
    // pode deixar a resposta antiga sobrescrever o estado novo.
    return () => { cancelled = true; };
  }, [open, serviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Uso de disco é buscado só quando a aba "Visão Geral" é vista — é uma
  // varredura de disco no servidor, não precisa rodar pra quem só quer
  // olhar os logs ou o terminal.
  useEffect(() => {
    if (!open || !serviceId || tab !== 'overview') return undefined;
    let cancelled = false;
    api.serviceDiskUsage(serviceId)
      .then((data) => { if (!cancelled) setDiskUsage(data); })
      .catch(() => { if (!cancelled) setDiskUsage(null); });
    return () => { cancelled = true; };
  }, [open, serviceId, tab]);

  const act = async (fn, label) => {
    setBusy(true);
    try {
      await fn(serviceId);
      notify(label, 'success');
      const fresh = await api.getService(serviceId);
      setService(fresh);
      onChanged?.();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendInput = async (text) => {
    try {
      await api.sendServiceInput(serviceId, text);
    } catch (e) {
      notify(e.message, 'error');
    }
  };

  if (!service) {
    return (
      <Modal open={open} onClose={onClose} title="Carregando..." size="xl">
        <div className="h-40 flex items-center justify-center text-ink-faint text-sm">Carregando...</div>
      </Modal>
    );
  }

  const isDocker = service.runtime_type === 'docker';
  const runtime = service.runtime;
  const terminalReady = !isDocker || !!service.container_id;

  return (
    <Modal open={open} onClose={onClose} title={service.name} size="xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <StatusDot status={service.status} />
            {isDocker && (
              <span className="text-xs text-ink-faint flex items-center gap-1">
                <Container size={12} /> container
              </span>
            )}
            {!isDocker && runtime?.pid && <span className="text-xs font-mono text-ink-faint">pid {runtime.pid}</span>}
            {isDocker && service.container_id && (
              <span className="text-xs font-mono text-ink-faint" title={service.container_id}>
                {service.container_id.slice(0, 12)}
              </span>
            )}
            {service.restart_count > 0 && (
              <span className="text-xs text-provisioning">{service.restart_count} reinício(s)</span>
            )}
          </div>
          <div className="flex gap-2">
            {service.status === 'running' ? (
              <Button size="sm" variant="secondary" onClick={() => act(api.stopService, 'Serviço parado')} loading={busy}>
                <Square size={14} /> Parar
              </Button>
            ) : (
              <Button size="sm" variant="primary" onClick={() => act(api.startService, 'Serviço iniciado')} loading={busy}>
                <Play size={14} /> Iniciar
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => act(api.restartService, 'Serviço reiniciado')} loading={busy}>
              <RotateCw size={14} /> Reiniciar
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-1 border-b border-line-soft -mx-1 px-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
                  active ? 'border-signal text-signal font-medium' : 'border-transparent text-ink-faint hover:text-ink'
                }`}
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>

        {tab === 'overview' && (
          <div className="space-y-4">
            {service.setup_status && service.setup_status !== 'Concluído' && (
              <div className="bg-raised rounded-lg p-3 border border-line flex items-center justify-between gap-4">
                <div>
                  <p className="text-ink font-semibold text-xs mb-0.5">
                    Configuração Inicial: <span className="font-mono">{service.setup_status}</span>
                  </p>
                  <p className="text-ink-faint text-xs">
                    {service.setup_error ? `Falha: ${service.setup_error}` : 'Progresso em tempo real da clonagem, instalação e build.'}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setTab('config')}>
                  Ver Progresso
                </Button>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {isDocker ? (
                <>
                  <div className="bg-raised rounded-lg p-3">
                    <p className="text-ink-faint mb-1">Imagem</p>
                    <p className="text-ink font-mono truncate" title={service.image}>{service.image}</p>
                  </div>
                  <div className="bg-raised rounded-lg p-3">
                    <p className="text-ink-faint mb-1">Auto-restart</p>
                    <p className="text-ink">{service.auto_restart ? 'Ativado (política nativa Docker)' : 'Desativado'}</p>
                  </div>
                  {runtime?.cpuPercent != null && (
                    <div className="bg-raised rounded-lg p-3">
                      <p className="text-ink-faint mb-1">CPU</p>
                      <p className="text-ink font-mono">{runtime.cpuPercent}%</p>
                    </div>
                  )}
                  {runtime?.memUsageMB != null && (
                    <div className="bg-raised rounded-lg p-3">
                      <p className="text-ink-faint mb-1">Memória</p>
                      <p className="text-ink font-mono">{runtime.memUsageMB}{runtime.memLimitMB ? ` / ${runtime.memLimitMB}` : ''} MB</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="bg-raised rounded-lg p-3">
                    <p className="text-ink-faint mb-1">Tipo</p>
                    <p className="text-ink font-mono">{service.type}</p>
                  </div>
                  <div className="bg-raised rounded-lg p-3">
                    <p className="text-ink-faint mb-1">Auto-restart</p>
                    <p className="text-ink">{service.auto_restart ? 'Ativado' : 'Desativado'}</p>
                  </div>
                  <div className="bg-raised rounded-lg p-3 col-span-2 sm:col-span-1">
                    <p className="text-ink-faint mb-1">Comando</p>
                    <p className="text-ink font-mono truncate" title={service.command}>{service.command}</p>
                  </div>
                </>
              )}
              <div className="bg-raised rounded-lg p-3">
                <p className="text-ink-faint mb-1">Última inicialização</p>
                <p className="text-ink">{service.last_started ? new Date(service.last_started + 'Z').toLocaleString('pt-BR') : '—'}</p>
              </div>
              <div className="bg-raised rounded-lg p-3">
                <p className="text-ink-faint mb-1 flex items-center gap-1"><HardDrive size={11} /> Uso de disco</p>
                <p className="text-ink font-mono">
                  {diskUsage ? `${formatBytes(diskUsage.bytes)}${diskUsage.truncated ? '+' : ''}` : '...'}
                </p>
              </div>
              {service.port && (
                <div className="bg-raised rounded-lg p-3">
                  <p className="text-ink-faint mb-1">Porta Local</p>
                  <p className="text-ink font-mono">{service.port}</p>
                </div>
              )}
              {service.public_url && (
                <div className="bg-signal-soft rounded-lg p-3 col-span-2">
                  <p className="text-signal mb-1 font-semibold">URL Pública (túnel rápido)</p>
                  <a href={service.public_url} target="_blank" rel="noreferrer" className="text-signal underline break-all font-mono">
                    {service.public_url}
                  </a>
                </div>
              )}
              {!service.public_url && service.tunnel_hostname && (
                <div className="bg-signal-soft rounded-lg p-3 col-span-2">
                  <p className="text-signal mb-1 font-semibold">Domínio configurado</p>
                  <a href={`https://${service.tunnel_hostname}`} target="_blank" rel="noreferrer" className="text-signal underline break-all font-mono">
                    {service.tunnel_hostname}
                  </a>
                  <p className="text-xs text-ink-faint mt-1">Ativo assim que o túnel nomeado estiver rodando (Configurações → Domínio personalizado).</p>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'logs' && (
          <div>
            <LogViewer lines={lines} onSendInput={!isDocker && service.status === 'running' ? sendInput : undefined} />
            {isDocker && (
              <p className="text-xs text-ink-faint mt-2">
                Para enviar comandos a um container, use a aba <strong>Terminal</strong> (roda via docker exec).
              </p>
            )}
          </div>
        )}

        {tab === 'terminal' && (
          terminalReady
            ? <ServiceTerminal serviceId={serviceId} serviceName={service.name} />
            : (
              <div className="text-center py-10">
                <TerminalSquare size={24} className="mx-auto text-ink-faint mb-2" />
                <p className="text-sm text-ink-dim">Inicie o serviço pelo menos uma vez para criar o container antes de abrir o terminal.</p>
              </div>
            )
        )}

        {tab === 'files' && <ServiceFileBrowser serviceId={serviceId} />}

        {tab === 'backups' && <BackupsTab serviceId={serviceId} />}
        {tab === 'config' && (
          <ServiceSetupTab
            serviceId={serviceId}
            service={service}
            onChanged={() => {
              act(api.getService, 'Serviço atualizado');
              onChanged?.();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
