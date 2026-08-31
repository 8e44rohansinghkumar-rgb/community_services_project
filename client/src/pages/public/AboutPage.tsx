import { Link } from 'react-router-dom';

export function AboutPage(): JSX.Element {
  return (
    <>
      <section style={{ background: 'var(--navy-900)', color: 'var(--white)', padding: 'var(--sp-12) 0' }}>
        <div className="container stack-sm">
          <h1 style={{ color: 'var(--white)' }}>About Civic Connect</h1>
          <p style={{ color: 'var(--navy-100)', maxWidth: '62ch', fontSize: 'var(--text-lg)' }}>
            A reporting and resolution system for local civic infrastructure, built as a community-service project in
            support of UN Sustainable Development Goal 11.
          </p>
        </div>
      </section>

      <section style={{ padding: 'var(--sp-12) 0' }}>
        <div className="container" style={{ maxWidth: 760 }}>
          <div className="stack">
            <div className="stack-sm">
              <h2>The problem this addresses</h2>
              <p>
                Most municipal complaint channels are a phone number or a paper register. A resident reports a broken
                streetlight, receives no reference number, and has no way of knowing whether anyone was assigned to it.
                The municipality, in turn, has no reliable record of how many reports arrived, which wards generate the
                most, or how long repairs actually take.
              </p>
              <p>
                Civic Connect closes that loop. Every report gets a tracking ID, an owner, a timeline, and evidence at
                resolution. Every status change is recorded with who made it and why.
              </p>
            </div>

            <div className="stack-sm">
              <h2 id="sdg-11">SDG 11 — Sustainable Cities and Communities</h2>
              <p>
                Target 11.3 calls for participatory, integrated and sustainable human-settlement planning. Target 11.7
                calls for safe, inclusive and accessible public spaces. This project contributes to both in a modest,
                concrete way:
              </p>
              <ul className="stack-sm" style={{ paddingLeft: '1.2rem' }}>
                <li>
                  <strong>Participation.</strong> Any resident with a phone can file a report that enters the same queue
                  as every other, with the same tracking.
                </li>
                <li>
                  <strong>Accountability.</strong> Status history and audit logs make it visible when something has been
                  sitting untouched.
                </li>
                <li>
                  <strong>Evidence for planning.</strong> Aggregated data — issues per category, per ward, median
                  resolution time, recurring hotspots — is generated from the live database, giving planners something
                  better than anecdote.
                </li>
                <li>
                  <strong>Safety.</strong> Hazards such as open manholes are automatically prioritised above cosmetic
                  issues.
                </li>
              </ul>
              <div className="alert alert-info" role="note">
                <span className="alert-icon" aria-hidden="true">ℹ</span>
                <div>
                  <strong>An honest scope note.</strong> Software does not repair a road. This platform only makes the
                  reporting and tracking part work properly. Its real-world value depends entirely on a municipality
                  having the staff, budget and will to act on what it receives.
                </div>
              </div>
            </div>

            <div className="stack-sm">
              <h2>How it is built</h2>
              <p>
                A React and TypeScript single-page application talks to a Node.js and Express REST API, which stores
                everything in PostgreSQL. The database schema is normalised and written as versioned SQL migrations;
                queries are parameterised throughout.
              </p>
              <div className="grid-2">
                <div className="card card-pad stack-sm">
                  <h3 style={{ fontSize: 'var(--text-base)' }}>Frontend</h3>
                  <ul className="small stack-sm" style={{ paddingLeft: '1.1rem' }}>
                    <li>React 18 with TypeScript</li>
                    <li>Vite build tooling</li>
                    <li>React Router for navigation</li>
                    <li>TanStack Query for server state</li>
                    <li>Hand-written CSS design system</li>
                  </ul>
                </div>
                <div className="card card-pad stack-sm">
                  <h3 style={{ fontSize: 'var(--text-base)' }}>Backend</h3>
                  <ul className="small stack-sm" style={{ paddingLeft: '1.1rem' }}>
                    <li>Node.js and Express in TypeScript</li>
                    <li>PostgreSQL with the <code>pg</code> driver</li>
                    <li>Zod validation on every input</li>
                    <li>Argon2id password hashing</li>
                    <li>HttpOnly cookie sessions with rotating refresh tokens</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="stack-sm">
              <h2>Privacy by default</h2>
              <p>
                Reports marked public appear on the community map, but the reporter's name and contact details are never
                shown, and coordinates are rounded to roughly 110 metres so a report cannot be traced to a doorstep.
                Full precision is available only to the assigned worker and the administrators who need it to dispatch a
                crew. Read the <Link to="/privacy">privacy policy</Link> for details.
              </p>
            </div>

            <div className="row" style={{ gap: 12, flexWrap: 'wrap', paddingTop: 'var(--sp-4)' }}>
              <Link to="/how-it-works" className="btn btn-secondary">How it works</Link>
              <Link to="/community" className="btn btn-secondary">Community map</Link>
              <Link to="/register" className="btn btn-primary">Create an account</Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
