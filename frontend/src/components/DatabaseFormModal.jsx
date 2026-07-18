import { useState, useEffect } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';
import { Label, Input, MonoInput, Select } from './Field';
import { api } from '../lib/api';

const EMPTY_FORM = { name: '', type: 'postgresql', port: 5432, db_username: 'panel', db_password: '', tunnel_hostname: '' };

export default function DatabaseFormModal({ open, onClose, onSubmit }) {
  const [engines, setEngines] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      api.dbEngines().then(setEngines).catch(() => {});
      setForm(EMPTY_FORM);
      setResult(null);
    }
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleTypeChange = (e) => {
    const type = e.target.value;
    const engine = engines.find((en) => en.type === type);
    setForm((f) => ({ ...f, type, port: engine?.defaultPort || f.port }));
  };

  const selectedEngine = engines.find((e) => e.type === form.type);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const created = await onSubmit(form);
      if (created?.generatedPassword) {
        setResult(created);
      } else {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  if (result) {
    return (
      <Modal open={open} onClose={onClose} title="Instância criada" size="sm" footer={<Button variant="primary" onClick={onClose}>Entendi</Button>}>
        <div className="space-y-3 text-sm">
          <p className="text-ink-dim">Guarde essa senha gerada automaticamente — ela não será mostrada de novo:</p>
          <div className="bg-raised rounded-lg p-3 font-mono text-signal break-all">{result.generatedPassword}</div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nova instância de banco"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>Criar</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="dbtype">Motor</Label>
          <Select id="dbtype" value={form.type} onChange={handleTypeChange}>
            {engines.map((e) => <option key={e.type} value={e.type}>{e.label}</option>)}
          </Select>
          {selectedEngine && !selectedEngine.ok && (
            <p className="text-xs text-provisioning flex items-start gap-1.5 mt-2">
              <AlertTriangle size={13} className="shrink-0 mt-0.5" /> {selectedEngine.message}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="dbname">Nome da instância</Label>
          <Input id="dbname" value={form.name} onChange={set('name')} placeholder="meu-banco" required />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="dbport">Porta</Label>
            <Input id="dbport" type="number" value={form.port} onChange={set('port')} required />
          </div>
          <div>
            <Label htmlFor="dbuser">Usuário</Label>
            <MonoInput id="dbuser" value={form.db_username} onChange={set('db_username')} />
          </div>
        </div>

        <div>
          <Label htmlFor="dbpass">Senha (deixe vazio para gerar automaticamente)</Label>
          <MonoInput id="dbpass" type="password" value={form.db_password} onChange={set('db_password')} placeholder="••••••••" />
        </div>

        <div className="border-t border-line-soft pt-4">
          <Label htmlFor="db_tunnel_hostname">Domínio personalizado (opcional, avançado)</Label>
          <MonoInput
            id="db_tunnel_hostname"
            value={form.tunnel_hostname}
            onChange={set('tunnel_hostname')}
            placeholder="banco1 (usa o domínio base) ou banco1.seudominio.com"
          />
          <p className="text-xs text-ink-faint flex items-start gap-1.5 mt-2">
            <Info size={13} className="shrink-0 mt-0.5" />
            Requer domínio nomeado configurado em Configurações. Diferente de um serviço web: conectar
            exige rodar <code className="font-mono">cloudflared access tcp</code> no dispositivo que vai
            acessar o banco — não é só colar a URL num cliente de banco de dados.
          </p>
        </div>
      </form>
    </Modal>
  );
}
