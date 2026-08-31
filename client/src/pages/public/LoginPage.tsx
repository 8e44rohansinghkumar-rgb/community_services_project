import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/client';
import { Alert, Field, fieldAria } from '@/components/ui';

export function LoginPage(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Cheap client-side guard; the server validates authoritatively.
    const errors: Record<string, string> = {};
    if (!email.trim()) errors.email = 'Enter your email address';
    if (!password) errors.password = 'Enter your password';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      await login(email.trim(), password);
      navigate(redirectTo, { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        // The API deliberately returns the same message for "unknown email"
        // and "wrong password" so accounts cannot be enumerated.
        setFormError(error.message);
        setFieldErrors(error.fieldErrors);
      } else {
        setFormError('Sign-in failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 460, padding: 'var(--sp-12) var(--sp-4)' }}>
      <div className="card card-pad stack">
        <div className="stack-sm">
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Sign in</h1>
          <p className="muted small">Access your reports, assignments or the administration console.</p>
        </div>

        {formError && <Alert variant="error" title="Could not sign in">{formError}</Alert>}

        <form onSubmit={handleSubmit} noValidate className="stack">
          <Field label="Email address" htmlFor="email" required error={fieldErrors.email}>
            <input
              {...fieldAria('email', fieldErrors.email)}
              className="input"
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />
          </Field>

          <Field label="Password" htmlFor="password" required error={fieldErrors.password}>
            <div style={{ position: 'relative' }}>
              <input
                {...fieldAria('password', fieldErrors.password)}
                className="input"
                type={showPassword ? 'text' : 'password'}
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={{ paddingRight: 76 }}
                required
              />
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowPassword((v) => !v)}
                style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)' }}
                aria-pressed={showPassword}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </Field>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner" aria-hidden="true" /> Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>

        <p className="small" style={{ textAlign: 'center' }}>
          No account yet? <Link to="/register">Create one</Link>
        </p>
      </div>

      {/* Development convenience only. The seeded accounts exist solely in the
          dev database; `npm run db:seed` refuses to run with NODE_ENV=production. */}
      {import.meta.env.DEV && (
        <details className="card card-pad" style={{ marginTop: 'var(--sp-4)' }}>
          <summary className="small strong" style={{ cursor: 'pointer' }}>Demo accounts (development seed only)</summary>
          <div className="stack-sm" style={{ marginTop: 'var(--sp-3)' }}>
            <p className="tiny muted">All demo accounts share the password <code>CivicDemo#2026</code>.</p>
            <ul className="tiny stack-sm" style={{ paddingLeft: '1.1rem' }}>
              <li><code>admin@civicconnect.dev</code> — administrator</li>
              <li><code>worker.roads@civicconnect.dev</code> — field worker</li>
              <li><code>citizen@civicconnect.dev</code> — citizen</li>
            </ul>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setEmail('admin@civicconnect.dev');
                setPassword('CivicDemo#2026');
              }}
            >
              Fill administrator credentials
            </button>
          </div>
        </details>
      )}
    </div>
  );
}
