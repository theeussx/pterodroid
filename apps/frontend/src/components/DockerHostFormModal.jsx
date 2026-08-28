import { useState, useEffect } from 'react';
import Modal from './Modal';
import Button from './Button';
import { Label, Input, MonoInput } from './Field';

const EMPTY = { name: '', connection: '', tls_ca: '', tls_cert: '', tls_key: '' };

export default function DockerHostFormModal({ open, onClose, onSubmit }) {
  const [form, setForm] = useState(EMPTY);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) { setForm(EMPTY); setAdvanced(false); setError(''); }
  }, [open]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await onSubmit(form);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Adicionar host Docker"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={handleSubmit} loading={saving}>Adicionar</Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="dh-name">Nome</Label>
          <Input id="dh-name" value={form.name} onChange={set('name')} placeholder="vps-hetzner, mini-pc-sala..." required />
        </div>

        <div>
          <Label htmlFor="dh-connection">Endereço de conexão</Label>
          <MonoInput
            id="dh-connection"
            value={form.connection}
            onChange={set('connection')}
            placeholder="unix:///var/run/docker.sock ou tcp://192.168.1.10:2375"
            required
          />
          <p className="text-xs text-ink-faint mt-1">
            <code className="text-ink-dim">unix://...</code> pra Docker no mesmo host do painel,
            <code className="text-ink-dim"> tcp://ip:porta</code> pra um host remoto (VPS, Raspberry Pi, Mini PC,
            NAS, Windows com Docker Desktop expondo a API).
          </p>
        </div>

        {!advanced ? (
          <button type="button" onClick={() => setAdvanced(true)} className="text-xs text-signal hover:underline">
            + Usar TLS (host remoto exposto com certificado)
          </button>
        ) : (
          <div className="space-y-3 border-t border-line-soft pt-3">
            <p className="text-xs text-ink-faint">
              Cole o conteúdo dos arquivos .pem — só necessário se o Docker Engine remoto exigir TLS mútuo.
            </p>
            <div>
              <Label htmlFor="dh-ca">CA (ca.pem)</Label>
              <MonoInput id="dh-ca" value={form.tls_ca} onChange={set('tls_ca')} placeholder="-----BEGIN CERTIFICATE-----" />
            </div>
            <div>
              <Label htmlFor="dh-cert">Certificado (cert.pem)</Label>
              <MonoInput id="dh-cert" value={form.tls_cert} onChange={set('tls_cert')} placeholder="-----BEGIN CERTIFICATE-----" />
            </div>
            <div>
              <Label htmlFor="dh-key">Chave privada (key.pem)</Label>
              <MonoInput id="dh-key" value={form.tls_key} onChange={set('tls_key')} placeholder="-----BEGIN PRIVATE KEY-----" />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-error">{error}</p>}
      </form>
    </Modal>
  );
}
