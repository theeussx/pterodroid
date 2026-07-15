const VARIANTS = {
  primary: 'bg-signal text-void hover:bg-signal/90 font-medium',
  secondary: 'bg-raised text-ink hover:bg-overlay border border-line',
  danger: 'bg-error/10 text-error hover:bg-error/20 border border-error/30',
  ghost: 'text-ink-dim hover:text-ink hover:bg-raised',
};

const SIZES = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

export default function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  disabled,
  loading,
  children,
  ...props
}) {
  return (
    <button
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg transition-colors duration-150
        disabled:opacity-50 disabled:cursor-not-allowed
        ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...props}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
