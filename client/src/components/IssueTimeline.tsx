/**
 * Status history timeline.
 *
 * Rendered as an ordered list so screen readers announce it as a sequence of
 * n events. Each entry states the transition in words — colour is decoration.
 */
import { STATUS_META, formatDateTime, relativeTime } from '@/utils/format';
import { ROLE_LABEL } from '@/utils/format';
import type { StatusHistoryEntry } from '@/types';

export function IssueTimeline({
  entries,
  showActor = true,
}: {
  entries: StatusHistoryEntry[];
  showActor?: boolean;
}): JSX.Element {
  if (entries.length === 0) {
    return <p className="small muted">No status changes recorded yet.</p>;
  }

  // Newest first reads better in a detail panel; the data arrives chronological.
  const ordered = [...entries].reverse();

  return (
    <ol className="timeline" aria-label={`Status history, ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`}>
      {ordered.map((entry, index) => {
        const meta = STATUS_META[entry.newStatus];
        const isLatest = index === 0;
        return (
          <li key={entry.id} className="timeline-item">
            <span
              className="timeline-marker"
              aria-hidden="true"
              style={{
                background: isLatest ? 'var(--navy-700)' : 'var(--white)',
                color: isLatest ? 'var(--white)' : 'var(--ink-600)',
                borderColor: isLatest ? 'var(--navy-700)' : 'var(--ink-300)',
              }}
            >
              {meta.icon}
            </span>
            <div className="stack-sm" style={{ gap: 2 }}>
              <p className="strong" style={{ fontSize: 'var(--text-sm)' }}>
                {entry.previousStatus ? (
                  <>
                    {STATUS_META[entry.previousStatus].label} → {meta.label}
                  </>
                ) : (
                  <>Report submitted ({meta.label})</>
                )}
              </p>
              <p className="tiny muted">
                <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                  {formatDateTime(entry.createdAt)}
                </time>
                {' · '}
                {relativeTime(entry.createdAt)}
                {showActor && entry.changedByName && (
                  <>
                    {' · '}
                    {entry.changedByName}
                    {entry.changedByRole && ` (${ROLE_LABEL[entry.changedByRole]})`}
                  </>
                )}
              </p>
              {entry.reason && (
                <p
                  className="small"
                  style={{
                    marginTop: 4, padding: '8px 10px', background: 'var(--ink-50)',
                    borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--ink-300)',
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {entry.reason}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
