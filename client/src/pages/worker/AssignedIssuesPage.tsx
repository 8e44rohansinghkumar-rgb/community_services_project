import { useState } from 'react';
import { useMyWork } from '@/hooks/useIssues';
import { IssueFilterBar, EMPTY_FILTERS, type FilterValue } from '@/components/IssueFilterBar';
import { IssueList } from '@/components/IssueList';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/ui';

export function AssignedIssuesPage(): JSX.Element {
  const [filters, setFilters] = useState<FilterValue>({ ...EMPTY_FILTERS, sortBy: 'priority', onlyOpen: true });
  const [page, setPage] = useState(1);

  const query = useMyWork({
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

  const handleChange = (next: FilterValue): void => {
    setFilters(next);
    setPage(1);
  };

  return (
    <div className="stack">
      <div className="stack-sm">
        <h1>My assignments</h1>
        <p className="muted">Every issue currently or previously assigned to you.</p>
      </div>

      <IssueFilterBar value={filters} onChange={handleChange} />

      {query.isLoading && <LoadingState label="Loading your assignments…" rows={4} />}
      {query.isError && <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />}

      {query.data && query.data.data.length === 0 && (
        <EmptyState
          icon="🔧"
          title={filters.onlyOpen ? 'No open assignments' : 'No assignments match these filters'}
          message={
            filters.onlyOpen
              ? 'You are all caught up. Untick “only open” to see work you have already completed.'
              : 'Try clearing a filter or searching for something else.'
          }
          action={
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => handleChange({ ...EMPTY_FILTERS, sortBy: 'priority' })}
            >
              Show everything
            </button>
          }
        />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <IssueList issues={query.data.data} showReporter />
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
