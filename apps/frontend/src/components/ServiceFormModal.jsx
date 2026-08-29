import { useState, useEffect, useMemo } from 'react';
import {
  Globe, Plus, X, Server, Bot, FileCode, Gamepad2, Container, Boxes, Sparkles,
} from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { Label, Input, MonoInput, TextArea, Select, Toggle } from './Field';
import { api } from '../lib/api';

// Os "tipos" (engine) continuam existindo — a receita dedica o serviço e
// escolhe o engine certo pra ele. Para serviços antigos, é o que sobra.
const TYPES = [
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'bot', label: 'Bot (Discord/Telegram)' },
  { value: 'api', label: 'API' },
  { value: 'web', label: 'Site/Web' },
  { value: 'shell', label: 'Shell / outro executável' },
  { value: 'other', label: 'Outro' },
];

const RECIPE_ICONS = {
  server: Server,
  bot: Bot,
  globe: Globe,
  filecode: FileCode,
  gamepad: Gamepad2,
  container: Container,
  boxes: Boxes,
};

function RecipeIcon({ id, size = 20, className = '' }) {
  const Icon = RECIPE_ICONS[id] || Boxes;
  return <Icon size={size} className={className} />;
}

const EMPTY = {
  name: '', description: '', type: 'node', command: '', working_directory: '',
  environment: '{}', auto_restart: true, restart_delay: 3, max_restarts: 10, port: '', tunnel_hostname: '',
  runtime_type: 'process', docker_host_id: '', image: '', cpu_limit: '', memory_limit: '',
  // initial config
  git_repo: '', git_branch: '', auto_update: false, git_username: '', git_token: '',
  startup_command: '',
  node_packages: '', unnode_packages: '', main_file: '', node_args: '', allow_file_uploads: false,
  // recipe
  recipe: '', use_template: false,
  // healthcheck + resource limits (processes)
  healthcheck_url: '', healthcheck_interval: 30, healthcheck_timeout: 5, healthcheck_enabled: false,
  process_memory_limit: '', process_cpu_limit: '',
};

function parseVolumesArr(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.map((v) => ({ source: v.source || '', target: v.target || '' })) : [];
  } catch {
    return [];
  }
}

function parseNetworksText(json) {
  try {
    const arr = JSON.parse(json || '[]');
    return Array.isArray(arr) ? arr.join(', ') : '';
  } catch {
    return '';
  }
}

// Converte o JSON salvo de variáveis de ambiente em linhas editáveis de
// chave/valor. Se o conteúdo não for um objeto JSON válido (ex.: serviço
// antigo editado manualmente), devolve null pra quem chamar decidir cair
// no modo avançado em vez de descartar o conteúdo do usuário.
function parseEnvRows(json) {
  try {
    const obj = JSON.parse(json || '{}');
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const rows = Object.entries(obj).map(([key, value]) => ({ key, value: String(value) }));
    return rows;
  } catch {
    return null;
  }
}

function envRowsToJSON(rows) {
  const obj = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    obj[key] = row.value;
  }
  return JSON.stringify(obj);
}

export default function ServiceFormModal({ open, onClose, onSubmit, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [envRows, setEnvRows] = useState([]);
  const [envAdvanced, setEnvAdvanced] = useState(false);
  const [envRawText, setEnvRawText] = useState('{}');
  const [envError, setEnvError] = useState('');
  const [volumeRows, setVolumeRows] = useState([]);
  const [networksText, setNetworksText] = useState('');
  const [hosts, setHosts] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [cloudflaredOk, setCloudflaredOk] = useState(null);
  const [cloudflaredMessage, setCloudflaredMessage] = useState('');

  const isDocker = form.runtime_type === 'docker';
  // Mesma regra do backend (routes/services.js): com container já criado,
  // imagem/host/volumes/redes/porta/limites viram só leitura — pra mudar
  // isso é preciso remover e recriar o serviço.
  const locked = isDocker && !!initial?.container_id;

  // Agrupa as receitas por categoria pra exibir como "nests" dedicados.
  const groupedRecipes = useMemo(() => {
    const groups = {};
    for (const r of recipes) {
      (groups[r.category] = groups[r.category] || []).push(r);
    }
    return Object.entries(groups);
  }, [recipes]);

  const selectedRecipe = recipes.find((r) => r.id === form.recipe) || null;

  useEffect(() => {
    if (open) {
      const base = initial ? { ...EMPTY, ...initial, auto_restart: !!initial.auto_restart } : EMPTY;
      // Serviços antigos não têm recipe salva — deriva a mais próxima.
      if (!base.recipe && base.type) base.recipe = recipeForType(base.type);
      setForm(base);
      const rawEnv = initial?.environment || '{}';
      const rows = parseEnvRows(rawEnv);
      setEnvRawText(rawEnv);
      if (rows) {
        setEnvRows(rows);
        setEnvAdvanced(false);
      } else {
        setEnvRows([]);
        setEnvAdvanced(true);
      }
      setEnvError('');
      setSubmitError('');
      setVolumeRows(parseVolumesArr(initial?.volumes));
      setNetworksText(parseNetworksText(initial?.docker_networks));
      api.cloudflaredStatus().then((s) => { setCloudflaredOk(s.ok); setCloudflaredMessage(s.message || ''); }).catch(() => {});
      api.listDockerHosts().then(setHosts).catch(() => {});
    }
  }, [open, initial]);

  // Carrega o catálogo de receitas uma vez, na abertura do modal.
  useEffect(() => {
    if (!open) return;
    setRecipesLoading(true);
    api.listServiceRecipes()
      .then(setRecipes)
      .catch(() => setRecipes([]))
      .finally(() => setRecipesLoading(false));
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  // Aplica os defaults de uma receita escolhida (sem apagar o que o usuário
  // já digitou). É o que torna a criação "dedicada": escolheu o tipo, o
  // painel já preenche porta, comando e runtime.
  const applyRecipe = (r) => {
    setForm((f) => {
      const next = { ...f, recipe: r.id, use_template: !!r.hasTemplate };
      if (r.defaultType) next.type = r.defaultType;
      if (r.defaultPort) next.port = String(r.defaultPort);
      if (r.defaultCommand) next.command = r.defaultCommand;
      // Receitas de container comandam o runtime; receitas normais rodam
      // como processo local (se o usuário vinha de uma receita docker,
      // volta para processo — é o que o tipo dedicado define).
      if (r.runtimeType) next.runtime_type = r.runtimeType;
      else if (f.runtime_type === 'docker') next.runtime_type = 'process';
      return next;
    });
  };

  const addVolumeRow = () => setVolumeRows((r) => [...r, { source: '', target: '' }]);
  const updateVolumeRow = (i, key, value) =>
    setVolumeRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  const removeVolumeRow = (i) => setVolumeRows((r) => r.filter((_, idx) => idx !== i));

  const addEnvRow = () => setEnvRows((r) => [...r, { key: '', value: '' }]);
  const updateEnvRow = (i, key, value) =>
    setEnvRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  const removeEnvRow = (i) => setEnvRows((r) => r.filter((_, idx) => idx !== i));

  const toggleEnvAdvanced = () => {
    if (envAdvanced) {
      const rows = parseEnvRows(envRawText);
      if (!rows) {
        setEnvError('JSON inválido — corrija antes de voltar para campos simples');
        return;
      }
      setEnvRows(rows);
      setEnvError('');
      setEnvAdvanced(false);
    } else {
      setEnvRawText(envRowsToJSON(envRows));
      setEnvAdvanced(true);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let environment;
    if (envAdvanced) {
      try {
        JSON.parse(envRawText || '{}');
      } catch {
        setEnvError('JSON inválido');
        return;
      }
      environment = envRawText;
    } else {
      environment = envRowsToJSON(envRows);
    }
    setSaving(true);
    setSubmitError('');
    try {
      const payload = { ...form, environment };
      if (payload.command === '' ) delete payload.command; // deixa o backend inferir/comando padrão da receita
      if (isDocker) {
        payload.runtime_type = 'docker';
        payload.volumes = JSON.stringify(volumeRows.filter((r) => r.source.trim() && r.target.trim()));
        payload.docker_networks = JSON.stringify(networksText.split(',').map((s) => s.trim()).filter(Boolean));
        payload.docker_host_id = form.docker_host_id ? parseInt(form.docker_host_id, 10) : null;
        payload.cpu_limit = form.cpu_limit ? parseFloat(form.cpu_limit) : null;
        payload.memory_limit = form.memory_limit ? parseInt(form.memory_limit, 10) : null;
        payload.healthcheck_enabled = 0;
      } else {
        payload.healthcheck_enabled = form.healthcheck_enabled ? 1 : 0;
        payload.healthcheck_interval = parseInt(form.healthcheck_interval, 10) || 30;
        payload.healthcheck_timeout = parseInt(form.healthcheck_timeout, 10) || 5;
        payload.process_memory_limit = form.process_memory_limit ? parseInt(form.process_memory_limit, 10) : null;
        payload.process_cpu_limit = form.process_cpu_limit ? parseFloat(form.process_cpu_limit) : null;
      }
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setSubmitError(err.message || 'Não foi possível salvar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? 'Editar serviço' : 'Novo serviço'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>
            {initial ? 'Salvar' : 'Criar serviço'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {submitError && (
          <div className="bg-error-soft border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
            {submitError}
          </div>
        )}

        {/* ── Seletor de receita (somente na criação) ─────────────────── */}
        {!initial && (
          <div className="border border-line-soft rounded-xl p-3 bg-raised/40 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles size={16} className="text-signal" />
              <h3 className="text-sm font-semibold text-ink">O que você quer hospedar?</h3>
              <span className="ml-auto text-[10px] text-ink-faint font-mono">escolha o tipo dedicado</span>
            </div>

            {recipesLoading && <p className="text-xs text-ink-faint">Carregando tipos…</p>}

            {!recipesLoading && recipes.length === 0 && (
              <p className="text-xs text-ink-faint">
                Não foi possível carregar os tipos. Você ainda pode criar usando o formulário avançado abaixo.
              </p>
            )}

            {selectedRecipe ? (
              <div className="rounded-lg border border-signal/30 bg-signal-soft/30 p-3">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 text-signal"><RecipeIcon id={selectedRecipe.icon} size={20} /></div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{selectedRecipe.label}</p>
                    <p className="text-xs text-ink-dim">{selectedRecipe.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, recipe: '', use_template: false }))}
                    className="text-ink-faint hover:text-error shrink-0 p-1"
                    title="Trocar tipo"
                  >
                    <X size={15} />
                  </button>
                </div>
                {selectedRecipe.hasTemplate && (
                  <div className="mt-2">
                    <Toggle
                      checked={form.use_template}
                      onChange={(v) => setForm((f) => ({ ...f, use_template: v }))}
                      label="Criar projeto inicial de exemplo (package.json, index.js, etc.)"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto pr-1 space-y-3">
                {groupedRecipes.map(([category, items]) => (
                  <div key={category}>
                    <p className="text-[11px] uppercase tracking-wide text-ink-faint font-mono mb-1.5">{category}</p>
                    <div className="grid sm:grid-cols-2 gap-2">
                      {items.map((r) => (
                        <button
                          type="button"
                          key={r.id}
                          onClick={() => applyRecipe(r)}
                          className="flex items-start gap-2.5 text-left rounded-lg border border-line-soft bg-raised/50 p-3 hover:border-signal/40 hover:bg-signal-soft/20 transition-colors"
                        >
                          <div className="mt-0.5 text-ink-dim"><RecipeIcon id={r.icon} size={18} /></div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink truncate">{r.label}</p>
                            <p className="text-[11px] text-ink-faint line-clamp-2">{r.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Nome + runtime ─────────────────────────────────────────── */}
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={form.name} onChange={set('name')} placeholder="meu-bot-discord" required />
          </div>
          <div>
            <Label htmlFor="runtime_type">Runtime</Label>
            <Select
              id="runtime_type"
              value={form.runtime_type}
              onChange={set('runtime_type')}
              disabled={locked || !!selectedRecipe?.runtimeType}
            >
              <option value="process">Processo local (Termux)</option>
              <option value="docker">Container Docker</option>
            </Select>
            <p className="text-xs text-ink-faint mt-1">
              {selectedRecipe?.runtimeType
                ? 'Definido pelo tipo escolhido.'
                : isDocker
                  ? 'Roda como container num host Docker (VPS, Raspberry Pi, Mini PC, NAS...).'
                  : 'Roda como processo direto neste dispositivo.'}
            </p>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {isDocker ? (
            <div>
              <Label htmlFor="docker_host_id">Host Docker</Label>
              {hosts.length === 0 ? (
                <p className="text-xs text-error pt-2">Nenhum host cadastrado — adicione um em "Docker" antes.</p>
              ) : (
                <Select id="docker_host_id" value={form.docker_host_id} onChange={set('docker_host_id')} disabled={locked} required>
                  <option value="">Selecione...</option>
                  {hosts.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </Select>
              )}
            </div>
          ) : (
            <div>
              <Label htmlFor="type">Motor (engine)</Label>
              <Select id="type" value={form.type} onChange={set('type')}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
              <p className="text-xs text-ink-faint mt-1">Auto-selecionado por o tipo. Mude só se souber o que está fazendo.</p>
            </div>
          )}
          <div>
            <Label htmlFor="description">Descrição (opcional)</Label>
            <Input id="description" value={form.description} onChange={set('description')} placeholder="O que esse serviço faz" />
          </div>
        </div>

        {isDocker && (
          <>
            <div>
              <Label htmlFor="image">Imagem Docker</Label>
              <MonoInput id="image" value={form.image} onChange={set('image')} placeholder="node:20-alpine, redis:7-alpine" required disabled={locked} />
              {locked && <p className="text-xs text-ink-faint mt-1">Container já criado — pra trocar a imagem, remova e crie o serviço de novo.</p>}
            </div>
            <div>
              <Label htmlFor="command">Comando (opcional — sobrescreve o CMD padrão da imagem)</Label>
              <MonoInput id="command" value={form.command} onChange={set('command')} placeholder="deixe vazio para usar o padrão da imagem e montar /app automaticamente" />
              <p className="text-xs text-ink-faint mt-1">
                Se deixar vazio, o painel cria uma pasta para os arquivos e monta ela em /app dentro do container.
              </p>
            </div>
          </>
        )}

        {/* Configuração inicial — serve tanto para processo local quanto para container /app */}
        <div className="border border-line-soft rounded-lg p-3 space-y-3 bg-raised/50">
          <div>
            <h3 className="text-sm font-semibold text-ink">Configuração inicial</h3>
            <p className="text-xs text-ink-faint">
              Preencha o repositório Git e/ou pacotes para o painel clonar, instalar dependências e iniciar o serviço automaticamente.
            </p>
          </div>

          <div>
            <Label htmlFor="startup_command">Comando de Inicialização (Startup Command)</Label>
            <MonoInput
              id="startup_command"
              value={form.startup_command}
              onChange={set('startup_command')}
              placeholder="ex: npm start | npm run dev | node index.js | python main.py"
            />
            <p className="text-xs text-ink-faint mt-1">
              Tem prioridade sobre qualquer inferência automática. Se deixar vazio, o painel tenta descobrir.
            </p>
          </div>

          <div>
            <Label htmlFor="git_repo">Repositório Git (opcional)</Label>
            <Input id="git_repo" value={form.git_repo} onChange={set('git_repo')} placeholder="https://github.com/usuario/repo.git" />
            <div className="grid sm:grid-cols-3 gap-2 mt-2">
              <Input id="git_branch" value={form.git_branch} onChange={set('git_branch')} placeholder="branch (ex: main)" />
              <Input id="git_username" value={form.git_username} onChange={set('git_username')} placeholder="git user (opcional)" autoComplete="off" />
              <Input id="git_token" type="password" value={form.git_token} onChange={set('git_token')} placeholder="git token (opcional)" autoComplete="new-password" />
            </div>
            <div className="mt-2">
              <Toggle checked={form.auto_update} onChange={(v) => setForm((f) => ({ ...f, auto_update: v }))} label="Auto Update (git pull ao rodar setup)" />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="main_file">Arquivo principal (fallback)</Label>
              <MonoInput id="main_file" value={form.main_file} onChange={set('main_file')} placeholder="index.js ou src/index.ts" />
              <p className="text-xs text-ink-faint mt-1">Usado só se não houver startup_command nem script "start".</p>
            </div>
            <div>
              <Label htmlFor="node_args">Argumentos adicionais</Label>
              <MonoInput id="node_args" value={form.node_args} onChange={set('node_args')} placeholder="--inspect" />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="node_packages">Adicionar Pacotes (separar por espaço)</Label>
              <MonoInput id="node_packages" value={form.node_packages} onChange={set('node_packages')} placeholder="discord.js express" />
              <p className="text-xs text-ink-faint mt-1">npm/pnpm/yarn/bun é detectado automaticamente pelo lockfile.</p>
            </div>
            <div>
              <Label htmlFor="unnode_packages">Remover Pacotes (separar por espaço)</Label>
              <MonoInput id="unnode_packages" value={form.unnode_packages} onChange={set('unnode_packages')} placeholder="discord.js" />
            </div>
          </div>

          <Toggle checked={form.allow_file_uploads} onChange={(v) => setForm((f) => ({ ...f, allow_file_uploads: v }))} label="Permitir arquivos enviados pelo usuário" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          {!isDocker && (
            <div>
              <Label htmlFor="cwd">Diretório de trabalho (opcional)</Label>
              <MonoInput id="cwd" value={form.working_directory} onChange={set('working_directory')} placeholder="deixe vazio para criar uma pasta automaticamente" />
            </div>
          )}
          <div>
            <Label htmlFor="port">{isDocker ? 'Porta do container (mapeada 1:1 no host)' : 'Porta (habilita acesso remoto)'}</Label>
            <Input id="port" type="number" value={form.port} onChange={set('port')} placeholder="3000" disabled={locked} />
          </div>
        </div>

        {isDocker && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="cpu_limit">Limite de CPU (núcleos, opcional)</Label>
              <Input id="cpu_limit" type="number" step="0.1" min="0" value={form.cpu_limit} onChange={set('cpu_limit')} placeholder="1" disabled={locked} />
            </div>
            <div>
              <Label htmlFor="memory_limit">Limite de memória em MB (opcional)</Label>
              <Input id="memory_limit" type="number" min="0" value={form.memory_limit} onChange={set('memory_limit')} placeholder="512" disabled={locked} />
            </div>
          </div>
        )}

        {isDocker && (
          <div>
            <Label>Volumes (opcional)</Label>
            <div className="space-y-2">
              {volumeRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <MonoInput
                    value={row.source}
                    onChange={(e) => updateVolumeRow(i, 'source', e.target.value)}
                    placeholder="nome-do-volume ou /caminho/no/host"
                    disabled={locked}
                  />
                  <span className="text-ink-faint text-xs shrink-0">→</span>
                  <MonoInput
                    value={row.target}
                    onChange={(e) => updateVolumeRow(i, 'target', e.target.value)}
                    placeholder="/data"
                    disabled={locked}
                  />
                  {!locked && (
                    <button type="button" onClick={() => removeVolumeRow(i)} className="text-ink-faint hover:text-error shrink-0 p-1.5">
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              {!locked && (
                <button type="button" onClick={addVolumeRow} className="text-xs text-signal hover:underline flex items-center gap-1">
                  <Plus size={12} /> Adicionar volume
                </button>
              )}
            </div>
          </div>
        )}

        {isDocker && (
          <div>
            <Label htmlFor="networks">Redes Docker (opcional, separadas por vírgula)</Label>
            <MonoInput id="networks" value={networksText} onChange={(e) => setNetworksText(e.target.value)} placeholder="minha-rede, outra-rede" disabled={locked} />
          </div>
        )}

        {/* Healthcheck por serviço — só faz sentido quando há porta */}
        {!isDocker && (
          <div className="border border-line-soft rounded-lg p-3 space-y-3 bg-raised/40">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-ink">Healthcheck</h3>
                <p className="text-xs text-ink-faint">Reinicia o serviço se ele estiver vivo mas não responder.</p>
              </div>
              <Toggle
                checked={form.healthcheck_enabled}
                onChange={(v) => setForm((f) => ({ ...f, healthcheck_enabled: v }))}
                label="Ativo"
              />
            </div>
            {form.healthcheck_enabled && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="healthcheck_url">URL de verificação</Label>
                  <MonoInput
                    id="healthcheck_url"
                    value={form.healthcheck_url}
                    onChange={set('healthcheck_url')}
                    placeholder="/health  (sem URL vira http://127.0.0.1:PORTA/…)"
                  />
                  <p className="text-xs text-ink-faint mt-1">
                    Se deixar vazio, usa <code>/</code> na porta do serviço.
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="healthcheck_interval">Intervalo (s)</Label>
                    <Input id="healthcheck_interval" type="number" min="5" value={form.healthcheck_interval} onChange={set('healthcheck_interval')} />
                  </div>
                  <div>
                    <Label htmlFor="healthcheck_timeout">Timeout (s)</Label>
                    <Input id="healthcheck_timeout" type="number" min="1" value={form.healthcheck_timeout} onChange={set('healthcheck_timeout')} />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Limites de recurso para processos (não só containers) */}
        {!isDocker && (
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="process_memory_limit">Limite de memória em MB (opcional)</Label>
              <Input id="process_memory_limit" type="number" min="0" value={form.process_memory_limit} onChange={set('process_memory_limit')} placeholder="256" />
              <p className="text-xs text-ink-faint mt-1">Aplicado ao processo local (melhor esforço).</p>
            </div>
            <div>
              <Label htmlFor="process_cpu_limit">Limite de CPU em núcleos (opcional)</Label>
              <Input id="process_cpu_limit" type="number" step="0.1" min="0" value={form.process_cpu_limit} onChange={set('process_cpu_limit')} placeholder="1" />
              <p className="text-xs text-ink-faint mt-1">Aplicado ao processo local (melhor esforço).</p>
            </div>
          </div>
        )}

        {form.port && (
          <>
            <div>
              <Label htmlFor="tunnel_hostname">Domínio personalizado (opcional)</Label>
              <MonoInput
                id="tunnel_hostname"
                value={form.tunnel_hostname}
                onChange={set('tunnel_hostname')}
                placeholder="site1 (usa o domínio base) ou site1.seudominio.com"
              />
              <p className="text-xs text-ink-faint mt-1">
                Deixe vazio para usar a URL aleatória do acesso rápido. Preencha para usar seu próprio
                domínio — configure o domínio base e crie o túnel nomeado em Configurações primeiro.
              </p>
            </div>
            <p className="text-xs text-ink-faint -mt-2 flex items-start gap-1.5">
              <Globe size={13} className="shrink-0 mt-0.5" />
              {cloudflaredOk === false
                ? <span className="text-provisioning">{cloudflaredMessage}</span>
                : 'Se a porta estiver ocupada, o painel usa a próxima disponível automaticamente.'}
            </p>
          </>
        )}

        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="env">Variáveis de ambiente</Label>
            <button
              type="button"
              onClick={toggleEnvAdvanced}
              className="text-xs text-signal hover:underline mb-1.5"
            >
              {envAdvanced ? 'Usar campos simples' : 'Modo avançado (JSON)'}
            </button>
          </div>

          {envAdvanced ? (
            <>
              <TextArea id="env" rows={3} value={envRawText} onChange={(e) => { setEnvRawText(e.target.value); setEnvError(''); }} placeholder='{"TOKEN": "abc123"}' />
              {envError && <p className="text-xs text-error mt-1.5">{envError}</p>}
            </>
          ) : (
            <div className="space-y-2">
              {envRows.length === 0 && (
                <p className="text-xs text-ink-faint">Nenhuma variável ainda. Use para tokens, chaves de API, URLs de banco etc.</p>
              )}
              {envRows.map((row, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <div className="w-2/5 shrink-0">
                    <MonoInput
                      value={row.key}
                      onChange={(e) => updateEnvRow(i, 'key', e.target.value.toUpperCase())}
                      placeholder="NOME_DA_VARIAVEL"
                    />
                  </div>
                  <span className="text-ink-faint text-xs shrink-0">=</span>
                  <MonoInput
                    value={row.value}
                    onChange={(e) => updateEnvRow(i, 'value', e.target.value)}
                    placeholder="valor"
                  />
                  <button type="button" onClick={() => removeEnvRow(i)} className="text-ink-faint hover:text-error shrink-0 p-1.5">
                    <X size={14} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addEnvRow} className="text-xs text-signal hover:underline flex items-center gap-1">
                <Plus size={12} /> Adicionar variável
              </button>
              {envError && <p className="text-xs text-error mt-1.5">{envError}</p>}
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-3 gap-4 items-end">
          <div className="sm:col-span-1">
            <Toggle checked={form.auto_restart} onChange={(v) => setForm((f) => ({ ...f, auto_restart: v }))} label="Reiniciar automaticamente" />
          </div>
          <div>
            <Label htmlFor="delay">Delay de restart (s)</Label>
            <Input id="delay" type="number" min="1" value={form.restart_delay} onChange={set('restart_delay')} disabled={isDocker} />
          </div>
          <div>
            <Label htmlFor="max">Máx. tentativas</Label>
            <Input id="max" type="number" min="1" value={form.max_restarts} onChange={set('max_restarts')} />
          </div>
        </div>
        {isDocker && (
          <p className="text-xs text-ink-faint -mt-2">
            Em containers, o reinício usa a política nativa do Docker — o delay acima não se aplica, só o número máximo de tentativas.
          </p>
        )}
      </form>
    </Modal>
  );
}

// Deriva a receita mais próxima a partir do engine (`type`) para serviços
// antigos e para a criação sem click no seletor.
function recipeForType(type) {
  const map = { node: 'node-api', api: 'node-api', bot: 'node-bot', web: 'node-web', python: 'python-api', shell: 'generic', other: 'generic' };
  return map[type] || 'generic';
}
