export default function Card({ children, className = '', padded = true, ...props }) {
  return (
    <div
      className={`bg-surface border border-line rounded-xl ${padded ? 'p-5' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
