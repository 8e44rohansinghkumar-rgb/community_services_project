import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/client';
import { Alert, Field, fieldAria } from '@/components/ui';
import { passwordPolicyError, passwordStrength } from '@/utils/password';

export function RegisterPage(): JSX.Element {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Enter your full name (at least 2 characters)';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address';
    if (form.phone.trim() && !/^[0-9+][0-9 ()-]{6,19}$/.test(form.phone.trim())) {
      next.phone = 'Enter a valid phone number, or leave this blank';
    }
    const passwordProblem = passwordPolicyError(form.password);
    if (passwordProblem) next.password = passwordProblem;
    if (form.confirm !== form.password) next.confirm = 'Passwords do not match';
    return next;
  };

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const validation = validate();
    setErrors(validation);
    if (Object.keys(validation).length > 0) {
      document.getElementById(Object.keys(validation)[0]!)?.focus();
      return;
    }

    setSubmitting(true);
    try {
      await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
      });
      navigate('/app', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(error.message);
        setErrors(error.fieldErrors);
      } else {
        setFormError('Registration failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container" style={{ maxWidth: 520, padding: 'var(--sp-12) var(--sp-4)' }}>
      <div className="card card-pad stack">
        <div className="stack-sm">
          <h1 style={{ fontSize: 'var(--text-2xl)' }}>Create your account</h1>
          <p className="muted small">
            Citizen accounts are free. Worker and administrator access is granted by the municipality.
          </p>
        </div>

        {formError && <Alert variant="error" title="Could not create your account">{formError}</Alert>}

        <form onSubmit={handleSubmit} noValidate className="stack">
          <Field label="Full name" htmlFor="name" required error={errors.name}>
            <input
              {...fieldAria('name', errors.name)}
              className="input"
              type="text"
              autoComplete="name"
              value={form.name}
              onChange={set('name')}
              placeholder="Asha Kumari"
              required
            />
          </Field>

          <Field label="Email address" htmlFor="email" required error={errors.email} hint="Used for sign-in and status notifications.">
            <input
              {...fieldAria('email', errors.email, 'Used for sign-in and status notifications.')}
              className="input"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set('email')}
              placeholder="you@example.com"
              required
            />
          </Field>

          <Field label="Phone number" htmlFor="phone" error={errors.phone} hint="Optional. Helps field workers reach you about access to the site.">
            <input
              {...fieldAria('phone', errors.phone, 'Optional. Helps field workers reach you about access to the site.')}
              className="input"
              type="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={set('phone')}
              placeholder="+91 98765 43210"
            />
          </Field>

          <Field label="Password" htmlFor="password" required error={errors.password} hint="At least 12 characters with a mix of upper case, lower case, a digit and a symbol.">
            <div style={{ position: 'relative' }}>
              <input
                {...fieldAria('password', errors.password, 'At least 12 characters with a mix of upper case, lower case, a digit and a symbol.')}
                className="input"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={set('password')}
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
            {form.password && (
              <div className="row" style={{ gap: 8, marginTop: 6 }}>
                <div style={{ flex: 1, height: 5, background: 'var(--ink-100)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                  <div
                    style={{ width: `${(strength.score / 5) * 100}%`, height: '100%', background: strength.tone, transition: 'width 200ms' }}
                  />
                </div>
                <span className="tiny" style={{ color: strength.tone, fontWeight: 600, minWidth: 44 }} aria-live="polite">
                  {strength.label}
                </span>
              </div>
            )}
          </Field>

          <Field label="Confirm password" htmlFor="confirm" required error={errors.confirm}>
            <input
              {...fieldAria('confirm', errors.confirm)}
              className="input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={form.confirm}
              onChange={set('confirm')}
              required
            />
          </Field>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
            {submitting ? (
              <>
                <span className="spinner" aria-hidden="true" /> Creating account…
              </>
            ) : (
              'Create account'
            )}
          </button>

          <p className="tiny muted">
            By creating an account you agree that reports you mark as public may be shown on the community map with a
            generalised location. See our <Link to="/privacy">privacy policy</Link>.
          </p>
        </form>

        <p className="small" style={{ textAlign: 'center' }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
