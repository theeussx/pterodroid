import { useState, useEffect, useRef } from 'react';
import { Play, CheckCircle2, XCircle, Loader2, ShieldCheck, RefreshCw, Terminal } from 'lucide-react';
import Button from './Button';
import { Label, Input, MonoInput, Toggle } from './Field';
import { api } from '../lib/api';
import { useServiceSetupEvents } from '../lib/hooks';
import { useToast } from '../stores/ToastContext';

const STEPS = [
  { id: 'git', label: '1. Repositório Git', min: 20 },
  { id: 'deps', label: '2. Dependências', min: 50 },
  { id: 'build', label: '3. Compilação TS', min: 75 },
  { id: 'start', label: '4. Inicialização', min: 90 },
];

export default function ServiceSetupTab({ serviceId, service, onChanged }) {
  const [setupState, setSetupState] = useState({
    status: 'Aguardando',
    progress: 0,
    error: '',
    logs: [],
    isRunning: false,
    command: '',
    startup_command: '',
  });
  const [cfg, setCfg] = useState({});
  const [clearToken, setClearToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runningSetup, setRunningSetup] = useState(false);
  const logEndRef = useRef(null);
  const { notify } = useToast();

  const loadSetupStatus = async () => {
    try {
      const res = await api.getServiceSetup(serviceId);
      if (res) {
        setSetupState({
          status: res.status || 'Aguardando',
          progress: typeof res.progress === 'number' ? res.progress : 0,
          error: res.error || '',
          logs: res.logs || [],
          isRunning: !!res.isRunning,
          command: res.command || '',
          startup_command: res.startup_command || '',
        });
      }
    } catch {
      // Ignora erro momentâneo de carregamento
    }
  };

  useEffect(() => {
    loadSetupStatus();
    if (service) {
      setCfg({
        startup_command: service.startup_command || '',
        git_repo: service.git_repo || '',
        git_branch: service.git_branch || '',
        git_username: service.git_username || '',
        git_token: '',
        main_file: service.main_file || '',
        node_packages: service.node_packages || '',
        unnode_packages: service.unnode_packages || '',
        node_args: service.node_args || '',
        auto_update: !!service.auto_update,
        allow_file_uploads: !!service.allow_file_uploads,
      });
      setClearToken(false);
    }
  }, [serviceId, service]);

  useServiceSetupEvents(
    serviceId,
    (statusPayload) => {
      setSetupState((prev) => ({
        ...prev,
        status: statusPayload.status || prev.status,
        progress: typeof statusPayload.progress === 'number' ? statusPayload.progress : prev.progress,
        error: statusPayload.error || '',
        isRunning: statusPayload.status !== 'Concluído' && statusPayload.status !== 'Falhou',
      }));
      onChanged?.();
    },
    (logPayload) => {
      setSetupState((prev) => {
        const nextLogs = [...(prev.logs || []), logPayload];
        return {
          ...prev,
          logs: nextLogs.length > 500 ? nextLogs.slice(-500) : nextLogs,
        };
      });
    }
  );

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [setupState.logs]);

  const handleRunSetup = async () => {
    if (setupState.isRunning || runningSetup) return;
    setRunningSetup(true);
    try {
      await api.runServiceSetup(serviceId);
      notify('Setup iniciado com sucesso', 'success');
      loadSetupStatus();
      onChanged?.();
    } catch (e) {
      notify(e.message || 'Falha ao iniciar setup', 'error');
    } finally {
      setRunningSetup(false);
    }
  };

  const handleSaveConfig = async (andRunSetup = false) => {
    try {
      setSaving(true);
      const payload = {
        startup_command: cfg.startup_command || '',
        git_repo: cfg.git_repo || null,
        git_branch: cfg.git_branch || null,
        git_username: cfg.git_username || null,
        git_token: clearToken ? null : (cfg.git_token || null),
        clear_git_token: clearToken,
        main_file: cfg.main_file || null,
        node_packages: cfg.node_packages || null,
        unnode_packages: cfg.unnode_packages || null,
        node_args: cfg.node_args || null,
        auto_update: cfg.auto_update ? 1 : 0,
        allow_file_uploads: cfg.allow_file_uploads ? 1 : 0,
        run_setup: andRunSetup,
      };
      await api.updateService(serviceId, payload);
      notify(andRunSetup ? 'Configuração salva e setup disparado' : 'Configuração salva', 'success');
      setClearToken(false);
      setCfg((c) => ({ ...c, git_token: '' }));
      loadSetupStatus();
      onChanged?.();
    } catch (e) {
      notify(e.message || 'Falha ao salvar configuração', 'error');
    } finally {
      setSaving(false);
    }
  };

  const isFailed = setupState.status === 'Falhou';
  const isDone = setupState.status === 'Concluído';
  const progressPercent = Math.min(Math.max(setupState.progress || 0, 0), 100);

  const getBarColor = () => {
    if (isFailed) return 'bg-error';
    if (isDone) return 'bg-signal';
    return 'bg-running';
  };

  return (
    <div className="space-y-6">
      {/* ── PAINEL DE STATUS E CONTROLE EM TEMPO REAL ── */}
      <div className="bg-raised rounded-lg border border-line p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {setupState.isRunning && <Loader2 size={16} className="animate-spin text-running" />}
              {isDone && <CheckCircle2 size={16} className="text-signal" />}
              {isFailed && <XCircle size={16} className="text-error" />}
              {!setupState.isRunning && !isDone && !isFailed && <Terminal size={16} className="text-ink-faint" />}
              <span className="font-semibold text-sm text-ink">
                Status do Setup: <span className="font-mono">{setupState.status}</span>
              </span>
            </div>
            <span className="text-xs font-mono text-ink-faint">({progressPercent}%)</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={loadSetupStatus}
              title="Atualizar status"
            >
              <RefreshCw size={14} />
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleRunSetup}
              loading={setupState.isRunning || runningSetup}
              disabled={setupState.isRunning}
            >
              <Play size={14} /> Executar Setup Agora
            </Button>
          </div>
        </div>

        {/* ── INDICADOR VISUAL DE ETAPAS ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          {STEPS.map((step) => {
            const active = setupState.isRunning && progressPercent >= step.min - 20 && progressPercent <= step.min;
            const completed = progressPercent >= step.min && !isFailed;
            const stepFailed = isFailed && progressPercent <= step.min;
            return (
              <div
                key={step.id}
                className={`px-3 py-2 rounded-md border text-xs font-medium flex items-center gap-2 transition-colors ${
                  completed
                    ? 'border-signal/40 bg-signal-soft text-signal'
                    : stepFailed
                    ? 'border-error/40 bg-error-soft text-error'
                    : active
                    ? 'border-running/40 bg-running/10 text-running font-semibold'
                    : 'border-line bg-base/50 text-ink-faint'
                }`}
              >
                {completed ? (
                  <CheckCircle2 size={13} className="shrink-0 text-signal" />
                ) : stepFailed ? (
                  <XCircle size={13} className="shrink-0 text-error" />
                ) : (
                  <span className="w-2 h-2 rounded-full bg-current shrink-0" />
                )}
                <span className="truncate">{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* ── BARRA DE PROGRESSO ── */}
        <div className="w-full bg-line-soft rounded-full h-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${getBarColor()}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* ── ALERTA DE FALHA ── */}
        {isFailed && setupState.error && (
          <div className="bg-error-soft border border-error/30 rounded-lg p-3 text-xs text-error">
            <p className="font-semibold mb-1">Motivo da falha:</p>
            <p className="font-mono whitespace-pre-wrap break-all">{setupState.error}</p>
          </div>
        )}

        {/* ── LOGS DO SETUP ── */}
        <div className="space-y-1">
          <p className="text-xs text-ink-faint font-medium">Logs da Configuração & Bootstrap:</p>
          <div className="bg-terminal text-terminal-ink rounded-lg p-3 h-48 overflow-y-auto font-mono text-xs space-y-1">
            {setupState.logs.length === 0 ? (
              <p className="text-ink-faint italic">Nenhum log de setup registrado ainda.</p>
            ) : (
              setupState.logs.map((log, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2 items-start ${
                    log.level === 'error' ? 'text-error' : 'text-terminal-ink'
                  }`}
                >
                  <span className="text-ink-faint text-[10px] shrink-0">
                    {log.timestamp ? new Date(log.timestamp).toLocaleTimeString('pt-BR') : ''}
                  </span>
                  <span className="break-all">{log.message}</span>
                </div>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>

      {/* ── FORMULÁRIO DE CONFIGURAÇÃO DO SERVIÇO ── */}
      <div className="space-y-4 pt-2">
        <h3 className="text-sm font-semibold text-ink border-b border-line pb-2">
          Parâmetros de Inicialização & Automação
        </h3>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label htmlFor="startup_command">Startup Command / Comando de Inicialização (prioridade absoluta)</Label>
            <MonoInput
              id="startup_command"
              value={cfg.startup_command || ''}
              onChange={(e) => setCfg((c) => ({ ...c, startup_command: e.target.value }))}
              placeholder="node index.js, npm start, bun run start, python main.py"
            />
            <p className="text-xs text-ink-faint mt-1">
              Tem prioridade sobre qualquer inferência. Deixe vazio para que o Pterodroid detecte o comando automaticamente
              pelo package.json, dist/index.js ou Arquivo Principal.
            </p>
          </div>

          <div>
            <Label htmlFor="git_repo">Repositório Git</Label>
            <Input
              id="git_repo"
              value={cfg.git_repo || ''}
              onChange={(e) => setCfg((c) => ({ ...c, git_repo: e.target.value }))}
              placeholder="https://github.com/usuario/repo.git"
            />
          </div>
          <div>
            <Label htmlFor="git_branch">Branch</Label>
            <Input
              id="git_branch"
              value={cfg.git_branch || ''}
              onChange={(e) => setCfg((c) => ({ ...c, git_branch: e.target.value }))}
              placeholder="main, master, dev"
            />
          </div>
          <div>
            <Label htmlFor="git_username">Usuário Git (para repositório privado)</Label>
            <Input
              id="git_username"
              value={cfg.git_username || ''}
              onChange={(e) => setCfg((c) => ({ ...c, git_username: e.target.value }))}
              placeholder="oauth2 ou seu-usuario"
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="git_token">Token Git (armazenado encriptado)</Label>
              {service?.has_git_token && !clearToken && (
                <span className="text-[10px] bg-signal-soft text-signal px-1.5 py-0.5 rounded border border-signal/20 flex items-center gap-1">
                  <ShieldCheck size={11} /> Token salvo
                </span>
              )}
            </div>
            <Input
              id="git_token"
              type="password"
              value={cfg.git_token || ''}
              onChange={(e) => {
                setCfg((c) => ({ ...c, git_token: e.target.value }));
                if (e.target.value) setClearToken(false);
              }}
              placeholder={service?.has_git_token ? '• • • • • • • • (token protegido)' : 'ghp_abc123... (opcional)'}
              disabled={clearToken}
            />
            {service?.has_git_token && (
              <label className="flex items-center gap-1.5 mt-1.5 text-xs text-error cursor-pointer">
                <input
                  type="checkbox"
                  checked={clearToken}
                  onChange={(e) => setClearToken(e.target.checked)}
                  className="accent-error"
                />
                <span>Remover token salvo do repositório</span>
              </label>
            )}
          </div>
          <div>
            <Label htmlFor="main_file">Arquivo Principal (fallback da inferência)</Label>
            <Input
              id="main_file"
              value={cfg.main_file || ''}
              onChange={(e) => setCfg((c) => ({ ...c, main_file: e.target.value }))}
              placeholder="index.js ou src/index.ts"
            />
          </div>
          <div>
            <Label htmlFor="node_args">Argumentos de Execução (ex: --inspect)</Label>
            <Input
              id="node_args"
              value={cfg.node_args || ''}
              onChange={(e) => setCfg((c) => ({ ...c, node_args: e.target.value }))}
              placeholder="--inspect"
            />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="node_packages">Pacotes Adicionais (separados por espaço)</Label>
            <Input
              id="node_packages"
              value={cfg.node_packages || ''}
              onChange={(e) => setCfg((c) => ({ ...c, node_packages: e.target.value }))}
              placeholder="discord.js express dotenv"
            />
          </div>
          <div>
            <Label htmlFor="unnode_packages">Pacotes a Remover (separados por espaço)</Label>
            <Input
              id="unnode_packages"
              value={cfg.unnode_packages || ''}
              onChange={(e) => setCfg((c) => ({ ...c, unnode_packages: e.target.value }))}
              placeholder="discord.js"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-6 pt-2">
          <Toggle
            checked={!!cfg.auto_update}
            onChange={(v) => setCfg((c) => ({ ...c, auto_update: v }))}
            label="Auto Update (git pull na inicialização)"
          />
          <Toggle
            checked={!!cfg.allow_file_uploads}
            onChange={(v) => setCfg((c) => ({ ...c, allow_file_uploads: v }))}
            label="Permitir uploads de arquivos pelo usuário"
          />
        </div>

        <div className="flex gap-2 justify-end pt-4 border-t border-line-soft">
          <Button variant="ghost" onClick={() => setCfg({})}>
            Restaurar
          </Button>
          <Button variant="secondary" onClick={() => handleSaveConfig(false)} loading={saving}>
            Salvar Configuração
          </Button>
          <Button variant="primary" onClick={() => handleSaveConfig(true)} loading={saving || setupState.isRunning}>
            Salvar & Executar Setup Agora
          </Button>
        </div>
      </div>
    </div>
  );
}
