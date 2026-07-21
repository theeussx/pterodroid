import { useState } from 'react';
import Modal from '../Modal';
import Button from '../Button';
import { Input } from '../Field';

export default function NewItemModal({ open, onClose, onCreate, kind }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate(name.trim());
      setName('');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={kind === 'dir' ? 'Nova pasta' : 'Novo arquivo'}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={submit} loading={saving}>Criar</Button>
        </>
      }
    >
      <form onSubmit={submit}>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={kind === 'dir' ? 'nome-da-pasta' : 'arquivo.txt'}
        />
      </form>
    </Modal>
  );
}
