import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useIssues } from '@/hooks/useIssues';
import { IssueFilterBar, EMPTY_FILTERS, type FilterValue } from '@/components/IssueFilterBar';
import { IssueList } from '@/components/IssueList';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/ui';

export function MyIssuesPage(): JSX.Element {
  const [filters, setFilters] = useState<FilterValue>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  // The API scopes GET /issues to the caller, so a citizen only ever receives
  // their own rows — there is no client-side filtering to bypass.
  const query = useIssues({
    page,
    limit: 20,
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.status.length > 0 ? { status: filters.status } : {}),
    ...(filters.priority.length > 0 ? { priority: filters.priority } : {}),
    ...(filters.categoryId.length > 0 ? { categoryId: filters.categoryId } : {}),
    ...(filters.onlyOpen ? { onlyOpen: true } : {}),
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
  });

  const handleFilterChange = (next: FilterValue): void => {
    setFilters(next);
    setPage(1);
  };

  const hasFilters =
    filters.search !== '' ||
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.categoryId.length > 0 ||
    filters.onlyOpen;

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>My reports</h1>
          <p className="muted">Everything you have submitted, newest first.</p>
        </div>
        <Link to="/app/report" className="btn btn-primary">＋ Report an issue</Link>
      </div>

      <IssueFilterBar value={filters} onChange={handleFilterChange} />

      {query.isLoading && <LoadingState label="Loading your reports…" rows={4} />}
      {query.isError && <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />}

      {query.data && query.data.data.length === 0 && (
        <EmptyState
          icon={hasFilters ? '🔍' : '📝'}
          title={hasFilters ? 'No reports match these filters' : 'No reports yet'}
          message={
            hasFilters
              ? 'Try clearing a filter or searching for something else.'
              : 'When you report an issue it will appear here with its current status.'
          }
          action={
            hasFilters ? (
              <button type="button" className="btn btn-secondary" onClick={() => handleFilterChange(EMPTY_FILTERS)}>
                Clear filters
              </button>
            ) : (
              <Link to="/app/report" className="btn btn-primary">Report your first issue</Link>
            )
          }
        />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <IssueList issues={query.data.data} />
          <Pagination
            page={query.data.pagination.page}
            totalPages={query.data.pagination.totalPages}
            total={query.data.pagination.total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
