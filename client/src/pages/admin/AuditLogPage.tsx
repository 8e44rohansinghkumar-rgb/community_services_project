import { useState } from 'react';
import { useAuditActions, useAuditLog } from '@/hooks/useAdmin';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/utils/format';

/** Human-readable label for an action constant like ISSUE_STATUS_CHANGED. */
function humanise(action: string): string {
  const text = action.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toneFor(action: string): string {
  if (action.includes('DELETED') || action.includes('DEACTIVATED') || action.includes('SPAM')) return 'badge-danger';
  if (action.includes('CREATED') || action.includes('ACTIVATED')) return 'badge-success';
  if (action.includes('LOGIN_FAILED') || action.includes('REJECTED')) return 'badge-warning';
  if (action.includes('ASSIGNED') || action.includes('STATUS')) return 'badge-info';
  return 'badge-neutral';
}

export function AuditLogPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const actions = useAuditActions();
  const log = useAuditLog({
    page,
    ...(action ? { action } : {}),
    ...(entityType ? { entityType } : {}),
  });

  return (
    <div className="stack">
      <div className="stack-sm">
        <h1>Audit log</h1>
        <p className="muted">
          An append-only record of every consequential action: who did what, to which record, from which address.
        </p>
      </div>

      <div className="card card-pad row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: '1 1 240px', marginBottom: 0 }}>
          <label className="label" htmlFor="audit-action">Action</label>
          <select
            id="audit-action"
            className="select"
            value={action}
            onChange={(event) => { setAction(event.target.value); setPage(1); }}
          >
            <option value="">All actions</option>
            {(actions.data ?? []).map((value) => (
              <option key={value} value={value}>{humanise(value)}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: '0 1 200px', marginBottom: 0 }}>
          <label className="label" htmlFor="audit-entity">Record type</label>
          <select
            id="audit-entity"
            className="select"
            value={entityType}
            onChange={(event) => { setEntityType(event.target.value); setPage(1); }}
          >
            <option value="">All types</option>
            <option value="issue">Issues</option>
            <option value="user">Users</option>
            <option value="category">Categories</option>
            <option value="department">Departments</option>
            <option value="auth">Authentication</option>
          </select>
        </div>
        {(action || entityType) && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => { setAction(''); setEntityType(''); setPage(1); }}
          >
            Clear filters
          </button>
        )}
      </div>

      {log.isLoading && <LoadingState label="Loading the audit log…" rows={5} />}
      {log.isError && <ErrorState message={(log.error as Error).message} onRetry={() => void log.refetch()} />}

      {log.data && log.data.data.length === 0 && (
        <EmptyState icon="🛡" title="No audit entries match" message="Try clearing the filters or selecting a different action." />
      )}

      {log.data && log.data.data.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Audit log entries with actor, action, record and time</caption>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Action</th>
                  <th scope="col">Record</th>
                  <th scope="col">Source IP</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {log.data.data.map((entry) => (
                  <>
                    <tr key={entry.id}>
                      <td className="small" style={{ whiteSpace: 'nowrap' }}>
                        <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                          {relativeTime(entry.createdAt)}
                        </time>
                      </td>
                      <td className="small">
                        {entry.actorName ?? entry.actorEmail ?? <span className="muted">System</span>}
                        {entry.actorEmail && entry.actorName && (
                          <span className="tiny muted" style={{ display: 'block' }}>{entry.actorEmail}</span>
                        )}
                      </td>
                      <td><span className={`badge ${toneFor(entry.action)}`}>{humanise(entry.action)}</span></td>
                      <td className="small">
                        {entry.entityType}
                        {entry.entityId && (
                          <span className="tiny muted" style={{ display: 'block' }}>
                            <code>{entry.entityId.slice(0, 8)}…</code>
                          </span>
                        )}
                      </td>
                      <td className="tiny muted">{entry.ipAddress ?? '—'}</td>
                      <td>
                        {Object.keys(entry.metadata ?? {}).length > 0 ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                            aria-expanded={expanded === entry.id}
                            aria-controls={`audit-detail-${entry.id}`}
                          >
                            {expanded === entry.id ? 'Hide' : 'Show'}
                          </button>
                        ) : (
                          <span className="tiny muted">—</span>
                        )}
                      </td>
                    </tr>
                    {expanded === entry.id && (
                      <tr key={`${entry.id}-detail`}>
                        <td colSpan={6} id={`audit-detail-${entry.id}`} style={{ background: 'var(--ink-50)' }}>
                          <pre
                            className="tiny"
                            style={{ margin: 0, padding: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'var(--font-mono)' }}
                          >
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={log.data.pagination.page}
            totalPages={log.data.pagination.totalPages}
            total={log.data.pagination.total}
            onPageChange={setPage}
          />
        </>
      )}

      <p className="small muted">
        Audit rows survive the deletion of the records they describe: the foreign keys are <code>ON DELETE SET NULL</code>,
        so history cannot be erased by removing a user or an issue.
      </p>
    </div>
  );
}
