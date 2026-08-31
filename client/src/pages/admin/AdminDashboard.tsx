import { Link } from 'react-router-dom';
import { useIssues } from '@/hooks/useIssues';
import { useIssuesByCategory, useIssuesOverTime, useOverview, useWorkerWorkload } from '@/hooks/useAnalytics';
import { BarChart, EmptyState, ErrorState, LoadingState, Sparkline, StatCard } from '@/components/ui';
import { IssueList } from '@/components/IssueList';
import { formatDuration } from '@/utils/format';

/** Municipality-wide triage console. Every figure is a live SQL aggregate. */
export function AdminDashboard(): JSX.Element {
  const stats = useOverview();
  const series = useIssuesOverTime(14);
  const byCategory = useIssuesByCategory();
  const workload = useWorkerWorkload();

  // The triage queue: nothing has been done to these yet.
  const triage = useIssues({ limit: 8, status: ['REPORTED', 'UNDER_REVIEW'], sortBy: 'priority', sortDir: 'desc' });
  const critical = useIssues({ limit: 5, priority: ['CRITICAL'], onlyOpen: true, sortBy: 'createdAt', sortDir: 'asc' });
  const reopened = useIssues({ limit: 5, status: ['REOPENED'], sortBy: 'updatedAt', sortDir: 'desc' });

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>Operations dashboard</h1>
          <p className="muted">Municipality-wide view of everything reported and in progress.</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Link to="/app/admin/analytics" className="btn btn-secondary">Full analytics</Link>
          <Link to="/app/admin/issues" className="btn btn-primary">All issues</Link>
        </div>
      </div>

      {stats.isLoading && <LoadingState label="Loading statistics…" rows={2} />}
      {stats.isError && <ErrorState message="Statistics could not be loaded." onRetry={() => void stats.refetch()} />}

      {stats.data && (
        <>
          <div className="grid-4">
            <StatCard label="Total reports" value={stats.data.total} hint={`${stats.data.newLast7Days} in the last 7 days`} to="/app/admin/issues" />
            <StatCard label="Open" value={stats.data.open} tone={stats.data.open > 0 ? 'warning' : 'default'} to="/app/admin/issues" />
            <StatCard
              label="Critical and open"
              value={stats.data.critical}
              tone={stats.data.critical > 0 ? 'danger' : 'success'}
              hint={stats.data.critical > 0 ? 'Needs immediate attention' : 'None outstanding'}
            />
            <StatCard label="Median resolution" value={formatDuration(stats.data.medianResolutionHours)} hint={`${stats.data.resolvedLast7Days} resolved in 7 days`} />
          </div>

          <div className="grid-4">
            <StatCard label="Awaiting triage" value={stats.data.reported} tone={stats.data.reported > 0 ? 'warning' : 'default'} />
            <StatCard label="Assigned" value={stats.data.assigned + stats.data.inProgress} />
            <StatCard label="On hold" value={stats.data.onHold} tone={stats.data.onHold > 0 ? 'warning' : 'default'} />
            <StatCard label="Reopened" value={stats.data.reopened} tone={stats.data.reopened > 0 ? 'danger' : 'default'} hint="Fixes that did not hold" />
          </div>
        </>
      )}

      <div className="grid-2" style={{ alignItems: 'start' }}>
        <section className="card card-pad stack-sm">
          <h2 style={{ fontSize: 'var(--text-base)' }}>Reported vs resolved · last 14 days</h2>
          {series.isLoading && <div className="skeleton" style={{ height: 140 }} />}
          {series.isError && <ErrorState message="Time series unavailable." onRetry={() => void series.refetch()} />}
          {series.data && <Sparkline points={series.data} />}
        </section>

        <section className="card card-pad stack-sm">
          <h2 style={{ fontSize: 'var(--text-base)' }}>Open issues by category</h2>
          {byCategory.isLoading && <div className="skeleton" style={{ height: 140 }} />}
          {byCategory.isError && <ErrorState message="Category breakdown unavailable." onRetry={() => void byCategory.refetch()} />}
          {byCategory.data && byCategory.data.filter((row) => row.open > 0).length === 0 && (
            <p className="small muted">No open issues in any category.</p>
          )}
          {byCategory.data && byCategory.data.filter((row) => row.open > 0).length > 0 && (
            <BarChart
              data={byCategory.data
                .filter((row) => row.open > 0)
                .sort((a, b) => b.open - a.open)
                .slice(0, 8)
                .map((row) => ({ label: row.categoryName, value: row.open }))}
              maxLabel="open issues"
            />
          )}
        </section>
      </div>

      {critical.data && critical.data.data.length > 0 && (
        <section className="card card-pad stack-sm" style={{ borderLeft: '4px solid var(--danger-700)' }}>
          <div className="row" style={{ gap: 8 }}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>⚠</span>
            <h2 style={{ fontSize: 'var(--text-lg)' }}>Critical and still open</h2>
          </div>
          <p className="small muted">Oldest first. These are safety hazards.</p>
          <IssueList issues={critical.data.data} showReporter showAssignee />
        </section>
      )}

      {reopened.data && reopened.data.data.length > 0 && (
        <section className="card card-pad stack-sm" style={{ borderLeft: '4px solid var(--warning-700)' }}>
          <h2 style={{ fontSize: 'var(--text-lg)' }}>Reopened by citizens</h2>
          <p className="small muted">
            These were marked resolved but the reporter says the problem persists. They need reassignment.
          </p>
          <IssueList issues={reopened.data.data} showReporter showAssignee />
        </section>
      )}

      <section className="stack-sm">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div className="stack-sm" style={{ gap: 2 }}>
            <h2>Triage queue</h2>
            <p className="small muted">New and under-review reports, highest priority first.</p>
          </div>
          <Link to="/app/admin/issues" className="small">View all →</Link>
        </div>

        {triage.isLoading && <LoadingState label="Loading the triage queue…" rows={3} />}
        {triage.isError && <ErrorState message={(triage.error as Error).message} onRetry={() => void triage.refetch()} />}
        {triage.data && triage.data.data.length === 0 && (
          <EmptyState icon="✓" title="Triage queue is empty" message="Every incoming report has been reviewed and routed." />
        )}
        {triage.data && triage.data.data.length > 0 && <IssueList issues={triage.data.data} showReporter showAssignee />}
      </section>

      <section className="card card-pad stack-sm">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ fontSize: 'var(--text-base)' }}>Team workload</h2>
          <Link to="/app/admin/workers" className="small">Manage workers →</Link>
        </div>
        {workload.isLoading && <div className="skeleton" style={{ height: 100 }} />}
        {workload.isError && <ErrorState message="Workload data unavailable." onRetry={() => void workload.refetch()} />}
        {workload.data && workload.data.length === 0 && <p className="small muted">No workers have been registered yet.</p>}
        {workload.data && workload.data.length > 0 && (
          <BarChart
            data={workload.data.map((row) => ({
              label: row.workerName,
              value: row.active,
              tone: row.active > 5 ? 'var(--danger-700)' : row.active > 2 ? 'var(--warning-700)' : 'var(--success-700)',
            }))}
            maxLabel="active assignments"
          />
        )}
      </section>
    </div>
  );
}
