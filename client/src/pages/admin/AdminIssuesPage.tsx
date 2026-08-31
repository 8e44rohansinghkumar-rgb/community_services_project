import { useState } from 'react';
import { useIssues } from '@/hooks/useIssues';
import { IssueFilterBar, EMPTY_FILTERS, type FilterValue } from '@/components/IssueFilterBar';
import { IssueList } from '@/components/IssueList';
import { EmptyState, ErrorState, LoadingState, Pagination } from '@/components/ui';

/** Quick presets for the situations an operator actually needs each morning. */
const PRESETS: { id: string; label: string; filters: Partial<FilterValue> }[] = [
  { id: 'all', label: 'Everything', filters: {} },
  { id: 'triage', label: 'Needs triage', filters: { status: ['REPORTED', 'UNDER_REVIEW'], sortBy: 'priority' } },
  { id: 'unassigned-critical', label: 'Critical and open', filters: { priority: ['CRITICAL'], onlyOpen: true, sortBy: 'createdAt', sortDir: 'asc' } },
  { id: 'active', label: 'Work under way', filters: { status: ['ASSIGNED', 'IN_PROGRESS'], sortBy: 'updatedAt' } },
  { id: 'stuck', label: 'On hold', filters: { status: ['ON_HOLD'], sortBy: 'updatedAt', sortDir: 'asc' } },
  { id: 'reopened', label: 'Reopened', filters: { status: ['REOPENED'], sortBy: 'updatedAt' } },
  { id: 'awaiting', label: 'Awaiting confirmation', filters: { status: ['RESOLVED'], sortBy: 'resolvedAt' } },
];

export function AdminIssuesPage(): JSX.Element {
  const [filters, setFilters] = useState<FilterValue>(EMPTY_FILTERS);
  const [preset, setPreset] = useState('all');
  const [page, setPage] = useState(1);

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

  const applyPreset = (id: string): void => {
    const found = PRESETS.find((p) => p.id === id);
    if (!found) return;
    setPreset(id);
    setFilters({ ...EMPTY_FILTERS, ...found.filters } as FilterValue);
    setPage(1);
  };

  const handleFilterChange = (next: FilterValue): void => {
    setFilters(next);
    setPreset('');
    setPage(1);
  };

  return (
    <div className="stack">
      <div className="stack-sm">
        <h1>All issues</h1>
        <p className="muted">Every report in the system, including private ones.</p>
      </div>

      <nav aria-label="Quick filters">
        <ul className="row" style={{ listStyle: 'none', padding: 0, gap: 8, flexWrap: 'wrap' }}>
          {PRESETS.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                className={preset === option.id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                onClick={() => applyPreset(option.id)}
                aria-pressed={preset === option.id}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <IssueFilterBar value={filters} onChange={handleFilterChange} />

      {query.isLoading && <LoadingState label="Loading issues…" rows={5} />}
      {query.isError && <ErrorState message={(query.error as Error).message} onRetry={() => void query.refetch()} />}

      {query.data && query.data.data.length === 0 && (
        <EmptyState
          icon="🔍"
          title="No issues match these filters"
          message="Try a different preset, or clear the filters to see everything."
          action={
            <button type="button" className="btn btn-secondary" onClick={() => applyPreset('all')}>
              Show everything
            </button>
          }
        />
      )}

      {query.data && query.data.data.length > 0 && (
        <>
          <IssueList issues={query.data.data} showReporter showAssignee />
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
