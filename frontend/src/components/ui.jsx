/**
 * Componentes base.
 *
 * Siguen DESIGN.md: contornos de un píxel en lugar de sombras pesadas,
 * esquinas de 4px en controles y 8px en tarjetas, serif editorial solo en
 * títulos y cifras, etiquetas en versalitas con tracking abierto.
 */
import { useEffect, useState } from 'react';

export function Card({ title, subtitle, action, children, className = '', bodyClass = '' }) {
  return (
    <section
      className={`rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-card ${className}`}
    >
      {(title || action) && (
        <header className="flex items-start justify-between gap-4 border-b border-outline-variant/40 px-5 py-3.5">
          <div className="min-w-0">
            {title && (
              <h2 className="font-sans text-label-md uppercase tracking-wider text-primary">
                {title}
              </h2>
            )}
            {subtitle && <p className="mt-0.5 text-body-md text-outline">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={`p-5 ${bodyClass}`}>{children}</div>
    </section>
  );
}

/** Indicador numérico. `tone="primary"` para la cifra destacada de la pantalla. */
export function Stat({ label, value, hint, tone = 'default', icon }) {
  const esPrimario = tone === 'primary';
  return (
    <div
      className={`rounded-lg border p-4 shadow-card ${
        esPrimario
          ? 'border-primary-container bg-primary-container'
          : 'border-outline-variant/50 bg-surface-container-lowest'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <span
          className={`text-label-sm uppercase tracking-wider ${
            esPrimario ? 'text-on-primary-container' : 'text-outline'
          }`}
        >
          {label}
        </span>
        {icon && <span className="text-outline">{icon}</span>}
      </div>
      <p
        className={`font-serif text-headline-lg leading-none ${
          esPrimario ? 'text-on-primary' : 'text-primary'
        }`}
      >
        {value}
      </p>
      {hint && (
        <p
          className={`mt-1.5 text-body-md ${
            esPrimario ? 'text-primary-fixed' : 'text-on-surface-variant'
          }`}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

export function Badge({ children, variant = 'neutro', className = '' }) {
  return <span className={`badge badge-${variant} ${className}`}>{children}</span>;
}

export function Button({ variant = 'primary', size = 'md', className = '', ...props }) {
  const variants = {
    primary:
      'bg-primary-container text-on-primary hover:bg-primary disabled:bg-surface-container-highest disabled:text-outline',
    secondary:
      'border border-outline-variant bg-surface-container-lowest text-primary hover:bg-surface-container-low',
    ghost: 'text-on-surface-variant hover:bg-surface-container',
    danger: 'border border-estado-cancel-border bg-surface-container-lowest text-estado-cancel-text hover:bg-estado-cancel-bg',
    auric: 'border border-secondary text-secondary hover:bg-secondary-fixed/40',
  };
  const sizes = {
    sm: 'px-2.5 py-1 text-label-sm',
    md: 'px-4 py-2 text-title-md',
    lg: 'px-5 py-2.5 text-title-md',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded transition focus:outline-none focus:ring-2 focus:ring-secondary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, hint, error, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-label-sm uppercase tracking-wider text-on-surface-variant">
        {label} {required && <span className="text-error">*</span>}
      </span>
      {children}
      {hint && !error && <span className="mt-1 block text-body-md text-outline">{hint}</span>}
      {error && <span className="mt-1 block text-body-md text-error">{error}</span>}
    </label>
  );
}

const inputClass =
  'w-full rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-body-lg text-on-surface outline-none transition focus:border-primary-container focus:ring-1 focus:ring-secondary disabled:bg-surface-container-low';

export function Input({ className = '', ...props }) {
  return <input className={`${inputClass} ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`${inputClass} ${className}`} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className = '', ...props }) {
  return <textarea rows={3} className={`${inputClass} ${className}`} {...props} />;
}

export function Checkbox({ label, hint, ...props }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-outline text-primary-container focus:ring-secondary"
        {...props}
      />
      <span>
        <span className="block text-body-lg text-on-surface">{label}</span>
        {hint && <span className="block text-body-md text-outline">{hint}</span>}
      </span>
    </label>
  );
}

export function Alert({ tone = 'error', title, children, onClose, className = '' }) {
  const tones = {
    error: 'border-estado-cancel-border bg-estado-cancel-bg text-estado-cancel-text',
    success: 'border-estado-ok-border bg-estado-ok-bg text-estado-ok-text',
    warning: 'border-estado-pend-border bg-estado-pend-bg text-estado-pend-text',
    info: 'border-outline-variant bg-surface-container-low text-on-surface-variant',
  };
  return (
    <div
      className={`flex items-start justify-between gap-3 rounded border px-4 py-3 text-body-lg ${tones[tone]} ${className}`}
    >
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
      {onClose && (
        <button onClick={onClose} className="text-lg leading-none opacity-60 hover:opacity-100">
          ×
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Cargando…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-body-lg text-outline">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-outline-variant border-t-primary-container" />
      {label}
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="rounded border border-dashed border-outline-variant px-6 py-12 text-center">
      <p className="text-title-md text-on-surface">{title}</p>
      {description && <p className="mt-1 text-body-lg text-outline">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Table({ columns, rows, renderRow, empty = 'Sin registros' }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-outline-variant/60 bg-surface-container-low">
            {columns.map((column) => (
              <th
                key={column}
                className="px-4 py-2.5 text-label-sm uppercase tracking-wider text-outline"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-outline-variant/30">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-4 py-10 text-center text-body-lg text-outline">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map(renderRow)
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Collapsible({ title, subtitle, defaultOpen = false, badge, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded border border-outline-variant/50">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-title-md text-on-surface">{title}</span>
          {subtitle && <span className="block text-body-md text-outline">{subtitle}</span>}
        </span>
        <span className="flex items-center gap-2">
          {badge}
          <span className={`text-outline transition ${open ? 'rotate-180' : ''}`}>▾</span>
        </span>
      </button>
      {open && <div className="border-t border-outline-variant/40 px-4 py-4">{children}</div>}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }) {
  useEffect(() => {
    const handler = (event) => event.key === 'Escape' && onClose?.();
    if (open) document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-tertiary/35 p-4 backdrop-blur-[4px]">
      <div className="w-full max-w-lg rounded-lg border border-outline-variant/50 bg-surface-container-lowest shadow-modal">
        <header className="flex items-center justify-between border-b border-outline-variant/40 px-5 py-4">
          <h3 className="font-serif text-headline-md text-primary">{title}</h3>
          <button onClick={onClose} className="text-xl leading-none text-outline hover:text-on-surface">
            ×
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex justify-end gap-2 border-t border-outline-variant/40 px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
