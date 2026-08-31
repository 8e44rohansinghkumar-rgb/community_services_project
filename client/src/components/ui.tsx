/**
 * Shared presentational primitives.
 *
 * Small, focused and accessible: status is always conveyed with text + icon,
 * modals trap focus and restore it, and every async surface has explicit
 * loading / empty / error variants.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PRIORITY_META, STATUS_META } from '@/utils/format';
import type { IssueStatus, Severity } from '@/types';

/* ------------------------------- Badges ------------------------------- */

export function StatusBadge({ status, size }: { status: IssueStatus; size?: 'sm' }): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span
      className={`badge ${meta.badge}`}
      style={size === 'sm' ? { fontSize: '0.7rem' } : undefined}
      title={meta.description}
    >
      {/* Icon is decorative; the adjacent text carries the meaning. */}
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Severity }): JSX.Element {
  const meta = PRIORITY_META[priority];
  return (
    <span className={`badge ${meta.badge}`} title={`${meta.label} priority`}>
      <span aria-hidden="true">{meta.icon}</span>
      {meta.label}
      <span className="sr-only"> priority</span>
    </span>
  );
}

/* ------------------------------ Feedback ------------------------------ */

export function Alert({
  variant = 'info',
  title,
  children,
  onDismiss,
}: {
  variant?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}): JSX.Element {
  const icons = { info: 'ℹ', success: '✓', warning: '⚠', error: '⚠' } as const;
  return (
    <div
      className={`alert alert-${variant}`}
      // Errors interrupt; other messages are announced politely.
      role={variant === 'error' ? 'alert' : 'status'}
    >
      <span className="alert-icon" aria-hidden="true">{icons[variant]}</span>
      <div style={{ flex: 1 }}>
        {title && <div className="strong" style={{ marginBottom: 2 }}>{title}</div>}
        <div>{children}</div>
      </div>
      {onDismiss && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss} aria-label="Dismiss message">
          ✕
        </button>
      )}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }): JSX.Element {
  return (
    <span className="row" style={{ gap: 8 }}>
      <span className="spinner spinner-dark" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function LoadingState({ label = 'Loading…', rows = 3 }: { label?: string; rows?: number }): JSX.Element {
  return (
    <div className="stack" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 68 }} />
      ))}
    </div>
  );
}

export function EmptyState({
  icon = '📋',
  title,
  message,
  action,
}: {
  icon?: string;
  title: string;
  message: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="state-panel">
      <div className="state-icon" aria-hidden="true" style={{ fontSize: 24 }}>{icon}</div>
      <h3>{title}</h3>
      <p>{message}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}): JSX.Element {
  return (
    <div className="state-panel" role="alert">
      <div
        className="state-icon"
        aria-hidden="true"
        style={{ background: 'var(--danger-100)', color: 'var(--danger-700)', fontSize: 22 }}
      >
        ⚠
      </div>
      <h3>{title}</h3>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/* -------------------------------- Forms -------------------------------- */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="field">
      <label className="label" htmlFor={htmlFor}>
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {hint && <span className="hint" id={`${htmlFor}-hint`}>{hint}</span>}
      {children}
      {error && (
        <span className="field-error" id={`${htmlFor}-error`} role="alert">
          <span aria-hidden="true">⚠</span> {error}
        </span>
      )}
    </div>
  );
}

/** Wires aria-describedby / aria-invalid so errors are announced correctly. */
export function fieldAria(id: string, error?: string, hint?: string): Record<string, string | boolean> {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ');
  return {
    id,
    'aria-invalid': Boolean(error),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
  };
}

/* -------------------------------- Modal -------------------------------- */

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  labelledBy,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  labelledBy?: string;
}): JSX.Element | null {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const generatedId = useId();
  const titleId = labelledBy ?? generatedId;

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement;
    // Move focus into the dialog so keyboard users are not left behind it.
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    (firstFocusable ?? dialogRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      // Focus trap.
      if (event.key === 'Tab' && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => el.offsetParent !== null);
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1}>
        <div className="modal-header row-between">
          <h2 id={titleId} style={{ fontSize: 'var(--text-lg)' }}>{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close dialog">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

/* ------------------------------ Pagination ----------------------------- */

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}): JSX.Element | null {
  if (totalPages <= 1) {
    return (
      <p className="small muted" aria-live="polite">
        {total} {total === 1 ? 'result' : 'results'}
      </p>
    );
  }

  return (
    <nav className="row-between" aria-label="Pagination" style={{ flexWrap: 'wrap', gap: 12 }}>
      <p className="small muted" aria-live="polite">
        Page {page} of {totalPages} · {total} {total === 1 ? 'result' : 'results'}
      </p>
      <div className="row" style={{ gap: 8 }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          ← Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next →
        </button>
      </div>
    </nav>
  );
}

/* --------------------------------- Misc -------------------------------- */

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  to,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
  to?: string;
}): JSX.Element {
  const toneColor = {
    default: 'var(--navy-700)',
    warning: 'var(--warning-700)',
    danger: 'var(--danger-700)',
    success: 'var(--success-700)',
  }[tone];

  const inner = (
    <>
      <p className="small muted" style={{ fontWeight: 600 }}>{label}</p>
      <p style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, color: toneColor, lineHeight: 1.1 }}>{value}</p>
      {hint && <p className="tiny muted">{hint}</p>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className="card card-pad card-interactive stack-sm" style={{ textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }
  return <div className="card card-pad stack-sm">{inner}</div>;
}

/** Accessible horizontal bar chart built from semantic markup, not canvas. */
export function BarChart({
  data,
  maxLabel = 'issues',
}: {
  data: { label: string; value: number; tone?: string }[];
  maxLabel?: string;
}): JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
      {data.map((item) => (
        <li key={item.label}>
          <div className="row-between small" style={{ marginBottom: 4 }}>
            <span className="strong">{item.label}</span>
            <span className="muted">
              {item.value} <span className="sr-only">{maxLabel}</span>
            </span>
          </div>
          <div
            style={{ height: 8, background: 'var(--ink-100)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}
            role="img"
            aria-label={`${item.label}: ${item.value} ${maxLabel}`}
          >
            <div
              style={{
                width: `${(item.value / max) * 100}%`,
                height: '100%',
                background: item.tone ?? 'var(--navy-600)',
                borderRadius: 'var(--radius-full)',
                transition: 'width 400ms ease-out',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Compact SVG line chart for time series. */
export function Sparkline({
  points,
  height = 120,
}: {
  points: { date: string; reported: number; resolved: number }[];
  height?: number;
}): JSX.Element {
  if (points.length === 0) return <p className="small muted">No data for this period.</p>;

  const max = Math.max(1, ...points.flatMap((p) => [p.reported, p.resolved]));
  const width = 100;
  const toPath = (key: 'reported' | 'resolved'): string =>
    points
      .map((p, i) => {
        const x = (i / Math.max(1, points.length - 1)) * width;
        const y = height - (p[key] / max) * (height - 12) - 6;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');

  const totalReported = points.reduce((sum, p) => sum + p.reported, 0);
  const totalResolved = points.reduce((sum, p) => sum + p.resolved, 0);

  return (
    <figure style={{ margin: 0 }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height, overflow: 'visible' }}
        role="img"
        aria-label={`Reported versus resolved over ${points.length} days. ${totalReported} reported, ${totalResolved} resolved.`}
      >
        <path d={toPath('reported')} fill="none" stroke="var(--navy-600)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <path d={toPath('resolved')} fill="none" stroke="var(--success-700)" strokeWidth="1.5" strokeDasharray="3 2" vectorEffect="non-scaling-stroke" />
      </svg>
      <figcaption className="row small muted" style={{ gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 14, height: 2, background: 'var(--navy-600)' }} aria-hidden="true" />
          Reported ({totalReported})
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 14, height: 2, background: 'var(--success-700)' }} aria-hidden="true" />
          Resolved ({totalResolved})
        </span>
      </figcaption>
    </figure>
  );
}
