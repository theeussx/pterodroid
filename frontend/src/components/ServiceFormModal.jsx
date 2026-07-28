import { useState, useEffect } from 'react';
import { Globe, Plus, X } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { Label, Input, MonoInput, TextArea, Select, Toggle } from './Field';
import { api } from '../lib/api';

const TYPES = [
  { value: 'node', label: 'Node.js' },
  { value: 'python', label: 'Python' },
  { value: 'bot', label: 'Bot (Discord/Telegram)' },
  { value: 'api', label: 'API' },
  { value: 'web', label: 'Site/Web' },
  { value: 'shell', label: 'Shell / outro executável' },
  { value: 'other', label: 'Outro' },
];

const EMPTY = {
  name: '', description: '', type: 'node', command: '', working_directory: '',
  environment: '{}', auto_restart: true, restart_delay: 3, max_restarts: 10, port: '', tunnel_hostname: '',
  runtime_type: 'process', docker_host_id: '', image: '', cpu_limit: '', memory_limit: '',
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

export default function ServiceFormModal({ open, onClose, onSubmit, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [envText, setEnvText] = useState('{}');
  const [envError, setEnvError] = useState('');
  const [volumeRows, setVolumeRows] = useState([]);
  const [networksText, setNetworksText] = useState('');
  const [hosts, setHosts] = useState([]);
  const [saving, setSaving] = useState(false);
  const [cloudflaredOk, setCloudflaredOk] = useState(null);
  const [cloudflaredMessage, setCloudflaredMessage] = useState('');

  const isDocker = form.runtime_type === 'docker';
  // Mesma regra do backend (routes/services.js): com container já criado,
  // imagem/host/volumes/redes/porta/limites viram só leitura — pra mudar
  // isso é preciso remover e recriar o serviço.
  const locked = isDocker && !!initial?.container_id;

  useEffect(() => {
    if (open) {
      const base = initial ? { ...EMPTY, ...initial, auto_restart: !!initial.auto_restart } : EMPTY;
      setForm(base);
      setEnvText(initial?.environment || '{}');
      setEnvError('');
      setVolumeRows(parseVolumesArr(initial?.volumes));
      setNetworksText(parseNetworksText(initial?.docker_networks));
      api.cloudflaredStatus().then((s) => { setCloudflaredOk(s.ok); setCloudflaredMessage(s.message || ''); }).catch(() => {});
      api.listDockerHosts().then(setHosts).catch(() => {});
    }
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const addVolumeRow = () => setVolumeRows((r) => [...r, { source: '', target: '' }]);
  const updateVolumeRow = (i, key, value) =>
    setVolumeRows((r) => r.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  const removeVolumeRow = (i) => setVolumeRows((r) => r.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      JSON.parse(envText || '{}');
    } catch {
      setEnvError('JSON inválido');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form, environment: envText };
      if (isDocker) {
        payload.volumes = JSON.stringify(volumeRows.filter((r) => r.source.trim() && r.target.trim()));
        payload.docker_networks = JSON.stringify(networksText.split(',').map((s) => s.trim()).filter(Boolean));
        payload.docker_host_id = form.docker_host_id ? parseInt(form.docker_host_id, 10) : null;
        payload.cpu_limit = form.cpu_limit ? parseFloat(form.cpu_limit) : null;
        payload.memory_limit = form.memory_limit ? parseInt(form.memory_limit, 10) : null;
      }
      await onSubmit(payload);
      onClose();
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
        {!initial && (
          <div>
            <Label htmlFor="runtime_type">Tipo de execução</Label>
            <Select id="runtime_type" value={form.runtime_type} onChange={set('runtime_type')}>
              <option value="process">Processo local (Termux)</option>
              <option value="docker">Container Docker</option>
            </Select>
            <p className="text-xs text-ink-faint mt-1">
              {isDocker
                ? 'Roda como container num host Docker cadastrado (local ou remoto — VPS, Raspberry Pi, Mini PC, NAS...).'
                : 'Roda como processo direto neste dispositivo — funciona em qualquer Termux, sem depender de Docker.'}
            </p>
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={form.name} onChange={set('name')} placeholder="meu-bot-discord" required />
          </div>
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
              <Label htmlFor="type">Tipo</Label>
              <Select id="type" value={form.type} onChange={set('type')}>
                {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Select>
            </div>
          )}
        </div>

        <div>
          <Label htmlFor="description">Descrição (opcional)</Label>
          <Input id="description" value={form.description} onChange={set('description')} placeholder="O que esse serviço faz" />
        </div>

        {isDocker ? (
          <>
            <div>
              <Label htmlFor="image">Imagem Docker</Label>
              <MonoInput id="image" value={form.image} onChange={set('image')} placeholder="redis:7-alpine" required disabled={locked} />
              {locked && <p className="text-xs text-ink-faint mt-1">Container já criado — pra trocar a imagem, remova e crie o serviço de novo.</p>}
            </div>
            <div>
              <Label htmlFor="command">Comando (opcional — sobrescreve o CMD padrão da imagem)</Label>
              <MonoInput id="command" value={form.command} onChange={set('command')} placeholder="deixe vazio para usar o padrão da imagem e montar /app automaticamente" />
              <p className="text-xs text-ink-faint mt-1">
                Se deixar vazio, o painel cria uma pasta para os arquivos e monta ela em /app dentro do container para você hospedar o projeto ali.
              </p>
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="command">Comando de inicialização</Label>
            <MonoInput id="command" value={form.command} onChange={set('command')} placeholder="node index.js" required />
          </div>
        )}

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
          <Label htmlFor="env">Variáveis de ambiente (JSON)</Label>
          <TextArea id="env" rows={3} value={envText} onChange={(e) => { setEnvText(e.target.value); setEnvError(''); }} placeholder='{"TOKEN": "abc123"}' />
          {envError && <p className="text-xs text-error mt-1.5">{envError}</p>}
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
