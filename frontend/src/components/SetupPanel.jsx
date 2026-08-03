import { useEffect, useState } from 'react';
import Button from './Button';
import { Label, Input } from './Field';
import { api } from '../lib/api';
import {
  Play, CheckCircle2, XCircle, Loader2, RefreshCw, GitBranch, Package,
  Hammer, Rocket, Clock, Terminal,
} from 'lucide-react';

const STEP_LABELS = {
  idle: 'Aguardando',
  cloning: 'Clonando repositório',
  installing: 'Instalando dependências',
  building: 'Compilando',
  starting: 'Iniciando serviço',
  done: 'Concluído',
  failed: 'Falhou',
};

const STEP_ICONS = {
  cloning: GitBranch,
  installing: Package,
  building: Hammer,
  starting: Rocket,
  done: CheckCircle2,
  failed: XCircle,
  idle: Clock,
};

function stepOrder(step) {
  const order = ['idle', 'cloning', 'installing', 'building', 'starting', 'done', 'failed'];
  const i = order.indexOf(step);
  return i === -1 ? 0 : i;
}

function streamClass(stream) {
  switch (stream) {
    case 'stderr': return 'text-error';
    case 'input': return 'text-ink-faint italic';
    case 'warn': return 'text-provisioning';
    case 'exit': return 'text-ink-faint';
    default: return 'text-ink';
  }
}

export default function SetupPanel({ service, setupState, setupLogs, busy, setBusy, onSaved, onRunSetup, notify }) {
  const [cfg, setCfg] = useState({
    git_repo: '',
    git_branch: '',
    git_username: '',
    git_token: '',
    startup_command: '',
    main_file: '',
    node_packages: '',
    unnode_packages: '',
    node_args: '',
    auto_update: false,
    allow_file_uploads: false,
  });

  useEffect(() => {
    if (service) {
      // Se o token foi mascarado pelo backend, deixamos em branco no form
      // (com placeholder "inalterado") para não exigir redigitação.
      const token = service.git_token === '__PTD_REDACTED__' ? '' : (service.git_token || '');
      setCfg({
        git_repo: service.git_repo || '',
        git_branch: service.git_branch || '',
        git_username: service.git_username || '',
        git_token: token,
        startup_command: service.startup_command || '',
        main_file: service.main_file || '',
        node_packages: service.node_packages || '',
        unnode_packages: service.unnode_packages || '',
        node_args: service.node_args || '',
        auto_update: !!service.auto_update,
        allow_file_uploads: !!service.allow_file_uploads,
      });
    }
  }, [service]);

  const set = (key) => (e) => setCfg((c) => ({ ...c, [key]: e.target.value }));
  const setBool = (key) => (v) => setCfg((c) => ({ ...c, [key]: v }));

  const saveConfig = async () => {
    setBusy(true);
    try {
      // Só envia git_token se o usuário de fato o digitou (vazio = manter o
      // atual; o backend vai reconhecer a ausência de alteração).
      const payload = {
        git_repo: cfg.git_repo || null,
        git_branch: cfg.git_branch || null,
        git_username: cfg.git_username || null,
        startup_command: cfg.startup_command || null,
        main_file: cfg.main_file || null,
        node_packages: cfg.node_packages || null,
        unnode_packages: cfg.unnode_packages || null,
        node_args: cfg.node_args || null,
        auto_update: cfg.auto_update ? 1 : 0,
        allow_file_uploads: cfg.allow_file_uploads ? 1 : 0,
      };
      if (cfg.git_token && cfg.git_token !== '__PTD_REDACTED__') {
        payload.git_token = cfg.git_token;
      }
      await api.updateService(service.id, payload);
      notify('Configuração salva', 'success');
      await onSaved?.();
    } catch (e) {
      notify(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const running = setupState?.running;
  const step = setupState?.step || 'idle';
  const status = setupState?.status || 'idle';
  const progress = setupState?.progress || 0;
  const errorMsg = setupState?.error || '';
  const stepLabel = STEP_LABELS[step] || step;
  const currentIdx = stepOrder(step);

  const steps = ['cloning', 'installing', 'building', 'starting'];
  const relevantSteps = [];
  if (cfg.git_repo) relevantSteps.push('cloning');
  // installing é mostrada sempre (package.json inicial existe e pode ter dependências)
  relevantSteps.push('installing');
  // building só aparece se houver tsconfig (sabemos depois do setup; otimisticamente mostramos)
  relevantSteps.push('building');
  relevantSteps.push('starting');

  const statusColor = status === 'failed' ? 'bg-error'
    : status === 'done' ? 'bg-running'
    : running ? 'bg-signal'
    : 'bg-ink-faint';

  return (
    <div className="space-y-4">
      {/* Barra de progresso / status */}
      <div className="border border-line-soft rounded-lg p-3 bg-raised/50 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {running ? (
              <Loader2 className="animate-spin text-signal" size={18} />
            ) : status === 'done' ? (
              <CheckCircle2 className="text-running" size={18} />
            ) : status === 'failed' ? (
              <XCircle className="text-error" size={18} />
            ) : (
              <Clock className="text-ink-faint" size={18} />
            )}
            <div>
              <p className="text-sm font-medium text-ink">
                {running ? 'Executando setup' : status === 'done' ? 'Setup concluído' : status === 'failed' ? 'Setup falhou' : 'Setup não executado'}
              </p>
              <p className="text-xs text-ink-faint">
                {running ? stepLabel : errorMsg ? errorMsg : stepLabel}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={status === 'failed' ? 'primary' : 'primary'}
              onClick={() => onRunSetup({ autoStart: true })}
              loading={busy || running}
              disabled={running}
            >
              {running ? <Loader2 className="animate-spin" size={14} /> : (status === 'failed' ? <RefreshCw size={14} /> : <Play size={14} />)}
              {status === 'failed' ? 'Tentar de novo' : 'Executar Setup Agora'}
            </Button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 w-full bg-line-soft rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${statusColor}`}
            style={{ width: `${status === 'done' ? 100 : Math.max(progress, running ? 5 : 0)}%` }}
          />
        </div>

        {/* Step indicators */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {steps.map((s, i) => {
            const Icon = STEP_ICONS[s] || Clock;
            const doneStep = currentIdx > stepOrder(s) || status === 'done';
            const activeStep = step === s;
            const failed = status === 'failed' && activeStep;
            return (
              <div
                key={s}
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${
                  failed ? 'border-error bg-error-soft text-error'
                    : doneStep ? 'border-running/30 bg-running-soft text-running'
                    : activeStep ? 'border-signal/30 bg-signal-soft text-signal'
                    : 'border-line-soft text-ink-faint'
                }`}
              >
                <Icon size={12} />
                <span>{STEP_LABELS[s]}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Logs do setup */}
      {(running || setupLogs?.length > 0 || status === 'failed' || status === 'done') && (
        <div className="border border-line-soft rounded-lg overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 bg-raised border-b border-line-soft text-xs font-medium text-ink">
            <Terminal size={12} /> Logs do setup
          </div>
          <div className="bg-black/80 p-3 max-h-72 overflow-auto font-mono text-xs leading-relaxed">
            {setupLogs?.length === 0 && !running && (
              <p className="text-ink-faint">Nenhum log ainda.</p>
            )}
            {setupLogs?.map((line, i) => (
              <div key={i} className={streamClass(line.stream)}>
                {String(line.message).replace(/\n$/, '').split('\n').map((seg, j) => (
                  <div key={`${i}-${j}`} className="whitespace-pre-wrap break-words">{seg || '\u00a0'}</div>
                ))}
              </div>
            ))}
            {running && (
              <div className="text-signal animate-pulse">▍</div>
            )}
          </div>
        </div>
      )}

      {/* Formulário de configuração */}
      <div className="space-y-3 border border-line-soft rounded-lg p-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Parâmetros do setup</h3>
          <p className="text-xs text-ink-faint">
            Estes campos definem como o painel clona, instala, compila e inicia seu serviço.
          </p>
        </div>

        <div>
          <Label htmlFor="startup_command">Comando de Inicialização (Startup Command)</Label>
          <Input
            id="startup_command"
            value={cfg.startup_command}
            onChange={set('startup_command')}
            placeholder="npm start | npm run dev | node index.js | bun run start | python main.py"
          />
          <p className="text-xs text-ink-faint mt-1">
            Tem prioridade sobre qualquer inferência. Se vazio, o painel detecta automaticamente.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="git_repo">Repositório Git</Label>
            <Input id="git_repo" value={cfg.git_repo} onChange={set('git_repo')} placeholder="https://github.com/usuario/repo.git" />
          </div>
          <div>
            <Label htmlFor="git_branch">Branch</Label>
            <Input id="git_branch" value={cfg.git_branch} onChange={set('git_branch')} placeholder="main" />
          </div>
          <div>
            <Label htmlFor="git_username">Git usuário</Label>
            <Input id="git_username" value={cfg.git_username} onChange={set('git_username')} placeholder="para repositórios privados" autoComplete="off" />
          </div>
          <div>
            <Label htmlFor="git_token">Git token</Label>
            <Input
              id="git_token"
              type="password"
              value={cfg.git_token}
              onChange={set('git_token')}
              placeholder={service.git_token === '__PTD_REDACTED__' ? '(definido — digite para alterar)' : 'token de acesso pessoal'}
              autoComplete="new-password"
            />
            <p className="text-xs text-ink-faint mt-1">
              O token é armazenado apenas no backend e nunca é exibido na interface nem em logs.
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="main_file">Arquivo principal (fallback)</Label>
            <Input id="main_file" value={cfg.main_file} onChange={set('main_file')} placeholder="dist/index.js ou src/index.ts" />
          </div>
          <div>
            <Label htmlFor="node_args">Argumentos extras</Label>
            <Input id="node_args" value={cfg.node_args} onChange={set('node_args')} placeholder="--inspect" />
          </div>
          <div>
            <Label htmlFor="node_packages">Pacotes a adicionar</Label>
            <Input id="node_packages" value={cfg.node_packages} onChange={set('node_packages')} placeholder="discord.js express" />
          </div>
          <div>
            <Label htmlFor="unnode_packages">Pacotes a remover</Label>
            <Input id="unnode_packages" value={cfg.unnode_packages} onChange={set('unnode_packages')} placeholder="discord.js" />
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!cfg.auto_update} onChange={(e) => setBool('auto_update')(e.target.checked)} />
            Auto Update (faz git pull ao rodar setup)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!cfg.allow_file_uploads} onChange={(e) => setBool('allow_file_uploads')(e.target.checked)} />
            Permitir uploads de usuário
          </label>
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="ghost" onClick={() => {
            setCfg({
              git_repo: service.git_repo || '',
              git_branch: service.git_branch || '',
              git_username: service.git_username || '',
              git_token: service.git_token === '__PTD_REDACTED__' ? '' : (service.git_token || ''),
              startup_command: service.startup_command || '',
              main_file: service.main_file || '',
              node_packages: service.node_packages || '',
              unnode_packages: service.unnode_packages || '',
              node_args: service.node_args || '',
              auto_update: !!service.auto_update,
              allow_file_uploads: !!service.allow_file_uploads,
            });
          }}>
            Descartar
          </Button>
          <Button variant="primary" onClick={saveConfig} loading={busy} disabled={running}>
            Salvar Configuração
          </Button>
        </div>
      </div>
    </div>
  );
}
