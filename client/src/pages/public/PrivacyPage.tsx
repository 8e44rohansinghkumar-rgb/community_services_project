export function PrivacyPage(): JSX.Element {
  return (
    <section style={{ padding: 'var(--sp-12) 0' }}>
      <div className="container" style={{ maxWidth: 720 }}>
        <div className="stack">
          <div className="stack-sm">
            <h1>Privacy policy</h1>
            <p className="muted small">
              This describes how the Civic Connect demonstration system handles data. A municipality deploying it in
              production must publish its own policy under the applicable data-protection law.
            </p>
          </div>

          <div className="stack-sm">
            <h2>What we collect</h2>
            <ul className="stack-sm" style={{ paddingLeft: '1.2rem' }}>
              <li><strong>Account details</strong> — name, email address, and an optional phone number.</li>
              <li><strong>Reports</strong> — title, description, category, urgency, photographs, coordinates and any landmark you type.</li>
              <li><strong>Activity</strong> — status changes, comments, and administrative actions, each with a timestamp and the account that performed it.</li>
              <li><strong>Technical data</strong> — the IP address and user agent recorded against security-relevant actions such as sign-in and assignment.</li>
            </ul>
          </div>

          <div className="stack-sm">
            <h2>What is public</h2>
            <p>
              If you mark a report as public it appears on the community map. Public views show the title, description,
              category, status and an <strong>approximate</strong> location. They never show your name, email address,
              phone number or exact coordinates — public coordinates are rounded to three decimal places, roughly 110
              metres.
            </p>
            <p>
              Marking a report private keeps it visible only to you, the assigned worker and administrators.
            </p>
          </div>

          <div className="stack-sm">
            <h2>Who can see the full record</h2>
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">Who can see which parts of a report</caption>
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">You</th>
                    <th scope="col">Assigned worker</th>
                    <th scope="col">Administrator</th>
                    <th scope="col">Public</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Your name and email', 'Yes', 'No', 'Yes', 'No'],
                    ['Exact coordinates', 'Yes', 'Yes', 'Yes', 'No'],
                    ['Photographs', 'Yes', 'Yes', 'Yes', 'Only for public reports'],
                    ['Internal staff notes', 'No', 'Yes', 'Yes', 'No'],
                    ['Status timeline', 'Yes', 'Yes', 'Yes', 'Yes, for public reports'],
                  ].map((row) => (
                    <tr key={row[0]}>
                      <th scope="row">{row[0]}</th>
                      {row.slice(1).map((cell, index) => (
                        <td key={index}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="stack-sm">
            <h2>Cookies</h2>
            <p>
              Three cookies are used, all strictly necessary for the service to function. No analytics, advertising or
              third-party tracking cookies are set.
            </p>
            <ul className="stack-sm" style={{ paddingLeft: '1.2rem' }}>
              <li><code>civic_access</code> — your short-lived session token. HttpOnly, so JavaScript cannot read it.</li>
              <li><code>civic_refresh</code> — renews your session without asking you to sign in again. HttpOnly and restricted to the authentication endpoints.</li>
              <li><code>civic_csrf</code> — a token the application echoes back to prove a request came from this site.</li>
            </ul>
          </div>

          <div className="stack-sm">
            <h2>Retention and deletion</h2>
            <p>
              Reports are retained as part of the municipal record. When a report is removed it is marked deleted rather
              than erased, so that the audit history stays intact and cannot be quietly rewritten. Expired refresh
              tokens are purged automatically every hour.
            </p>
          </div>

          <div className="stack-sm">
            <h2>Your choices</h2>
            <ul className="stack-sm" style={{ paddingLeft: '1.2rem' }}>
              <li>Choose whether each report is public or private at the moment you submit it.</li>
              <li>Update your name and phone number at any time from your profile.</li>
              <li>Change your password, which signs out every other device.</li>
              <li>Sign out of all devices from the profile page.</li>
            </ul>
          </div>

          <div className="alert alert-warning" role="note">
            <span className="alert-icon" aria-hidden="true">⚠</span>
            <div>
              <strong>Demonstration system.</strong> This deployment is a student project. Do not submit sensitive
              personal information or use it to report an emergency. For emergencies, contact your local emergency
              services directly.
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
