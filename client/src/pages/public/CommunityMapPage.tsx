import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCategories, usePublicIssues } from '@/hooks/useIssues';
import { IssueMap, type MapPoint } from '@/components/IssueMap';
import { EmptyState, ErrorState, LoadingState, Pagination, PriorityBadge, StatusBadge } from '@/components/ui';
import { relativeTime } from '@/utils/format';
import type { IssueStatus } from '@/types';

const STATUS_FILTERS: { value: IssueStatus; label: string }[] = [
  { value: 'REPORTED', label: 'Reported' },
  { value: 'UNDER_REVIEW', label: 'Under review' },
  { value: 'ASSIGNED', label: 'Assigned' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

export function CommunityMapPage(): JSX.Element {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statuses, setStatuses] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [view, setView] = useState<'map' | 'list'>('map');

  const categories = useCategories();
  const issues = usePublicIssues({
    page,
    limit: 50,
    ...(statuses.length > 0 ? { status: statuses } : {}),
    ...(categoryIds.length > 0 ? { categoryId: categoryIds } : {}),
    ...(search ? { search } : {}),
    sortBy: 'createdAt',
    sortDir: 'desc',
  });

  const points: MapPoint[] = useMemo(
    () =>
      (issues.data?.data ?? []).map((issue) => ({
        id: issue.id,
        publicId: issue.publicId,
        title: issue.title,
        latitude: issue.latitude,
        longitude: issue.longitude,
        status: issue.status,
        priority: issue.officialPriority,
        categoryName: issue.categoryName,
      })),
    [issues.data],
  );

  const toggle = (list: string[], value: string, setter: (next: string[]) => void): void => {
    setter(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
    setPage(1);
  };

  const activeFilterCount = statuses.length + categoryIds.length + (search ? 1 : 0);

  return (
    <>
      <section style={{ background: 'var(--navy-900)', color: 'var(--white)', padding: 'var(--sp-10) 0' }}>
        <div className="container stack-sm">
          <h1 style={{ color: 'var(--white)' }}>Community map</h1>
          <p style={{ color: 'var(--navy-100)', maxWidth: '62ch' }}>
            Every report that its author chose to make public. Locations are rounded to roughly 110 metres so a report
            cannot be traced to a specific household.
          </p>
        </div>
      </section>

      <section style={{ padding: 'var(--sp-8) 0 var(--sp-12)' }}>
        <div className="container stack">
          {/* -------- Filters -------- */}
          <form
            className="card card-pad stack"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(searchInput.trim());
              setPage(1);
            }}
            role="search"
            aria-label="Filter public reports"
          >
            <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="field" style={{ flex: '1 1 260px', marginBottom: 0 }}>
                <label className="label" htmlFor="map-search">Search reports</label>
                <input
                  id="map-search"
                  className="input"
                  type="search"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="pothole near the school"
                />
              </div>
              <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
                <button type="submit" className="btn btn-primary">Search</button>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      setSearch('');
                      setSearchInput('');
                      setStatuses([]);
                      setCategoryIds([]);
                      setPage(1);
                    }}
                  >
                    Clear all ({activeFilterCount})
                  </button>
                )}
              </div>
            </div>

            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Status</legend>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {STATUS_FILTERS.map((filter) => (
                  <label key={filter.value} className="checkbox-row" style={{ padding: '6px 10px', border: '1px solid var(--ink-200)', borderRadius: 'var(--radius-full)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={statuses.includes(filter.value)}
                      onChange={() => toggle(statuses, filter.value, setStatuses)}
                    />
                    <span className="small">{filter.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {categories.data && categories.data.length > 0 && (
              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="label">Category</legend>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {categories.data.map((category) => (
                    <label key={category.id} className="checkbox-row" style={{ padding: '6px 10px', border: '1px solid var(--ink-200)', borderRadius: 'var(--radius-full)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={categoryIds.includes(String(category.id))}
                        onChange={() => toggle(categoryIds, String(category.id), setCategoryIds)}
                      />
                      <span className="small">
                        <span aria-hidden="true">{category.icon} </span>
                        {category.name}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </form>

          {/* -------- View switch -------- */}
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <p className="small muted" aria-live="polite">
              {issues.isLoading
                ? 'Loading reports…'
                : `${issues.data?.pagination.total ?? 0} public ${(issues.data?.pagination.total ?? 0) === 1 ? 'report' : 'reports'}`}
            </p>
            <div className="row" role="group" aria-label="Change view" style={{ gap: 4 }}>
              <button
                type="button"
                className={view === 'map' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                onClick={() => setView('map')}
                aria-pressed={view === 'map'}
              >
                Map
              </button>
              <button
                type="button"
                className={view === 'list' ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                onClick={() => setView('list')}
                aria-pressed={view === 'list'}
              >
                List
              </button>
            </div>
          </div>

          {issues.isLoading && <LoadingState label="Loading public reports…" rows={4} />}
          {issues.isError && (
            <ErrorState message="The public feed could not be loaded." onRetry={() => void issues.refetch()} />
          )}

          {issues.data && issues.data.data.length === 0 && (
            <EmptyState
              icon="🔍"
              title="No reports match these filters"
              message={
                activeFilterCount > 0
                  ? 'Try removing a filter or widening your search.'
                  : 'No public reports have been submitted yet.'
              }
              action={
                activeFilterCount > 0 ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setSearch('');
                      setSearchInput('');
                      setStatuses([]);
                      setCategoryIds([]);
                    }}
                  >
                    Clear filters
                  </button>
                ) : (
                  <Link to="/register" className="btn btn-primary">Report an issue</Link>
                )
              }
            />
          )}

          {issues.data && issues.data.data.length > 0 && view === 'map' && <IssueMap points={points} height={480} />}

          {issues.data && issues.data.data.length > 0 && view === 'list' && (
            <ul className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
              {issues.data.data.map((issue) => (
                <li key={issue.id}>
                  <Link
                    to={`/issues/${issue.id}`}
                    className="card card-pad card-interactive stack-sm"
                    style={{ textDecoration: 'none', color: 'inherit', height: '100%' }}
                  >
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <StatusBadge status={issue.status} />
                      <PriorityBadge priority={issue.officialPriority} />
                    </div>
                    <h2 style={{ fontSize: 'var(--text-base)' }} className="clamp-2">{issue.title}</h2>
                    <p className="small muted clamp-3">{issue.description}</p>
                    <div className="row-between tiny muted" style={{ marginTop: 'auto', paddingTop: 8 }}>
                      <span>{issue.categoryName}</span>
                      <time dateTime={issue.createdAt}>{relativeTime(issue.createdAt)}</time>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {issues.data && issues.data.data.length > 0 && (
            <Pagination
              page={issues.data.pagination.page}
              totalPages={issues.data.pagination.totalPages}
              total={issues.data.pagination.total}
              onPageChange={setPage}
            />
          )}
        </div>
      </section>
    </>
  );
}
