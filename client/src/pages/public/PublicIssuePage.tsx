import { Link, useParams } from 'react-router-dom';
import { useIssue } from '@/hooks/useIssues';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/client';
import { ErrorState, LoadingState, PriorityBadge, StatusBadge } from '@/components/ui';
import { IssueTimeline } from '@/components/IssueTimeline';
import { formatDateTime, mapLink, relativeTime } from '@/utils/format';

/**
 * Public, read-only view of a single report.
 *
 * Uses the same GET /issues/:id endpoint as the authenticated detail page —
 * the SERVER decides what a given viewer may see, so an anonymous visitor
 * receives a reduced projection without the client having to strip anything.
 */
export function PublicIssuePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const query = useIssue(id);

  if (query.isLoading) {
    return (
      <div className="container" style={{ padding: 'var(--sp-10) 0' }}>
        <LoadingState label="Loading report…" rows={4} />
      </div>
    );
  }

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div className="container" style={{ padding: 'var(--sp-10) 0', maxWidth: 640 }}>
        <ErrorState
          title={notFound ? 'Report not available' : 'Could not load this report'}
          message={
            notFound
              ? 'This report either does not exist or is not public. If it is your own report, sign in to view it.'
              : (query.error as Error).message
          }
          onRetry={notFound ? undefined : () => void query.refetch()}
        />
        <div className="row" style={{ gap: 12, justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
          <Link to="/community" className="btn btn-secondary">Back to the map</Link>
          {!user && <Link to="/login" className="btn btn-primary">Sign in</Link>}
        </div>
      </div>
    );
  }

  const detail = query.data!;
  const { issue } = detail;

  return (
    <section style={{ padding: 'var(--sp-8) 0 var(--sp-12)' }}>
      <div className="container" style={{ maxWidth: 860 }}>
        <nav aria-label="Breadcrumb" style={{ marginBottom: 'var(--sp-4)' }}>
          <Link to="/community" className="small">← Back to the community map</Link>
        </nav>

        <article className="stack">
          <header className="stack-sm">
            <p className="small muted">
              <span className="strong">{issue.publicId}</span> · reported{' '}
              <time dateTime={issue.createdAt} title={formatDateTime(issue.createdAt)}>
                {relativeTime(issue.createdAt)}
              </time>
            </p>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>{issue.title}</h1>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <StatusBadge status={issue.status} />
              <PriorityBadge priority={issue.officialPriority} />
              {issue.categoryName && <span className="badge badge-neutral">{issue.categoryName}</span>}
            </div>
          </header>

          <div className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Description</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{issue.description}</p>
          </div>

          {detail.images.length > 0 && (
            <div className="card card-pad stack-sm">
              <h2 style={{ fontSize: 'var(--text-base)' }}>Photographs</h2>
              <ul className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
                {detail.images.map((image) => (
                  <li key={image.id}>
                    <a
                      href={`/api/issues/${issue.id}/images/${image.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block' }}
                    >
                      <img
                        src={`/api/issues/${issue.id}/images/${image.id}`}
                        alt={
                          image.type === 'RESOLUTION'
                            ? `Photograph showing the completed repair for ${issue.title}`
                            : `Photograph submitted with the report of ${issue.title}`
                        }
                        loading="lazy"
                        style={{
                          width: '100%', aspectRatio: '4 / 3', objectFit: 'cover',
                          borderRadius: 'var(--radius)', border: '1px solid var(--ink-200)',
                        }}
                      />
                      <span className="tiny muted">
                        {image.type === 'RESOLUTION' ? 'After repair' : 'As reported'}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Location</h2>
            {issue.landmark && <p className="small"><span className="muted">Landmark:</span> {issue.landmark}</p>}
            {issue.address && <p className="small"><span className="muted">Area:</span> {issue.address}</p>}
            <p className="small">
              Approximate position: {issue.latitude.toFixed(3)}, {issue.longitude.toFixed(3)}
            </p>
            <p>
              <a href={mapLink(issue.latitude, issue.longitude)} target="_blank" rel="noopener noreferrer" className="small">
                Open the approximate location in OpenStreetMap
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
            <p className="tiny muted">
              Public coordinates are rounded to protect the reporter's privacy.
            </p>
          </div>

          {detail.history.length > 0 && (
            <div className="card card-pad stack-sm">
              <h2 style={{ fontSize: 'var(--text-base)' }}>Progress</h2>
              <IssueTimeline entries={detail.history} showActor={false} />
            </div>
          )}

          <div className="card card-pad">
            <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
              <p className="small muted" style={{ maxWidth: '48ch' }}>
                Seeing the same problem? Reporting it too helps the municipality gauge how many people are affected.
              </p>
              <Link to={user ? '/app/report' : '/register'} className="btn btn-primary">
                {user ? 'Report an issue' : 'Create an account to report'}
              </Link>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
