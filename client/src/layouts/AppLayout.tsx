/**
 * Authenticated shell: header, role-aware navigation, notification bell.
 *
 * Navigation is filtered by role for usability only — the server enforces the
 * real boundary. Hiding a link is never treated as security.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useUnreadCount } from '@/hooks/useNotifications';
import { ROLE_LABEL, initials } from '@/utils/format';
import type { UserRole } from '@/types';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles: UserRole[];
  end?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: '▤', roles: ['CITIZEN', 'WORKER', 'ADMIN'], end: true },
  { to: '/app/report', label: 'Report an issue', icon: '＋', roles: ['CITIZEN', 'ADMIN'] },
  { to: '/app/issues', label: 'My issues', icon: '☰', roles: ['CITIZEN'] },
  { to: '/app/assigned', label: 'My assignments', icon: '🔧', roles: ['WORKER'] },
  { to: '/app/work-history', label: 'Work history', icon: '⏱', roles: ['WORKER'] },
  { to: '/app/admin/issues', label: 'All issues', icon: '☰', roles: ['ADMIN'] },
  { to: '/app/admin/analytics', label: 'Analytics', icon: '◔', roles: ['ADMIN'] },
  { to: '/app/admin/workers', label: 'Workers', icon: '👷', roles: ['ADMIN'] },
  { to: '/app/admin/users', label: 'Users', icon: '👤', roles: ['ADMIN'] },
  { to: '/app/admin/categories', label: 'Categories', icon: '🏷', roles: ['ADMIN'] },
  { to: '/app/admin/audit', label: 'Audit log', icon: '🛡', roles: ['ADMIN'] },
  { to: '/app/notifications', label: 'Notifications', icon: '🔔', roles: ['CITIZEN', 'WORKER', 'ADMIN'] },
  { to: '/app/profile', label: 'Profile', icon: '⚙', roles: ['CITIZEN', 'WORKER', 'ADMIN'] },
];

export function AppLayout(): JSX.Element {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = useUnreadCount();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  if (!user) return <></>;

  const items = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header
        style={{
          height: 'var(--header-h)',
          background: 'var(--navy-900)',
          color: 'var(--white)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          borderBottom: '1px solid var(--navy-700)',
        }}
      >
        <div className="container row-between" style={{ height: '100%' }}>
          <div className="row" style={{ gap: 12 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm show-mobile"
              style={{ color: 'var(--white)' }}
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              aria-controls="app-nav"
              aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            >
              {menuOpen ? '✕' : '☰'}
            </button>
            <Link
              to="/app"
              className="row"
              style={{ gap: 10, color: 'var(--white)', textDecoration: 'none', fontWeight: 700 }}
            >
              <span aria-hidden="true" style={{ fontSize: 20 }}>🏛</span>
              <span>Civic Connect</span>
            </Link>
          </div>

          <div className="row" style={{ gap: 8 }}>
            <Link
              to="/app/notifications"
              className="btn btn-ghost btn-sm"
              style={{ color: 'var(--white)', position: 'relative' }}
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            >
              <span aria-hidden="true" style={{ fontSize: 16 }}>🔔</span>
              {unread > 0 && (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute', top: 2, right: 2, minWidth: 17, height: 17,
                    padding: '0 4px', borderRadius: 9, background: 'var(--amber-500)',
                    color: 'var(--navy-900)', fontSize: 10, fontWeight: 700,
                    display: 'grid', placeItems: 'center',
                  }}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>

            <div className="row hide-mobile" style={{ gap: 10, paddingLeft: 8, borderLeft: '1px solid var(--navy-700)' }}>
              <span
                aria-hidden="true"
                style={{
                  width: 32, height: 32, borderRadius: '50%', background: 'var(--navy-600)',
                  display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700,
                }}
              >
                {initials(user.name)}
              </span>
              <span className="small" style={{ lineHeight: 1.2 }}>
                <span style={{ display: 'block', fontWeight: 600 }}>{user.name}</span>
                <span style={{ display: 'block', color: 'var(--navy-100)', fontSize: 11 }}>
                  {ROLE_LABEL[user.role]}
                </span>
              </span>
            </div>

            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--white)' }} onClick={handleLogout}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, alignItems: 'flex-start' }}>
        <nav
          id="app-nav"
          aria-label="Main navigation"
          className={menuOpen ? 'nav-open' : ''}
          style={{
            width: 'var(--sidebar-w)',
            flexShrink: 0,
            background: 'var(--white)',
            borderRight: '1px solid var(--ink-200)',
            padding: 'var(--sp-4) var(--sp-3)',
            position: 'sticky',
            top: 'var(--header-h)',
            height: 'calc(100vh - var(--header-h))',
            overflowY: 'auto',
          }}
        >
          <ul className="stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className="row"
                  style={({ isActive }) => ({
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 'var(--radius)',
                    textDecoration: 'none',
                    fontSize: 'var(--text-sm)',
                    fontWeight: isActive ? 650 : 500,
                    color: isActive ? 'var(--navy-800)' : 'var(--ink-700)',
                    background: isActive ? 'var(--navy-50)' : 'transparent',
                    borderLeft: `3px solid ${isActive ? 'var(--navy-700)' : 'transparent'}`,
                  })}
                >
                  <span aria-hidden="true" style={{ width: 18, textAlign: 'center' }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {item.to === '/app/notifications' && unread > 0 && (
                    <span className="badge badge-warning" style={{ marginLeft: 'auto' }}>{unread}</span>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>

          <div style={{ marginTop: 'var(--sp-6)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--ink-200)' }}>
            <Link to="/community" className="small muted" style={{ display: 'block', padding: '6px 12px' }}>
              Community map
            </Link>
            <Link to="/privacy" className="small muted" style={{ display: 'block', padding: '6px 12px' }}>
              Privacy policy
            </Link>
          </div>
        </nav>

        <main id="main-content" style={{ flex: 1, minWidth: 0, padding: 'var(--sp-6) 0 var(--sp-12)' }}>
          <div className="container">
            <Outlet />
          </div>
        </main>
      </div>

      <style>{`
        @media (max-width: 768px) {
          #app-nav {
            position: fixed;
            top: var(--header-h);
            left: 0;
            bottom: 0;
            height: auto;
            z-index: 45;
            transform: translateX(-100%);
            transition: transform 200ms ease-out;
            box-shadow: var(--shadow-lg);
          }
          #app-nav.nav-open { transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
