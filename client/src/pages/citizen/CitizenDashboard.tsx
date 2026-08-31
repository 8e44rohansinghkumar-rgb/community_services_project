import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useIssues } from '@/hooks/useIssues';
import { useOverview } from '@/hooks/useAnalytics';
import { EmptyState, ErrorState, LoadingState, StatCard } from '@/components/ui';
import { IssueList } from '@/components/IssueList';
import { formatDuration } from '@/utils/format';

/**
 * Citizen home.
 *
 * The stats come from /analytics/overview, which the server scopes to the
 * caller — a citizen's "total" is the count of their own reports, not the
 * municipality's.
 */
export function CitizenDashboard(): JSX.Element {
  const { user } = useAuth();
  const stats = useOverview();
  const recent = useIssues({ limit: 5, sortBy: 'updatedAt', sortDir: 'desc' });
  const needsAttention = useIssues({ limit: 5, status: ['RESOLVED'], sortBy: 'updatedAt', sortDir: 'desc' });

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>Welcome back, {user?.name.split(' ')[0]}</h1>
          <p className="muted">Your reports and their current status.</p>
        </div>
        <Link to="/app/report" className="btn btn-primary btn-lg">＋ Report an issue</Link>
      </div>

      {/* -------- Stats -------- */}
      {stats.isLoading && <LoadingState label="Loading your statistics…" rows={1} />}
      {stats.isError && <ErrorState message="Your statistics could not be loaded." onRetry={() => void stats.refetch()} />}
      {stats.data && (
        <div className="grid-4">
          <StatCard label="Reports filed" value={stats.data.total} to="/app/issues" />
          <StatCard label="Still open" value={stats.data.open} tone={stats.data.open > 0 ? 'warning' : 'default'} to="/app/issues" />
          <StatCard label="Resolved" value={stats.data.resolved + stats.data.closed} tone="success" to="/app/issues" />
          <StatCard
            label="Typical resolution time"
            value={formatDuration(stats.data.medianResolutionHours)}
            hint={stats.data.medianResolutionHours === null ? 'No resolved reports yet' : 'Median across your reports'}
          />
        </div>
      )}

      {/* -------- Awaiting confirmation -------- */}
      {needsAttention.data && needsAttention.data.data.length > 0 && (
        <section className="card card-pad stack-sm" style={{ borderLeft: '4px solid var(--success-700)' }}>
          <div className="row" style={{ gap: 8 }}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>✓</span>
            <h2 style={{ fontSize: 'var(--text-lg)' }}>Waiting for your confirmation</h2>
          </div>
          <p className="small muted">
            These have been marked resolved by the field crew. Take a look and either confirm the fix or reopen the
            report if the problem is still there.
          </p>
          <IssueList issues={needsAttention.data.data} />
        </section>
      )}

      {/* -------- Recent -------- */}
      <section className="stack-sm">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <h2>Your recent reports</h2>
          <Link to="/app/issues" className="small">View all reports →</Link>
        </div>

        {recent.isLoading && <LoadingState label="Loading your reports…" />}
        {recent.isError && <ErrorState message="Your reports could not be loaded." onRetry={() => void recent.refetch()} />}
        {recent.data && recent.data.data.length === 0 && (
          <EmptyState
            icon="📝"
            title="You have not reported anything yet"
            message="Spotted a pothole, a broken streetlight or an overflowing bin? Reporting takes about a minute."
            action={<Link to="/app/report" className="btn btn-primary">Report your first issue</Link>}
          />
        )}
        {recent.data && recent.data.data.length > 0 && <IssueList issues={recent.data.data} />}
      </section>

      {/* -------- Help -------- */}
      <section className="card card-pad">
        <div className="row-between" style={{ gap: 16, flexWrap: 'wrap' }}>
          <div className="stack-sm" style={{ maxWidth: '52ch' }}>
            <h2 style={{ fontSize: 'var(--text-base)' }}>Not sure what happens next?</h2>
            <p className="small muted">
              Every report is reviewed, prioritised and assigned to a department. You will be notified at each step, and
              nothing is closed without evidence that the work was done.
            </p>
          </div>
          <Link to="/how-it-works" className="btn btn-secondary">Read how it works</Link>
        </div>
      </section>
    </div>
  );
}
