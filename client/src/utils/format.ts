/**
 * Presentation helpers for domain values.
 *
 * Accessibility note: every status/priority is described by a LABEL plus a
 * distinct icon glyph, never by colour alone (WCAG 1.4.1 "Use of Color").
 */
import type { IssueStatus, Severity, UserRole } from '@/types';

export const STATUS_META: Record<
  IssueStatus,
  { label: string; badge: string; icon: string; description: string }
> = {
  REPORTED:     { label: 'Reported',     badge: 'badge-neutral', icon: '\u25CB', description: 'Waiting to be reviewed' },
  UNDER_REVIEW: { label: 'Under review', badge: 'badge-info',    icon: '\u25D4', description: 'Being verified by the civic desk' },
  ASSIGNED:     { label: 'Assigned',     badge: 'badge-navy',    icon: '\u25D1', description: 'A worker has been assigned' },
  IN_PROGRESS:  { label: 'In progress',  badge: 'badge-warning', icon: '\u25D5', description: 'Work is underway on site' },
  ON_HOLD:      { label: 'On hold',      badge: 'badge-warning', icon: '\u23F8', description: 'Temporarily paused' },
  RESOLVED:     { label: 'Resolved',     badge: 'badge-success', icon: '\u2713', description: 'Work complete, awaiting confirmation' },
  REOPENED:     { label: 'Reopened',     badge: 'badge-danger',  icon: '\u21BB', description: 'Reported as still unresolved' },
  CLOSED:       { label: 'Closed',       badge: 'badge-success', icon: '\u2714', description: 'Confirmed and closed' },
  REJECTED:     { label: 'Rejected',     badge: 'badge-neutral', icon: '\u2717', description: 'Not actionable by the municipality' },
};

export const PRIORITY_META: Record<Severity, { label: string; badge: string; icon: string; rank: number }> = {
  LOW:      { label: 'Low',      badge: 'badge-neutral', icon: '\u2193', rank: 1 },
  MEDIUM:   { label: 'Medium',   badge: 'badge-info',    icon: '\u2192', rank: 2 },
  HIGH:     { label: 'High',     badge: 'badge-warning', icon: '\u2191', rank: 3 },
  CRITICAL: { label: 'Critical', badge: 'badge-danger',  icon: '\u26A0', rank: 4 },
};

export const ROLE_LABEL: Record<UserRole, string> = {
  CITIZEN: 'Citizen',
  WORKER: 'Field worker',
  ADMIN: 'Administrator',
};

export function statusLabel(status: IssueStatus): string {
  return STATUS_META[status]?.label ?? status;
}

export function priorityLabel(priority: Severity): string {
  return PRIORITY_META[priority]?.label ?? priority;
}

/** "12 Mar 2026, 14:30" — unambiguous, locale-stable. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "3 hours ago" — with an absolute value always available via title/aria. */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  return `${Math.round(months / 12)} year${Math.round(months / 12) === 1 ? '' : 's'} ago`;
}

export function formatDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** Deterministic initials for avatar chips. */
export function initials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Link to a map provider without embedding a paid SDK. */
export function mapLink(lat: number, lng: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
}
