/**
 * Reusable filter/search/sort control for issue lists.
 * Filtering happens on the SERVER — this only builds the query.
 */
import { useEffect, useState } from 'react';
import { useCategories } from '@/hooks/useIssues';
import { STATUS_META } from '@/utils/format';
import type { IssueStatus, Severity } from '@/types';

export interface FilterValue {
  search: string;
  status: string[];
  priority: string[];
  categoryId: string[];
  sortBy: string;
  sortDir: 'asc' | 'desc';
  onlyOpen: boolean;
}

export const EMPTY_FILTERS: FilterValue = {
  search: '',
  status: [],
  priority: [],
  categoryId: [],
  sortBy: 'createdAt',
  sortDir: 'desc',
  onlyOpen: false,
};

const ALL_STATUSES = Object.keys(STATUS_META) as IssueStatus[];
const PRIORITIES: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

/** Only fields the API whitelists for sorting appear here. */
const SORT_OPTIONS = [
  { value: 'createdAt', label: 'Date reported' },
  { value: 'updatedAt', label: 'Last updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
  { value: 'title', label: 'Title' },
  { value: 'resolvedAt', label: 'Date resolved' },
];

export function IssueFilterBar({
  value,
  onChange,
  showPriority = true,
  showCategory = true,
}: {
  value: FilterValue;
  onChange: (next: FilterValue) => void;
  showPriority?: boolean;
  showCategory?: boolean;
}): JSX.Element {
  const categories = useCategories();
  const [searchDraft, setSearchDraft] = useState(value.search);
  const [expanded, setExpanded] = useState(false);

  // Debounce so typing does not fire a request per keystroke.
  useEffect(() => {
    if (searchDraft === value.search) return undefined;
    const timer = setTimeout(() => onChange({ ...value, search: searchDraft }), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft]);

  useEffect(() => {
    setSearchDraft(value.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.search]);

  const toggle = (key: 'status' | 'priority' | 'categoryId', item: string): void => {
    const list = value[key];
    onChange({ ...value, [key]: list.includes(item) ? list.filter((v) => v !== item) : [...list, item] });
  };

  const activeCount =
    value.status.length + value.priority.length + value.categoryId.length + (value.search ? 1 : 0) + (value.onlyOpen ? 1 : 0);

  return (
    <div className="card card-pad stack-sm">
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '1 1 240px', marginBottom: 0 }}>
          <label className="label sr-only" htmlFor="issue-search">Search issues</label>
          <input
            id="issue-search"
            className="input"
            type="search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="Search by title, description or reference…"
          />
        </div>

        <div className="field" style={{ flex: '0 1 190px', marginBottom: 0 }}>
          <label className="label sr-only" htmlFor="issue-sort">Sort by</label>
          <select
            id="issue-sort"
            className="select"
            value={`${value.sortBy}:${value.sortDir}`}
            onChange={(event) => {
              const [sortBy, sortDir] = event.target.value.split(':');
              onChange({ ...value, sortBy: sortBy!, sortDir: sortDir as 'asc' | 'desc' });
            }}
          >
            {SORT_OPTIONS.flatMap((option) => [
              <option key={`${option.value}:desc`} value={`${option.value}:desc`}>{option.label} (newest first)</option>,
              <option key={`${option.value}:asc`} value={`${option.value}:asc`}>{option.label} (oldest first)</option>,
            ])}
          </select>
        </div>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="filter-panel"
        >
          Filters{activeCount > 0 && <span className="badge badge-navy" style={{ marginLeft: 6 }}>{activeCount}</span>}
        </button>

        {activeCount > 0 && (
          <button type="button" className="btn btn-ghost" onClick={() => onChange({ ...EMPTY_FILTERS, sortBy: value.sortBy, sortDir: value.sortDir })}>
            Clear
          </button>
        )}
      </div>

      {expanded && (
        <div id="filter-panel" className="stack-sm" style={{ paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--ink-100)' }}>
          <label className="checkbox-row">
            <input type="checkbox" checked={value.onlyOpen} onChange={(event) => onChange({ ...value, onlyOpen: event.target.checked })} />
            <span className="small">Show only issues that are still open</span>
          </label>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Status</legend>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              {ALL_STATUSES.map((status) => (
                <label
                  key={status}
                  className="checkbox-row"
                  style={{
                    padding: '5px 10px',
                    border: `1px solid ${value.status.includes(status) ? 'var(--navy-600)' : 'var(--ink-200)'}`,
                    background: value.status.includes(status) ? 'var(--navy-50)' : 'transparent',
                    borderRadius: 'var(--radius-full)', cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={value.status.includes(status)} onChange={() => toggle('status', status)} />
                  <span className="small">{STATUS_META[status].label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {showPriority && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Priority</legend>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {PRIORITIES.map((priority) => (
                  <label
                    key={priority}
                    className="checkbox-row"
                    style={{
                      padding: '5px 10px',
                      border: `1px solid ${value.priority.includes(priority) ? 'var(--navy-600)' : 'var(--ink-200)'}`,
                      background: value.priority.includes(priority) ? 'var(--navy-50)' : 'transparent',
                      borderRadius: 'var(--radius-full)', cursor: 'pointer',
                    }}
                  >
                    <input type="checkbox" checked={value.priority.includes(priority)} onChange={() => toggle('priority', priority)} />
                    <span className="small">{priority.charAt(0) + priority.slice(1).toLowerCase()}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {showCategory && categories.data && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">Category</legend>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {categories.data.map((category) => (
                  <label
                    key={category.id}
                    className="checkbox-row"
                    style={{
                      padding: '5px 10px',
                      border: `1px solid ${value.categoryId.includes(String(category.id)) ? 'var(--navy-600)' : 'var(--ink-200)'}`,
                      background: value.categoryId.includes(String(category.id)) ? 'var(--navy-50)' : 'transparent',
                      borderRadius: 'var(--radius-full)', cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={value.categoryId.includes(String(category.id))}
                      onChange={() => toggle('categoryId', String(category.id))}
                    />
                    <span className="small">{category.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
      )}
    </div>
  );
}
