import { useState } from 'react';
import { useCategories } from '@/hooks/useIssues';
import { useCreateCategory, useDepartments, useUpdateCategory } from '@/hooks/useAdmin';
import { ApiError } from '@/api/client';
import { Alert, EmptyState, ErrorState, Field, LoadingState, Modal, PriorityBadge, fieldAria } from '@/components/ui';
import type { Category, Severity } from '@/types';

/** URL-safe slug derived from the display name; the admin can still override it. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const BLANK = {
  name: '',
  slug: '',
  description: '',
  icon: '',
  defaultSeverity: 'MEDIUM' as Severity,
  slaHours: 72,
  departmentId: '',
};

export function CategoriesPage(): JSX.Element {
  // includeInactive requires an admin session, which this page always has.
  const categories = useCategories({ withCounts: true, includeInactive: true });
  const departments = useDepartments();
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [slugTouched, setSlugTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<{ variant: 'success' | 'error'; message: string } | null>(null);

  const openCreate = (): void => {
    setEditing(null);
    setForm({ ...BLANK });
    setSlugTouched(false);
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (category: Category): void => {
    setEditing(category);
    setForm({
      name: category.name,
      slug: category.slug,
      description: category.description ?? '',
      icon: category.icon ?? '',
      defaultSeverity: category.defaultSeverity,
      slaHours: category.slaHours,
      departmentId: category.departmentId ?? '',
    });
    setSlugTouched(true);
    setErrors({});
    setModalOpen(true);
  };

  const submit = async (): Promise<void> => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Enter a category name';
    if (!editing && !/^[a-z0-9-]{2,60}$/.test(form.slug || slugify(form.name))) {
      next.slug = 'The slug may contain only lowercase letters, numbers and hyphens';
    }
    if (form.slaHours < 1 || form.slaHours > 8760) next.slaHours = 'Target response must be between 1 and 8760 hours';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    try {
      if (editing) {
        await updateCategory.mutateAsync({
          id: editing.id,
          changes: {
            name: form.name.trim(),
            description: form.description.trim() || undefined,
            icon: form.icon.trim() || undefined,
            defaultSeverity: form.defaultSeverity,
            slaHours: form.slaHours,
            departmentId: form.departmentId || null,
          },
        });
        setFeedback({ variant: 'success', message: `“${form.name.trim()}” updated.` });
      } else {
        await createCategory.mutateAsync({
          name: form.name.trim(),
          slug: form.slug || slugify(form.name),
          ...(form.description.trim() ? { description: form.description.trim() } : {}),
          ...(form.icon.trim() ? { icon: form.icon.trim() } : {}),
          defaultSeverity: form.defaultSeverity,
          slaHours: form.slaHours,
          ...(form.departmentId ? { departmentId: form.departmentId } : {}),
        });
        setFeedback({ variant: 'success', message: `“${form.name.trim()}” is now available on the report form.` });
      }
      setModalOpen(false);
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setFeedback({ variant: 'error', message: error.message });
      } else {
        setFeedback({ variant: 'error', message: 'The category could not be saved.' });
      }
    }
  };

  const toggleActive = async (category: Category): Promise<void> => {
    try {
      await updateCategory.mutateAsync({ id: category.id, changes: { isActive: !category.isActive } });
      setFeedback({
        variant: 'success',
        message: category.isActive
          ? `“${category.name}” is hidden from the report form. Existing issues keep their category.`
          : `“${category.name}” is available again.`,
      });
    } catch (error) {
      setFeedback({ variant: 'error', message: error instanceof ApiError ? error.message : 'The change could not be saved.' });
    }
  };

  const busy = createCategory.isPending || updateCategory.isPending;

  return (
    <div className="stack">
      <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div className="stack-sm">
          <h1>Issue categories</h1>
          <p className="muted">What citizens can choose from, the department each routes to, and its target response.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={openCreate}>＋ Add category</button>
      </div>

      {feedback && <Alert variant={feedback.variant} onDismiss={() => setFeedback(null)}>{feedback.message}</Alert>}

      {categories.isLoading && <LoadingState label="Loading categories…" rows={4} />}
      {categories.isError && <ErrorState message={(categories.error as Error).message} onRetry={() => void categories.refetch()} />}

      {categories.data && categories.data.length === 0 && (
        <EmptyState
          icon="🏷"
          title="No categories yet"
          message="Citizens cannot report anything until at least one category exists."
          action={<button type="button" className="btn btn-primary" onClick={openCreate}>Add the first category</button>}
        />
      )}

      {categories.data && categories.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <caption className="sr-only">Issue categories with default priority, target response time and usage</caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th scope="col">Slug</th>
                <th scope="col">Default priority</th>
                <th scope="col">Target response</th>
                <th scope="col">Reports</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {categories.data.map((category) => (
                <tr key={category.id} style={category.isActive ? undefined : { opacity: 0.65 }}>
                  <th scope="row">
                    <span aria-hidden="true">{category.icon} </span>
                    {category.name}
                    {category.description && (
                      <span className="tiny muted" style={{ display: 'block', fontWeight: 400 }}>{category.description}</span>
                    )}
                  </th>
                  <td><code className="tiny">{category.slug}</code></td>
                  <td><PriorityBadge priority={category.defaultSeverity} /></td>
                  <td className="small">
                    {category.slaHours >= 24 ? `${Math.round(category.slaHours / 24)} days` : `${category.slaHours} h`}
                  </td>
                  <td>{category.issueCount ?? '—'}</td>
                  <td>
                    <span className={`badge ${category.isActive ? 'badge-success' : 'badge-neutral'}`}>
                      <span aria-hidden="true">{category.isActive ? '✓' : '✕'}</span>
                      {category.isActive ? 'Active' : 'Hidden'}
                    </span>
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => openEdit(category)}>Edit</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleActive(category)} disabled={busy}>
                        {category.isActive ? 'Hide' : 'Restore'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="small muted">
        Hiding a category removes it from the report form but leaves existing issues untouched — categories are never
        deleted, because issues reference them.
      </p>

      <Modal
        open={modalOpen}
        title={editing ? `Edit “${editing.name}”` : 'Add a category'}
        onClose={() => setModalOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>
              {busy ? (<><span className="spinner" aria-hidden="true" /> Saving…</>) : editing ? 'Save changes' : 'Create category'}
            </button>
          </>
        }
      >
        <div className="stack-sm">
          <Field label="Name" htmlFor="cat-name" required error={errors.name}>
            <input
              {...fieldAria('cat-name', errors.name)}
              className="input"
              value={form.name}
              onChange={(event) => {
                const name = event.target.value;
                setForm((prev) => ({ ...prev, name, slug: slugTouched ? prev.slug : slugify(name) }));
              }}
            />
          </Field>

          {!editing && (
            <Field label="Slug" htmlFor="cat-slug" required error={errors.slug} hint="Used in URLs and filters. Lowercase letters, numbers and hyphens.">
              <input
                {...fieldAria('cat-slug', errors.slug, 'Used in URLs')}
                className="input"
                value={form.slug}
                onChange={(event) => { setSlugTouched(true); setForm({ ...form, slug: event.target.value }); }}
              />
            </Field>
          )}

          <Field label="Description" htmlFor="cat-desc" error={errors.description} hint="Shown to citizens under the category name.">
            <textarea
              {...fieldAria('cat-desc', errors.description, 'Shown to citizens')}
              className="textarea"
              rows={2}
              maxLength={500}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          </Field>

          <Field label="Icon" htmlFor="cat-icon" hint="A single emoji works well, for example 🕳 or 💡.">
            <input
              {...fieldAria('cat-icon', undefined, 'A single emoji')}
              className="input"
              maxLength={40}
              value={form.icon}
              onChange={(event) => setForm({ ...form, icon: event.target.value })}
            />
          </Field>

          <Field label="Default priority" htmlFor="cat-severity" required hint="The starting point before the priority engine adjusts it.">
            <select
              {...fieldAria('cat-severity', undefined, 'Starting point')}
              className="select"
              value={form.defaultSeverity}
              onChange={(event) => setForm({ ...form, defaultSeverity: event.target.value as Severity })}
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </Field>

          <Field label="Target response (hours)" htmlFor="cat-sla" required error={errors.slaHours} hint="Between 1 and 8760 hours (one year).">
            <input
              {...fieldAria('cat-sla', errors.slaHours, 'Between 1 and 8760 hours')}
              className="input"
              type="number"
              min={1}
              max={8760}
              value={form.slaHours}
              onChange={(event) => setForm({ ...form, slaHours: Number(event.target.value) })}
            />
          </Field>

          <Field label="Department" htmlFor="cat-dept" hint="Reports in this category are routed here.">
            <select
              {...fieldAria('cat-dept', undefined, 'Reports routed here')}
              className="select"
              value={form.departmentId}
              onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
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
