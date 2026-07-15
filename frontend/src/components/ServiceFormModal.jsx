import { useState, useEffect } from 'react';
import Modal from './Modal';
import Button from './Button';
import { Label, Input, MonoInput, TextArea, Select, Toggle } from './Field';

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
  environment: '{}', auto_restart: true, restart_delay: 3, max_restarts: 10, port: '',
};

export default function ServiceFormModal({ open, onClose, onSubmit, initial }) {
  const [form, setForm] = useState(EMPTY);
  const [envText, setEnvText] = useState('{}');
  const [envError, setEnvError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const base = initial ? { ...EMPTY, ...initial, auto_restart: !!initial.auto_restart } : EMPTY;
      setForm(base);
      setEnvText(initial?.environment || '{}');
      setEnvError('');
    }
  }, [open, initial]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

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
      await onSubmit({ ...form, environment: envText });
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
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="name">Nome</Label>
            <Input id="name" value={form.name} onChange={set('name')} placeholder="meu-bot-discord" required />
          </div>
          <div>
            <Label htmlFor="type">Tipo</Label>
            <Select id="type" value={form.type} onChange={set('type')}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="description">Descrição (opcional)</Label>
          <Input id="description" value={form.description} onChange={set('description')} placeholder="O que esse serviço faz" />
        </div>

        <div>
          <Label htmlFor="command">Comando de inicialização</Label>
          <MonoInput id="command" value={form.command} onChange={set('command')} placeholder="node index.js" required />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="cwd">Diretório de trabalho (opcional)</Label>
            <MonoInput id="cwd" value={form.working_directory} onChange={set('working_directory')} placeholder="/home/user/app" />
          </div>
          <div>
            <Label htmlFor="port">Porta (habilita acesso remoto)</Label>
            <Input id="port" type="number" value={form.port} onChange={set('port')} placeholder="3000" />
          </div>
        </div>

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
            <Input id="delay" type="number" min="1" value={form.restart_delay} onChange={set('restart_delay')} />
          </div>
          <div>
            <Label htmlFor="max">Máx. tentativas</Label>
            <Input id="max" type="number" min="1" value={form.max_restarts} onChange={set('max_restarts')} />
          </div>
        </div>
      </form>
    </Modal>
  );
}
