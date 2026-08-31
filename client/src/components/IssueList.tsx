/**
 * Shared issue list: card grid on small screens, table on wide ones.
 * Used by the citizen, worker and admin views with different column sets.
 */
import { Link } from 'react-router-dom';
import { PriorityBadge, StatusBadge } from '@/components/ui';
import { formatDateTime, relativeTime } from '@/utils/format';
import type { Issue } from '@/types';

export function IssueList({
  issues,
  showReporter = false,
  showAssignee = false,
  linkBase = '/app/issues',
}: {
  issues: Issue[];
  showReporter?: boolean;
  showAssignee?: boolean;
  linkBase?: string;
}): JSX.Element {
  return (
    <>
      {/* Wide screens: a real table, which is the correct semantics for
          tabular data and lets screen-reader users navigate by column. */}
      <div className="table-wrap hide-mobile">
        <table className="table">
          <caption className="sr-only">
            {issues.length} {issues.length === 1 ? 'issue' : 'issues'}
          </caption>
          <thead>
            <tr>
              <th scope="col">Reference</th>
              <th scope="col">Issue</th>
              <th scope="col">Status</th>
              <th scope="col">Priority</th>
              {showReporter && <th scope="col">Reported by</th>}
              {showAssignee && <th scope="col">Assigned to</th>}
              <th scope="col">Updated</th>
            </tr>
          </thead>
          <tbody>
            {issues.map((issue) => (
              <tr key={issue.id}>
                <th scope="row" style={{ whiteSpace: 'nowrap' }}>
                  <Link to={`${linkBase}/${issue.id}`} className="small strong">{issue.publicId}</Link>
                </th>
                <td style={{ maxWidth: 340 }}>
                  <Link to={`${linkBase}/${issue.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="strong clamp-2" style={{ display: 'block' }}>{issue.title}</span>
                  </Link>
                  <span className="tiny muted">
                    {issue.categoryName}
                    {issue.imageCount ? ` · ${issue.imageCount} photo${issue.imageCount === 1 ? '' : 's'}` : ''}
                    {issue.duplicateCount > 0 ? ` · ${issue.duplicateCount} similar` : ''}
                  </span>
                </td>
                <td><StatusBadge status={issue.status} /></td>
                <td><PriorityBadge priority={issue.officialPriority} /></td>
                {showReporter && <td className="small">{issue.reporterName ?? '—'}</td>}
                {showAssignee && (
                  <td className="small">
                    {issue.assignedWorkerName ?? <span className="muted">Unassigned</span>}
                  </td>
                )}
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>
                  <time dateTime={issue.updatedAt} title={formatDateTime(issue.updatedAt)}>
                    {relativeTime(issue.updatedAt)}
                  </time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: cards. A 7-column table is unusable on a phone. */}
      <ul className="stack-sm show-mobile" style={{ listStyle: 'none', padding: 0 }}>
        {issues.map((issue) => (
          <li key={issue.id}>
            <Link
              to={`${linkBase}/${issue.id}`}
              className="card card-pad card-interactive stack-sm"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div className="row-between" style={{ gap: 8 }}>
                <span className="tiny muted strong">{issue.publicId}</span>
                <time className="tiny muted" dateTime={issue.updatedAt}>{relativeTime(issue.updatedAt)}</time>
              </div>
              <span className="strong clamp-2">{issue.title}</span>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                <StatusBadge status={issue.status} />
                <PriorityBadge priority={issue.officialPriority} />
              </div>
              <span className="tiny muted">
                {issue.categoryName}
                {showAssignee && ` · ${issue.assignedWorkerName ?? 'Unassigned'}`}
                {showReporter && issue.reporterName && ` · by ${issue.reporterName}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
