import { Link } from 'react-router-dom';
import { useCategories } from '@/hooks/useIssues';
import { LoadingState, ErrorState } from '@/components/ui';

const STEPS = [
  {
    number: 1,
    title: 'Describe the problem',
    body: 'Pick a category, give it a short title and explain what is wrong. Two sentences is usually enough — where it is, and what the risk is.',
    detail: 'The category decides which department receives the report and what response time applies.',
  },
  {
    number: 2,
    title: 'Add photos',
    body: 'Up to five photos, 5 MB each. A wide shot plus a close-up helps the crew arrive with the right equipment.',
    detail: 'Files are checked by content, not just by filename, and are never served from a public folder.',
  },
  {
    number: 3,
    title: 'Pin the location',
    body: 'Use your device GPS or drop the coordinates manually, then add a landmark such as "opposite the bus stand".',
    detail: 'If a similar issue was already reported within 150 metres in the last week, we show it to you before you submit.',
  },
  {
    number: 4,
    title: 'Track it',
    body: 'You get a tracking ID like CIV-2026-000123 and a notification at every status change, right through to closure.',
    detail: 'If the fix is not right, you can reopen the report with an explanation and it goes back into the queue.',
  },
];

export function HowItWorksPage(): JSX.Element {
  const categories = useCategories();

  return (
    <>
      <section style={{ background: 'var(--navy-900)', color: 'var(--white)', padding: 'var(--sp-12) 0' }}>
        <div className="container stack-sm">
          <h1 style={{ color: 'var(--white)' }}>How it works</h1>
          <p style={{ color: 'var(--navy-100)', maxWidth: '60ch', fontSize: 'var(--text-lg)' }}>
            From spotting a problem to confirming the repair — and what happens on the municipal side in between.
          </p>
        </div>
      </section>

      <section style={{ padding: 'var(--sp-12) 0' }}>
        <div className="container stack">
          <h2>Reporting an issue</h2>
          <ol className="stack" style={{ listStyle: 'none', padding: 0 }}>
            {STEPS.map((step) => (
              <li key={step.number} className="card card-pad">
                <div className="row" style={{ gap: 'var(--sp-4)', alignItems: 'flex-start' }}>
                  <span
                    aria-hidden="true"
                    style={{
                      flexShrink: 0, width: 40, height: 40, borderRadius: '50%',
                      background: 'var(--navy-700)', color: 'var(--white)',
                      display: 'grid', placeItems: 'center', fontSize: 'var(--text-lg)', fontWeight: 700,
                    }}
                  >
                    {step.number}
                  </span>
                  <div className="stack-sm">
                    <h3 style={{ fontSize: 'var(--text-lg)' }}>
                      <span className="sr-only">Step {step.number}: </span>
                      {step.title}
                    </h3>
                    <p>{step.body}</p>
                    <p className="small muted">{step.detail}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section style={{ padding: 'var(--sp-12) 0', background: 'var(--navy-50)' }}>
        <div className="container stack">
          <div className="stack-sm">
            <h2>The lifecycle of a report</h2>
            <p className="muted" style={{ maxWidth: '64ch' }}>
              A report can only move along paths the system allows. That is enforced on the server, so the timeline you
              see is a genuine record of what happened, not a display convention.
            </p>
          </div>

          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Issue statuses, who can trigger them and what they mean</caption>
              <thead>
                <tr>
                  <th scope="col">Status</th>
                  <th scope="col">What it means</th>
                  <th scope="col">Who moves it forward</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ['Reported', 'Submitted and waiting for the civic desk', 'Administrator'],
                  ['Under review', 'Being verified, prioritised and routed', 'Administrator'],
                  ['Assigned', 'A named field worker owns it', 'Administrator assigns; worker accepts'],
                  ['In progress', 'Work has started on site', 'Assigned worker'],
                  ['On hold', 'Blocked — parts, weather, access, permissions', 'Assigned worker or administrator'],
                  ['Resolved', 'Work finished, evidence photos uploaded', 'Assigned worker'],
                  ['Closed', 'Confirmed complete', 'Reporter or administrator'],
                  ['Reopened', 'The fix did not hold or was incomplete', 'Reporter or administrator'],
                  ['Rejected', 'Not actionable — duplicate, out of jurisdiction, invalid', 'Administrator, with a reason'],
                ].map(([status, meaning, who]) => (
                  <tr key={status}>
                    <th scope="row">{status}</th>
                    <td>{meaning}</td>
                    <td className="small muted">{who}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="small muted">
            Moving to <strong>Resolved</strong> requires at least one resolution photo, and every rejection, hold or
            reopening requires a written reason. Both rules are enforced by the API.
          </p>
        </div>
      </section>

      <section style={{ padding: 'var(--sp-12) 0' }}>
        <div className="container stack">
          <div className="stack-sm">
            <h2>Response times by category</h2>
            <p className="muted">
              Target windows the municipality aims for, measured from the moment a report is submitted.
            </p>
          </div>

          {categories.isLoading && <LoadingState label="Loading response targets…" rows={2} />}
          {categories.isError && (
            <ErrorState message="Could not load response targets." onRetry={() => void categories.refetch()} />
          )}
          {categories.data && (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Target response time for each issue category</caption>
                <thead>
                  <tr>
                    <th scope="col">Category</th>
                    <th scope="col">Default urgency</th>
                    <th scope="col">Target response</th>
                  </tr>
                </thead>
                <tbody>
                  {categories.data.map((category) => (
                    <tr key={category.id}>
                      <th scope="row">
                        <span aria-hidden="true">{category.icon} </span>
                        {category.name}
                      </th>
                      <td>{category.defaultSeverity.charAt(0) + category.defaultSeverity.slice(1).toLowerCase()}</td>
                      <td>
                        {category.slaHours >= 24
                          ? `${Math.round(category.slaHours / 24)} day${Math.round(category.slaHours / 24) === 1 ? '' : 's'}`
                          : `${category.slaHours} hours`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="tiny muted">
            Targets are planning figures used for prioritisation and reporting. They are not a service guarantee.
          </p>
        </div>
      </section>

      <section style={{ padding: 'var(--sp-10) 0 var(--sp-16)' }}>
        <div className="container" style={{ textAlign: 'center' }}>
          <Link to="/register" className="btn btn-primary btn-lg">Report your first issue</Link>
        </div>
      </section>
    </>
  );
}
