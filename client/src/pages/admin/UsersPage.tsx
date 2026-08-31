import { useState } from 'react';
import { useCreateStaff, useDepartments, useSetUserRole, useSetUserStatus, useUsers } from '@/hooks/useAdmin';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/client';
import { Alert, EmptyState, ErrorState, Field, LoadingState, Modal, Pagination, fieldAria } from '@/components/ui';
import { ROLE_LABEL, formatDateTime, relativeTime } from '@/utils/format';
import { passwordPolicyError } from '@/utils/password';
import type { UserRole } from '@/types';

export function UsersPage(): JSX.Element {
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');

  const users = useUsers({
    page,
    ...(roleFilter ? { role: roleFilter } : {}),
    ...(search ? { search } : {}),
  });
  const departments = useDepartments();
  const createStaff = useCreateStaff();
  const setStatus = useSetUserStatus();
  const setRole = useSetUserRole();

  const [createOpen, setCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);
  const [form, setForm] = useState({
    name: '', email: '', password: '', phone: '',
    role: 'WORKER' as 'WORKER' | 'ADMIN', departmentId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submitCreate = async (): Promise<void> => {
    setErrors({});
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Enter the full name';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) next.email = 'Enter a valid email address';
    const passwordProblem = passwordPolicyError(form.password);
    if (passwordProblem) next.password = passwordProblem;
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }

    try {
      await createStaff.mutateAsync({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
        ...(form.departmentId ? { departmentId: form.departmentId } : {}),
      });
      setFeedback({ variant: 'success', message: `${form.name.trim()} can now sign in as a ${ROLE_LABEL[form.role].toLowerCase()}.` });
      setCreateOpen(false);
      setForm({ name: '', email: '', password: '', phone: '', role: 'WORKER', departmentId: '' });
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setFeedback({ variant: 'error', message: error.message });
      } else {
        setFeedback({ variant: 'error', message: 'The account could not be created.' });
      }
    }
  };

  const toggleActive = async (id: string, name: string, isActive: boolean): Promise<void> => {
    try {
      await setStatus.mutateAsync({ id, isActive: !isActive });
      setFeedback({
        variant: 'success',
        message: isActive
          ? `${name} has been deactivated and signed out of all devices.`
          : `${name} has been reactivated.`,
      });
    } catch (error) {
      setFeedback({ variant: 'error', message: error instanceof ApiError ? error.message : 'The change could not be saved.' });
    }
  };

  const changeRole = async (id: string, name: string, role: UserRole): Promise<void> => {
    try {
      await setRole.mutateAsync({ id, role });
      setFeedback({ variant: 'success', message: `${name} is now a ${ROLE_LABEL[role].toLowerCase()}. Their sessions were revoked so the change takes effect immediately.` });
    } catch (error) {
      setFeedback({ variant: 'error', message: error instanceof ApiError ? error.message : 'The role could not be changed.' });
    }
  };

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>Users</h1>
          <p className="muted">Citizens self-register. Worker and administrator accounts are created here.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setCreateOpen(true)}>＋ Add staff account</button>
      </div>

      {feedback && (
        <Alert variant={feedback.variant} onDismiss={() => setFeedback(null)}>{feedback.message}</Alert>
      )}

      <form
        className="card card-pad row"
        style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
        onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); setPage(1); }}
        role="search"
      >
        <div className="field" style={{ flex: '1 1 220px', marginBottom: 0 }}>
          <label className="label" htmlFor="user-search">Search by name or email</label>
          <input id="user-search" className="input" type="search" value={searchDraft} onChange={(e) => setSearchDraft(e.target.value)} />
        </div>
        <div className="field" style={{ flex: '0 1 180px', marginBottom: 0 }}>
          <label className="label" htmlFor="role-filter">Role</label>
          <select
            id="role-filter"
            className="select"
            value={roleFilter}
            onChange={(event) => { setRoleFilter(event.target.value as UserRole | ''); setPage(1); }}
          >
            <option value="">All roles</option>
            <option value="CITIZEN">Citizens</option>
            <option value="WORKER">Field workers</option>
            <option value="ADMIN">Administrators</option>
          </select>
        </div>
        <button type="submit" className="btn btn-secondary">Search</button>
      </form>

      {users.isLoading && <LoadingState label="Loading users…" rows={4} />}
      {users.isError && <ErrorState message={(users.error as Error).message} onRetry={() => void users.refetch()} />}

      {users.data && users.data.data.length === 0 && (
        <EmptyState icon="👤" title="No users match" message="Try a different search term or role filter." />
      )}

      {users.data && users.data.data.length > 0 && (
        <>
          <div className="table-wrap">
            <table className="table">
              <caption className="sr-only">Registered users with role, status and last sign-in</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Email</th>
                  <th scope="col">Role</th>
                  <th scope="col">Department</th>
                  <th scope="col">Status</th>
                  <th scope="col">Last sign-in</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.data.data.map((row) => {
                  const isSelf = row.id === currentUser?.id;
                  return (
                    <tr key={row.id}>
                      <th scope="row">
                        {row.name}
                        {isSelf && <span className="badge badge-navy" style={{ marginLeft: 6, fontSize: 10 }}>You</span>}
                      </th>
                      <td className="small">{row.email}</td>
                      <td>
                        <span className={`badge ${row.role === 'ADMIN' ? 'badge-navy' : row.role === 'WORKER' ? 'badge-info' : 'badge-neutral'}`}>
                          {ROLE_LABEL[row.role]}
                        </span>
                      </td>
                      <td className="small">{row.departmentName ?? '—'}</td>
                      <td>
                        <span className={`badge ${row.isActive ? 'badge-success' : 'badge-danger'}`}>
                          <span aria-hidden="true">{row.isActive ? '✓' : '✕'}</span>
                          {row.isActive ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="small muted" title={row.lastLoginAt ? formatDateTime(row.lastLoginAt) : 'Never signed in'}>
                        {row.lastLoginAt ? relativeTime(row.lastLoginAt) : 'Never'}
                      </td>
                      <td>
                        {isSelf ? (
                          <span className="tiny muted">You cannot change your own account</span>
                        ) : (
                          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className={row.isActive ? 'btn btn-ghost btn-sm' : 'btn btn-secondary btn-sm'}
                              onClick={() => void toggleActive(row.id, row.name, row.isActive)}
                              disabled={setStatus.isPending}
                            >
                              {row.isActive ? 'Deactivate' : 'Reactivate'}
                            </button>
                            <label className="sr-only" htmlFor={`role-${row.id}`}>Change role for {row.name}</label>
                            <select
                              id={`role-${row.id}`}
                              className="select"
                              style={{ width: 'auto', fontSize: 'var(--text-sm)', padding: '4px 26px 4px 8px' }}
                              value={row.role}
                              onChange={(event) => void changeRole(row.id, row.name, event.target.value as UserRole)}
                              disabled={setRole.isPending}
                            >
                              <option value="CITIZEN">Citizen</option>
                              <option value="WORKER">Worker</option>
                              <option value="ADMIN">Admin</option>
                            </select>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pagination
            page={users.data.pagination.page}
            totalPages={users.data.pagination.totalPages}
            total={users.data.pagination.total}
            onPageChange={setPage}
          />
        </>
      )}

      <Modal
        open={createOpen}
        title="Create a staff account"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void submitCreate()} disabled={createStaff.isPending}>
              {createStaff.isPending ? (<><span className="spinner" aria-hidden="true" /> Creating…</>) : 'Create account'}
            </button>
          </>
        }
      >
        <div className="stack-sm">
          <p className="small muted">
            The account is created verified and active. Share the password over a secure channel and ask the person to
            change it after their first sign-in.
          </p>

          <Field label="Full name" htmlFor="staff-name" required error={errors.name}>
            <input {...fieldAria('staff-name', errors.name)} className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>

          <Field label="Email address" htmlFor="staff-email" required error={errors.email}>
            <input {...fieldAria('staff-email', errors.email)} className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>

          <Field label="Temporary password" htmlFor="staff-password" required error={errors.password} hint="At least 12 characters, mixed case, a digit and a symbol. Must not contain the email address.">
            <input
              {...fieldAria('staff-password', errors.password, 'At least 12 characters, mixed case, a digit and a symbol')}
              className="input"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>

          <Field label="Phone number" htmlFor="staff-phone" error={errors.phone}>
            <input {...fieldAria('staff-phone', errors.phone)} className="input" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>

          <Field label="Role" htmlFor="staff-role" required>
            <select {...fieldAria('staff-role')} className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'WORKER' | 'ADMIN' })}>
              <option value="WORKER">Field worker — handles assigned issues</option>
              <option value="ADMIN">Administrator — full triage and management access</option>
            </select>
          </Field>

          <Field label="Department" htmlFor="staff-department" hint="Optional, but helps route work to the right team.">
            <select
              {...fieldAria('staff-department', undefined, 'Optional')}
              className="select"
              value={form.departmentId}
              onChange={(e) => setForm({ ...form, departmentId: e.target.value })}
            >
              <option value="">No department</option>
              {(departments.data ?? []).map((department) => (
                <option key={department.id} value={department.id}>{department.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
