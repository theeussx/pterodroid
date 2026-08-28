import Modal from './Modal';
import Button from './Button';

export default function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirmar', danger = true, loading, children }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm" footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </>
    }>
      <p className="text-sm text-ink-dim">{message}</p>
      {/* Espaço para opções extras da confirmação (ex.: "apagar também os arquivos"). */}
      {children}
    </Modal>
  );
}
