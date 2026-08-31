import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

export function NotFoundPage(): JSX.Element {
  const { user } = useAuth();

  return (
    <main
      id="main-content"
      className="container"
      style={{ maxWidth: 520, padding: 'var(--sp-16) var(--sp-4)', textAlign: 'center' }}
    >
      <p style={{ fontSize: 56, lineHeight: 1 }} aria-hidden="true">🧭</p>
      <h1 style={{ marginTop: 'var(--sp-4)' }}>Page not found</h1>
      <p className="muted" style={{ marginTop: 'var(--sp-2)' }}>
        The address you followed does not exist. It may have been moved, or the link may be incomplete.
      </p>
      <div className="row" style={{ gap: 12, justifyContent: 'center', marginTop: 'var(--sp-6)', flexWrap: 'wrap' }}>
        <Link to={user ? '/app' : '/'} className="btn btn-primary">
          {user ? 'Back to your dashboard' : 'Back to the home page'}
        </Link>
        <Link to="/community" className="btn btn-secondary">Community map</Link>
      </div>
    </main>
  );
}
