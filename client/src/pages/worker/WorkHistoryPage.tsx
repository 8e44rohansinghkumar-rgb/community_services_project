import { useState } from 'react';
import { useMyWork } from '@/hooks/useIssues';
import { useIssuesByCategory, useOverview } from '@/hooks/useAnalytics';
import { IssueList } from '@/components/IssueList';
import { BarChart, EmptyState, ErrorState, LoadingState, Pagination, StatCard } from '@/components/ui';
import { formatDuration } from '@/utils/format';

/** Completed work plus the worker's own scoped performance figures. */
export function WorkHistoryPage(): JSX.Element {
  const [page, setPage] = useState(1);

  const stats = useOverview();
  const byCategory = useIssuesByCategory();
  const completed = useMyWork({
    page,
    limit: 20,
    status: ['RESOLVED', 'CLOSED'],
    sortBy: 'resolvedAt',
    sortDir: 'desc',
  });

  return (
    <div className="stack">
      <div className="stack-sm">
        <h1>Work history</h1>
        <p className="muted">Issues you have resolved, and how your turnaround looks over time.</p>
      </div>

      {stats.isLoading && <LoadingState label="Loading your figures…" rows={1} />}
      {stats.isError && <ErrorState message="Your figures could not be loaded." onRetry={() => void stats.refetch()} />}
      {stats.data && (
        <div className="grid-4">
          <StatCard label="Total handled" value={stats.data.total} />
          <StatCard label="Resolved" value={stats.data.resolved + stats.data.closed} tone="success" />
          <StatCard label="Average turnaround" value={formatDuration(stats.data.averageResolutionHours)} />
          <StatCard label="Median turnaround" value={formatDuration(stats.data.medianResolutionHours)} hint="Less affected by outliers" />
        </div>
      )}

      {byCategory.data && byCategory.data.length > 0 && (
        <section className="card card-pad stack-sm">
          <h2 style={{ fontSize: 'var(--text-base)' }}>Your work by category</h2>
          <BarChart
            data={byCategory.data
              .filter((row) => row.total > 0)
              .map((row) => ({ label: row.categoryName, value: row.total }))}
          />
        </section>
      )}

      <section className="stack-sm">
        <h2>Completed issues</h2>

        {completed.isLoading && <LoadingState label="Loading completed work…" rows={3} />}
        {completed.isError && <ErrorState message={(completed.error as Error).message} onRetry={() => void completed.refetch()} />}

        {completed.data && completed.data.data.length === 0 && (
          <EmptyState
            icon="📋"
            title="Nothing completed yet"
            message="Issues you resolve or close will be listed here with the date they were finished."
          />
        )}

        {completed.data && completed.data.data.length > 0 && (
          <>
            <IssueList issues={completed.data.data} showReporter />
            <Pagination
              page={completed.data.pagination.page}
              totalPages={completed.data.pagination.totalPages}
              total={completed.data.pagination.total}
              onPageChange={setPage}
            />
          </>
        )}
      </section>
    </div>
  );
}
