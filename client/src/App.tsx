/**
 * Route table.
 *
 * Guards here are a usability layer — they stop a citizen from landing on an
 * admin screen that would only render errors. Authorisation itself is enforced
 * by the API on every request; removing these guards would leak no data.
 */
import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PublicLayout } from '@/layouts/PublicLayout';
import { AppLayout } from '@/layouts/AppLayout';
import { LoadingState } from '@/components/ui';
import type { UserRole } from '@/types';

/* Public pages load eagerly (they are the landing path); the heavier
   authenticated bundles are split out. */
import { LandingPage } from '@/pages/public/LandingPage';
import { LoginPage } from '@/pages/public/LoginPage';
import { RegisterPage } from '@/pages/public/RegisterPage';

const AboutPage = lazy(() => import('@/pages/public/AboutPage').then((m) => ({ default: m.AboutPage })));
const HowItWorksPage = lazy(() => import('@/pages/public/HowItWorksPage').then((m) => ({ default: m.HowItWorksPage })));
const CommunityMapPage = lazy(() => import('@/pages/public/CommunityMapPage').then((m) => ({ default: m.CommunityMapPage })));
const PrivacyPage = lazy(() => import('@/pages/public/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const PublicIssuePage = lazy(() => import('@/pages/public/PublicIssuePage').then((m) => ({ default: m.PublicIssuePage })));

const CitizenDashboard = lazy(() => import('@/pages/citizen/CitizenDashboard').then((m) => ({ default: m.CitizenDashboard })));
const ReportIssuePage = lazy(() => import('@/pages/citizen/ReportIssuePage').then((m) => ({ default: m.ReportIssuePage })));
const MyIssuesPage = lazy(() => import('@/pages/citizen/MyIssuesPage').then((m) => ({ default: m.MyIssuesPage })));
const IssueDetailPage = lazy(() => import('@/pages/IssueDetailPage').then((m) => ({ default: m.IssueDetailPage })));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));

const WorkerDashboard = lazy(() => import('@/pages/worker/WorkerDashboard').then((m) => ({ default: m.WorkerDashboard })));
const AssignedIssuesPage = lazy(() => import('@/pages/worker/AssignedIssuesPage').then((m) => ({ default: m.AssignedIssuesPage })));
const WorkHistoryPage = lazy(() => import('@/pages/worker/WorkHistoryPage').then((m) => ({ default: m.WorkHistoryPage })));

const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard').then((m) => ({ default: m.AdminDashboard })));
const AdminIssuesPage = lazy(() => import('@/pages/admin/AdminIssuesPage').then((m) => ({ default: m.AdminIssuesPage })));
const AnalyticsPage = lazy(() => import('@/pages/admin/AnalyticsPage').then((m) => ({ default: m.AnalyticsPage })));
const WorkersPage = lazy(() => import('@/pages/admin/WorkersPage').then((m) => ({ default: m.WorkersPage })));
const UsersPage = lazy(() => import('@/pages/admin/UsersPage').then((m) => ({ default: m.UsersPage })));
const CategoriesPage = lazy(() => import('@/pages/admin/CategoriesPage').then((m) => ({ default: m.CategoriesPage })));
const AuditLogPage = lazy(() => import('@/pages/admin/AuditLogPage').then((m) => ({ default: m.AuditLogPage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));

function FullPageLoader(): JSX.Element {
  return (
    <div className="container" style={{ padding: 'var(--sp-12) 0' }}>
      <LoadingState label="Loading page…" rows={4} />
    </div>
  );
}

/** Requires a session; remembers where the user was heading. */
function RequireAuth({ children, roles }: { children: JSX.Element; roles?: UserRole[] }): JSX.Element {
  const { user, initialising } = useAuth();
  const location = useLocation();

  if (initialising) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />;
  // Wrong role: send to their own dashboard rather than showing a dead end.
  if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />;
  return children;
}

/** Signed-in users should not see the login/register forms. */
function RedirectIfAuthed({ children }: { children: JSX.Element }): JSX.Element {
  const { user, initialising } = useAuth();
  if (initialising) return <FullPageLoader />;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

/** The dashboard route renders a different page per role. */
function RoleDashboard(): JSX.Element {
  const { user } = useAuth();
  if (!user) return <FullPageLoader />;
  if (user.role === 'ADMIN') return <AdminDashboard />;
  if (user.role === 'WORKER') return <WorkerDashboard />;
  return <CitizenDashboard />;
}

export function App(): JSX.Element {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        {/* ---------- Public ---------- */}
        <Route element={<PublicLayout />}>
          <Route index element={<LandingPage />} />
          <Route path="about" element={<AboutPage />} />
          <Route path="how-it-works" element={<HowItWorksPage />} />
          <Route path="community" element={<CommunityMapPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route path="issues/:id" element={<PublicIssuePage />} />
          <Route path="login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
          <Route path="register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
        </Route>

        {/* ---------- Authenticated ---------- */}
        <Route path="/app" element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route index element={<RoleDashboard />} />
          <Route path="issues/:id" element={<IssueDetailPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="profile" element={<ProfilePage />} />

          {/* Citizen */}
          <Route path="report" element={<RequireAuth roles={['CITIZEN', 'ADMIN']}><ReportIssuePage /></RequireAuth>} />
          <Route path="issues" element={<RequireAuth roles={['CITIZEN']}><MyIssuesPage /></RequireAuth>} />

          {/* Worker */}
          <Route path="assigned" element={<RequireAuth roles={['WORKER']}><AssignedIssuesPage /></RequireAuth>} />
          <Route path="work-history" element={<RequireAuth roles={['WORKER']}><WorkHistoryPage /></RequireAuth>} />

          {/* Admin */}
          <Route path="admin/issues" element={<RequireAuth roles={['ADMIN']}><AdminIssuesPage /></RequireAuth>} />
          <Route path="admin/analytics" element={<RequireAuth roles={['ADMIN']}><AnalyticsPage /></RequireAuth>} />
          <Route path="admin/workers" element={<RequireAuth roles={['ADMIN']}><WorkersPage /></RequireAuth>} />
          <Route path="admin/users" element={<RequireAuth roles={['ADMIN']}><UsersPage /></RequireAuth>} />
          <Route path="admin/categories" element={<RequireAuth roles={['ADMIN']}><CategoriesPage /></RequireAuth>} />
          <Route path="admin/audit" element={<RequireAuth roles={['ADMIN']}><AuditLogPage /></RequireAuth>} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}
