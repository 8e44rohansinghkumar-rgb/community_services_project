import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useMyWork } from '@/hooks/useIssues';
import { useOverview } from '@/hooks/useAnalytics';
import { EmptyState, ErrorState, LoadingState, PriorityBadge, StatCard, StatusBadge } from '@/components/ui';
import { formatDuration, relativeTime } from '@/utils/format';

/**
 * Worker home: the queue, ordered by priority.
 * /issues/my-work is scoped server-side to the caller's assignments.
 */
export function WorkerDashboard(): JSX.Element {
  const { user } = useAuth();
  const stats = useOverview();
  const active = useMyWork({ limit: 10, onlyOpen: true, sortBy: 'priority', sortDir: 'desc' });

  const queue = active.data?.data ?? [];
  const inProgress = queue.filter((issue) => issue.status === 'IN_PROGRESS');
  const waiting = queue.filter((issue) => issue.status === 'ASSIGNED' || issue.status === 'REOPENED');
  const onHold = queue.filter((issue) => issue.status === 'ON_HOLD');

  return (
    <div className="stack">
      <div className="stack-sm">
        <h1>Your work queue</h1>
        <p className="muted">
          {user?.departmentName ? `${user.departmentName} · ` : ''}Assignments ordered by priority, most urgent first.
        </p>
      </div>

      {stats.isLoading && <LoadingState label="Loading your statistics…" rows={1} />}
      {stats.isError && <ErrorState message="Your statistics could not be loaded." onRetry={() => void stats.refetch()} />}
      {stats.data && (
        <div className="grid-4">
          <StatCard label="Open assignments" value={stats.data.open} tone={stats.data.open > 0 ? 'warning' : 'default'} to="/app/assigned" />
          <StatCard label="In progress" value={stats.data.inProgress} to="/app/assigned" />
          <StatCard label="Completed" value={stats.data.resolved + stats.data.closed} tone="success" to="/app/work-history" />
          <StatCard
            label="Your median turnaround"
            value={formatDuration(stats.data.medianResolutionHours)}
            hint={stats.data.medianResolutionHours === null ? 'No completed work yet' : 'From report to resolution'}
          />
        </div>
      )}

      {stats.data && stats.data.critical > 0 && (
        <div className="alert alert-error" role="alert">
          <span className="alert-icon" aria-hidden="true">⚠</span>
          <div>
            <strong>{stats.data.critical} critical {stats.data.critical === 1 ? 'issue' : 'issues'} in your queue.</strong>{' '}
            These are safety hazards — please deal with them before anything else.
          </div>
        </div>
      )}

      {active.isLoading && <LoadingState label="Loading your assignments…" rows={4} />}
      {active.isError && <ErrorState message={(active.error as Error).message} onRetry={() => void active.refetch()} />}

      {active.data && queue.length === 0 && (
        <EmptyState
          icon="✓"
          title="Nothing assigned to you right now"
          message="When an administrator assigns you an issue it will appear here and you will receive a notification."
          action={<Link to="/app/work-history" className="btn btn-secondary">View your work history</Link>}
        />
      )}

      {[
        { title: 'In progress', items: inProgress, hint: 'You have started work on these.' },
        { title: 'Waiting to start', items: waiting, hint: 'Assigned to you but not yet started.' },
        { title: 'On hold', items: onHold, hint: 'Blocked. Update the note when the blocker clears.' },
      ]
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.title} className="stack-sm">
            <div className="stack-sm" style={{ gap: 2 }}>
              <h2>{group.title} ({group.items.length})</h2>
              <p className="small muted">{group.hint}</p>
            </div>
            <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
              {group.items.map((issue) => (
                <li key={issue.id}>
                  <Link
                    to={`/app/issues/${issue.id}`}
                    className="card card-pad card-interactive"
                    style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                  >
                    <div className="row-between" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <div className="stack-sm" style={{ minWidth: 0, flex: '1 1 300px', gap: 4 }}>
                        <p className="tiny muted strong">{issue.publicId} · {issue.categoryName}</p>
                        <p className="strong clamp-2">{issue.title}</p>
                        <p className="tiny muted">
                          {issue.landmark ?? issue.address ?? 'Location recorded'} · assigned {relativeTime(issue.updatedAt)}
                        </p>
                      </div>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <PriorityBadge priority={issue.officialPriority} />
                        <StatusBadge status={issue.status} />
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

      {queue.length > 0 && (
        <p className="small">
          <Link to="/app/assigned">See every assignment →</Link>
        </p>
      )}
    </div>
  );
}
