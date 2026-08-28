const STATUS_CONFIG = {
  running: { color: 'bg-running', text: 'text-running', label: 'Rodando', pulse: true },
  stopped: { color: 'bg-stopped', text: 'text-stopped', label: 'Parado', pulse: false },
  error: { color: 'bg-error', text: 'text-error', label: 'Erro', pulse: false },
  provisioning: { color: 'bg-provisioning', text: 'text-provisioning', label: 'Provisionando', pulse: true },
};

export default function StatusDot({ status, showLabel = true, className = '' }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.stopped;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span className="relative flex h-2 w-2">
        {cfg.pulse && (
          <span className={`absolute inline-flex h-full w-full rounded-full ${cfg.color} animate-pulse-dot`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.color}`} />
      </span>
      {showLabel && <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>}
    </span>
  );
}
