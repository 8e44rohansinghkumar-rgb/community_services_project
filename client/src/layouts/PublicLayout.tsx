/** Public marketing/transparency shell — no auth required. */
import { useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/how-it-works', label: 'How it works' },
  { to: '/community', label: 'Community map' },
  { to: '/about', label: 'About' },
];

export function PublicLayout(): JSX.Element {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header
        style={{
          background: 'var(--white)',
          borderBottom: '1px solid var(--ink-200)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
        }}
      >
        <div className="container row-between" style={{ height: 'var(--header-h)' }}>
          <Link to="/" className="row" style={{ gap: 10, textDecoration: 'none', color: 'var(--navy-900)', fontWeight: 700 }}>
            <span aria-hidden="true" style={{ fontSize: 20 }}>🏛</span>
            <span>Civic Connect</span>
          </Link>

          <nav aria-label="Primary" className="row hide-mobile" style={{ gap: 4 }}>
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                style={({ isActive }) => ({
                  padding: '8px 12px',
                  borderRadius: 'var(--radius)',
                  textDecoration: 'none',
                  fontSize: 'var(--text-sm)',
                  fontWeight: isActive ? 650 : 500,
                  color: isActive ? 'var(--navy-800)' : 'var(--ink-700)',
                  background: isActive ? 'var(--navy-50)' : 'transparent',
                })}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="row" style={{ gap: 8 }}>
            {user ? (
              <Link to="/app" className="btn btn-primary btn-sm">Go to dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="btn btn-secondary btn-sm hide-mobile">Sign in</Link>
                <Link to="/register" className="btn btn-primary btn-sm">Report an issue</Link>
              </>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm show-mobile"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-controls="public-mobile-nav"
              aria-label={open ? 'Close menu' : 'Open menu'}
            >
              {open ? '✕' : '☰'}
            </button>
          </div>
        </div>

        {open && (
          <nav id="public-mobile-nav" aria-label="Primary mobile" className="show-mobile" style={{ borderTop: '1px solid var(--ink-200)' }}>
            <div className="container stack-sm" style={{ padding: 'var(--sp-3) var(--sp-4)' }}>
              {LINKS.map((link) => (
                <NavLink key={link.to} to={link.to} end={link.end} onClick={() => setOpen(false)} style={{ padding: '10px 4px', textDecoration: 'none' }}>
                  {link.label}
                </NavLink>
              ))}
              {!user && (
                <Link to="/login" className="btn btn-secondary btn-block" onClick={() => setOpen(false)}>
                  Sign in
                </Link>
              )}
            </div>
          </nav>
        )}
      </header>

      <main id="main-content" style={{ flex: 1 }}>
        <Outlet />
      </main>

      <footer style={{ background: 'var(--navy-900)', color: 'var(--navy-100)', padding: 'var(--sp-10) 0 var(--sp-6)', marginTop: 'auto' }}>
        <div className="container">
          <div className="grid-3" style={{ gap: 'var(--sp-8)' }}>
            <div className="stack-sm">
              <p className="row" style={{ gap: 8, color: 'var(--white)', fontWeight: 700 }}>
                <span aria-hidden="true">🏛</span> Civic Connect
              </p>
              <p className="small" style={{ color: 'var(--navy-100)', maxWidth: '32ch' }}>
                A civic issue reporting and resolution platform built to support UN Sustainable Development Goal 11 —
                Sustainable Cities and Communities.
              </p>
            </div>
            <nav className="stack-sm" aria-label="Footer">
              <p className="small" style={{ color: 'var(--white)', fontWeight: 650 }}>Explore</p>
              {LINKS.map((link) => (
                <Link key={link.to} to={link.to} className="small" style={{ color: 'var(--navy-100)' }}>
                  {link.label}
                </Link>
              ))}
            </nav>
            <div className="stack-sm">
              <p className="small" style={{ color: 'var(--white)', fontWeight: 650 }}>Account</p>
              <Link to="/login" className="small" style={{ color: 'var(--navy-100)' }}>Sign in</Link>
              <Link to="/register" className="small" style={{ color: 'var(--navy-100)' }}>Create an account</Link>
              <Link to="/privacy" className="small" style={{ color: 'var(--navy-100)' }}>Privacy policy</Link>
            </div>
          </div>
          <p className="tiny" style={{ marginTop: 'var(--sp-8)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--navy-700)', color: 'var(--navy-200)' }}>
            Civic Connect · Open civic technology demonstration · Data shown on public pages is location-generalised.
          </p>
        </div>
      </footer>
    </div>
  );
}
