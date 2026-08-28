export function Label({ children, htmlFor }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-dim mb-1.5">
      {children}
    </label>
  );
}

export function Input({ className = '', ...props }) {
  return (
    <input
      className={`w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink
        placeholder:text-ink-faint focus:border-signal focus:outline-none transition-colors ${className}`}
      {...props}
    />
  );
}

export function MonoInput({ className = '', ...props }) {
  return (
    <input
      className={`w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink font-mono
        placeholder:text-ink-faint focus:border-signal focus:outline-none transition-colors ${className}`}
      {...props}
    />
  );
}

export function TextArea({ className = '', ...props }) {
  return (
    <textarea
      className={`w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink font-mono
        placeholder:text-ink-faint focus:border-signal focus:outline-none transition-colors resize-y ${className}`}
      {...props}
    />
  );
}

export function Select({ className = '', children, ...props }) {
  return (
    <select
      className={`w-full bg-raised border border-line rounded-lg px-3 py-2 text-sm text-ink
        focus:border-signal focus:outline-none transition-colors ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${checked ? 'bg-signal' : 'bg-line'}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-5 h-5 bg-ink rounded-full transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
        />
      </button>
      {label && <span className="text-sm text-ink">{label}</span>}
    </label>
  );
}

export function FieldError({ children }) {
  if (!children) return null;
  return <p className="text-xs text-error mt-1.5">{children}</p>;
}
