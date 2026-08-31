import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { api, ApiError } from '@/api/client';
import { passwordPolicyError } from '@/utils/password';
import { Alert, Field, fieldAria } from '@/components/ui';
import { ROLE_LABEL, formatDateTime } from '@/utils/format';

export function ProfilePage(): JSX.Element {
  const { user, updateProfile, logout } = useAuth();
  const navigate = useNavigate();

  const [profile, setProfile] = useState({ name: user?.name ?? '', phone: user?.phone ?? '' });
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [profileFeedback, setProfileFeedback] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [passwordErrors, setPasswordErrors] = useState<Record<string, string>>({});
  const [passwordFeedback, setPasswordFeedback] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  const [signingOutAll, setSigningOutAll] = useState(false);

  if (!user) return <></>;

  const saveProfile = async (): Promise<void> => {
    setProfileErrors({});
    setProfileFeedback(null);

    const next: Record<string, string> = {};
    if (profile.name.trim().length < 2) next.name = 'Enter your full name';
    if (profile.phone.trim() && !/^[0-9+][0-9 ()-]{6,19}$/.test(profile.phone.trim())) {
      next.phone = 'Enter a valid phone number, or leave this blank';
    }
    if (Object.keys(next).length > 0) {
      setProfileErrors(next);
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfile({
        name: profile.name.trim(),
        phone: profile.phone.trim() || null,
      });
      setProfileFeedback({ variant: 'success', message: 'Your details have been updated.' });
    } catch (error) {
      if (error instanceof ApiError) {
        setProfileErrors(error.fieldErrors);
        setProfileFeedback({ variant: 'error', message: error.message });
      } else {
        setProfileFeedback({ variant: 'error', message: 'Your details could not be saved.' });
      }
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async (): Promise<void> => {
    setPasswordErrors({});
    setPasswordFeedback(null);

    const next: Record<string, string> = {};
    if (!passwords.current) next.current = 'Enter your current password';
    const policyProblem = passwordPolicyError(passwords.next);
    if (policyProblem) next.next = policyProblem;
    if (passwords.next !== passwords.confirm) next.confirm = 'The passwords do not match';
    if (Object.keys(next).length > 0) {
      setPasswordErrors(next);
      return;
    }

    setSavingPassword(true);
    try {
      await api.post('/auth/change-password', {
        currentPassword: passwords.current,
        newPassword: passwords.next,
      });
      setPasswords({ current: '', next: '', confirm: '' });
      setPasswordFeedback({
        variant: 'success',
        message: 'Password changed. Every other device has been signed out.',
      });
    } catch (error) {
      if (error instanceof ApiError) {
        setPasswordErrors(error.fieldErrors);
        setPasswordFeedback({ variant: 'error', message: error.message });
      } else {
        setPasswordFeedback({ variant: 'error', message: 'The password could not be changed.' });
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const signOutEverywhere = async (): Promise<void> => {
    setSigningOutAll(true);
    try {
      await api.post('/auth/logout-all');
      await logout();
      navigate('/login', { replace: true });
    } catch {
      setSigningOutAll(false);
      setPasswordFeedback({ variant: 'error', message: 'Could not sign out of all devices. Please try again.' });
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <div className="stack-sm">
        <h1>Your profile</h1>
        <p className="muted">Account details, password and session management.</p>
      </div>

      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Account</h2>
        <dl className="stack-sm" style={{ margin: 0 }}>
          {[
            ['Email address', user.email],
            ['Role', ROLE_LABEL[user.role]],
            ['Department', user.departmentName ?? 'Not assigned'],
            ['Member since', formatDateTime(user.createdAt)],
            ['Last sign-in', user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'This is your first session'],
          ].map(([term, value]) => (
            <div key={term} className="row" style={{ gap: 12, alignItems: 'baseline' }}>
              <dt className="small muted" style={{ minWidth: 130 }}>{term}</dt>
              <dd className="small" style={{ margin: 0 }}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="tiny muted">
          Your email address and role can only be changed by an administrator.
        </p>
      </section>

      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Personal details</h2>
        {profileFeedback && (
          <Alert variant={profileFeedback.variant} onDismiss={() => setProfileFeedback(null)}>{profileFeedback.message}</Alert>
        )}
        <Field label="Full name" htmlFor="profile-name" required error={profileErrors.name}>
          <input
            {...fieldAria('profile-name', profileErrors.name)}
            className="input"
            value={profile.name}
            onChange={(event) => setProfile({ ...profile, name: event.target.value })}
            autoComplete="name"
          />
        </Field>
        <Field label="Phone number" htmlFor="profile-phone" error={profileErrors.phone} hint="Optional. Used only so field crews can reach you about site access.">
          <input
            {...fieldAria('profile-phone', profileErrors.phone, 'Optional')}
            className="input"
            type="tel"
            value={profile.phone}
            onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
            autoComplete="tel"
          />
        </Field>
        <button type="button" className="btn btn-primary" onClick={() => void saveProfile()} disabled={savingProfile}>
          {savingProfile ? (<><span className="spinner" aria-hidden="true" /> Saving…</>) : 'Save changes'}
        </button>
      </section>

      <section className="card card-pad stack-sm">
        <h2 style={{ fontSize: 'var(--text-base)' }}>Change password</h2>
        {passwordFeedback && (
          <Alert variant={passwordFeedback.variant} onDismiss={() => setPasswordFeedback(null)}>{passwordFeedback.message}</Alert>
        )}
        <Field label="Current password" htmlFor="pw-current" required error={passwordErrors.current}>
          <input
            {...fieldAria('pw-current', passwordErrors.current)}
            className="input"
            type="password"
            autoComplete="current-password"
            value={passwords.current}
            onChange={(event) => setPasswords({ ...passwords, current: event.target.value })}
          />
        </Field>
        <Field label="New password" htmlFor="pw-next" required error={passwordErrors.next} hint="At least 12 characters, mixed case, a digit and a symbol. Not similar to your email address.">
          <input
            {...fieldAria('pw-next', passwordErrors.next, 'At least 12 characters, mixed case, a digit and a symbol')}
            className="input"
            type="password"
            autoComplete="new-password"
            value={passwords.next}
            onChange={(event) => setPasswords({ ...passwords, next: event.target.value })}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="pw-confirm" required error={passwordErrors.confirm}>
          <input
            {...fieldAria('pw-confirm', passwordErrors.confirm)}
            className="input"
            type="password"
            autoComplete="new-password"
            value={passwords.confirm}
            onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })}
          />
        </Field>
        <button type="button" className="btn btn-primary" onClick={() => void changePassword()} disabled={savingPassword}>
          {savingPassword ? (<><span className="spinner" aria-hidden="true" /> Changing…</>) : 'Change password'}
        </button>
        <p className="tiny muted">
          Changing your password revokes every other active session, so anyone signed in as you elsewhere is logged out.
        </p>
      </section>

      <section className="card card-pad stack-sm" style={{ borderLeft: '4px solid var(--warning-700)' }}>
        <h2 style={{ fontSize: 'var(--text-base)' }}>Sessions</h2>
        <p className="small muted">
          If you signed in on a shared or lost device, end every session immediately. You will need to sign in again
          here afterwards.
        </p>
        <button type="button" className="btn btn-danger" onClick={() => void signOutEverywhere()} disabled={signingOutAll}>
          {signingOutAll ? (<><span className="spinner" aria-hidden="true" /> Signing out…</>) : 'Sign out of all devices'}
        </button>
      </section>
    </div>
  );
}
