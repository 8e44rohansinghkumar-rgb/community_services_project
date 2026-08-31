import { Link } from 'react-router-dom';
import { usePublicIssues } from '@/hooks/useIssues';
import { useCategories } from '@/hooks/useIssues';
import { StatusBadge, LoadingState, ErrorState } from '@/components/ui';
import { relativeTime } from '@/utils/format';

/**
 * Public landing page.
 *
 * The "recent reports" strip and the category grid are live data from the API —
 * nothing on this page is hardcoded.
 */
export function LandingPage(): JSX.Element {
  const recent = usePublicIssues({ limit: 6, sortBy: 'createdAt', sortDir: 'desc' });
  const categories = useCategories();

  return (
    <>
      {/* ---------------- Hero ---------------- */}
      <section
        style={{
          background: 'linear-gradient(160deg, var(--navy-900) 0%, var(--navy-800) 55%, var(--navy-700) 100%)',
          color: 'var(--white)',
          padding: 'var(--sp-16) 0 var(--sp-12)',
        }}
      >
        <div className="container">
          <div className="grid-2" style={{ gap: 'var(--sp-10)', alignItems: 'center' }}>
            <div className="stack">
              <span
                className="badge"
                style={{ background: 'rgba(245,158,11,0.18)', color: 'var(--amber-300)', border: '1px solid rgba(245,158,11,0.35)', width: 'fit-content' }}
              >
                UN SDG 11 · Sustainable Cities and Communities
              </span>
              <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', lineHeight: 1.1, color: 'var(--white)' }}>
                Report a civic problem. Watch it get fixed.
              </h1>
              <p style={{ fontSize: 'var(--text-lg)', color: 'var(--navy-100)', maxWidth: '54ch' }}>
                Potholes, broken streetlights, overflowing bins, water leaks. Send it to the right department with a
                photo and a location, then follow every status change until the work is confirmed complete.
              </p>
              <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
                <Link to="/register" className="btn btn-accent btn-lg">Report an issue</Link>
                <Link to="/community" className="btn btn-secondary btn-lg">See what's happening nearby</Link>
              </div>
              <p className="small" style={{ color: 'var(--navy-200)' }}>
                Already registered? <Link to="/login" style={{ color: 'var(--amber-300)' }}>Sign in to your dashboard</Link>
              </p>
            </div>

            {/* Illustrative lifecycle card — describes the real state machine. */}
            <div
              className="card card-pad hide-mobile"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.14)', backdropFilter: 'blur(6px)' }}
            >
              <p className="small" style={{ color: 'var(--navy-100)', fontWeight: 600, marginBottom: 'var(--sp-4)' }}>
                Every report follows the same tracked path
              </p>
              <ol className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  { step: 'Reported', detail: 'You submit with photo and GPS location' },
                  { step: 'Under review', detail: 'The civic desk verifies and prioritises' },
                  { step: 'Assigned', detail: 'A field worker takes ownership' },
                  { step: 'In progress', detail: 'Work starts on site' },
                  { step: 'Resolved', detail: 'Evidence photos are uploaded' },
                  { step: 'Closed', detail: 'You confirm the fix — or reopen it' },
                ].map((item, index) => (
                  <li key={item.step} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
                    <span
                      aria-hidden="true"
                      style={{
                        flexShrink: 0, width: 26, height: 26, borderRadius: '50%',
                        background: 'var(--amber-500)', color: 'var(--navy-900)',
                        display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                      }}
                    >
                      {index + 1}
                    </span>
                    <span>
                      <span style={{ display: 'block', fontWeight: 650, color: 'var(--white)', fontSize: 'var(--text-sm)' }}>
                        {item.step}
                      </span>
                      <span style={{ display: 'block', color: 'var(--navy-100)', fontSize: 'var(--text-sm)' }}>
                        {item.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------- Categories ---------------- */}
      <section style={{ padding: 'var(--sp-12) 0' }}>
        <div className="container stack">
          <div className="stack-sm">
            <h2>What you can report</h2>
            <p className="muted" style={{ maxWidth: '62ch' }}>
              Each category routes to the department that owns it and carries its own target response time.
            </p>
          </div>

          {categories.isLoading && <LoadingState label="Loading categories…" rows={2} />}
          {categories.isError && (
            <ErrorState message="We could not load the category list just now." onRetry={() => void categories.refetch()} />
          )}
          {categories.data && (
            <ul className="grid-4" style={{ listStyle: 'none', padding: 0 }}>
              {categories.data.map((category) => (
                <li key={category.id} className="card card-pad stack-sm">
                  <span aria-hidden="true" style={{ fontSize: 26 }}>{category.icon ?? '📍'}</span>
                  <h3 style={{ fontSize: 'var(--text-base)' }}>{category.name}</h3>
                  {category.description && <p className="small muted clamp-2">{category.description}</p>}
                  <p className="tiny muted">
                    Target response: {category.slaHours >= 24 ? `${Math.round(category.slaHours / 24)} days` : `${category.slaHours} hours`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---------------- Recent public reports ---------------- */}
      <section style={{ padding: 'var(--sp-12) 0', background: 'var(--navy-50)' }}>
        <div className="container stack">
          <div className="row-between" style={{ flexWrap: 'wrap', gap: 12 }}>
            <div className="stack-sm">
              <h2>Recently reported in the community</h2>
              <p className="muted">Live from the public feed. Exact coordinates are generalised for reporter privacy.</p>
            </div>
            <Link to="/community" className="btn btn-secondary">View the full map</Link>
          </div>

          {recent.isLoading && <LoadingState label="Loading recent reports…" />}
          {recent.isError && <ErrorState message="The public feed is unavailable right now." onRetry={() => void recent.refetch()} />}
          {recent.data && recent.data.data.length === 0 && (
            <div className="card card-pad">
              <p className="muted">No public reports yet. Be the first to report an issue in your area.</p>
            </div>
          )}
          {recent.data && recent.data.data.length > 0 && (
            <ul className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
              {recent.data.data.map((issue) => (
                <li key={issue.id}>
                  <Link
                    to={`/issues/${issue.id}`}
                    className="card card-pad card-interactive stack-sm"
                    style={{ textDecoration: 'none', color: 'inherit', height: '100%' }}
                  >
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <StatusBadge status={issue.status} />
                      <span className="badge badge-neutral">{issue.categoryName}</span>
                    </div>
                    <h3 style={{ fontSize: 'var(--text-base)' }} className="clamp-2">{issue.title}</h3>
                    <p className="small muted clamp-2">{issue.description}</p>
                    <p className="tiny muted">
                      {issue.landmark ?? issue.address ?? 'Location recorded'} · <time dateTime={issue.createdAt}>{relativeTime(issue.createdAt)}</time>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ---------------- Roles ---------------- */}
      <section style={{ padding: 'var(--sp-12) 0' }}>
        <div className="container stack">
          <h2>Built for three kinds of user</h2>
          <div className="grid-3">
            {[
              {
                icon: '🧍',
                title: 'Citizens',
                points: ['Report with photos and GPS', 'Track status in real time', 'Confirm or reopen a fix', 'Comment on your own reports'],
              },
              {
                icon: '👷',
                title: 'Field workers',
                points: ['See only your assignments', 'Start work and log progress', 'Upload resolution evidence', 'Mark work resolved'],
              },
              {
                icon: '🏛',
                title: 'Administrators',
                points: ['Triage and prioritise', 'Assign to the right worker', 'Monitor SLA and workload', 'Review the full audit log'],
              },
            ].map((role) => (
              <div key={role.title} className="card card-pad stack-sm">
                <span aria-hidden="true" style={{ fontSize: 28 }}>{role.icon}</span>
                <h3 style={{ fontSize: 'var(--text-lg)' }}>{role.title}</h3>
                <ul className="stack-sm small" style={{ paddingLeft: '1.1rem', margin: 0 }}>
                  {role.points.map((point) => <li key={point}>{point}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------- CTA ---------------- */}
      <section style={{ padding: 'var(--sp-12) 0', background: 'var(--navy-900)', color: 'var(--white)' }}>
        <div className="container" style={{ textAlign: 'center' }}>
          <h2 style={{ color: 'var(--white)' }}>Spotted something broken?</h2>
          <p style={{ color: 'var(--navy-100)', maxWidth: '52ch', margin: '0 auto var(--sp-6)' }}>
            Reporting takes about a minute. You will get a tracking ID and a notification at every status change.
          </p>
          <Link to="/register" className="btn btn-accent btn-lg">Create a free account</Link>
        </div>
      </section>
    </>
  );
}
