import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCategories, useCreateIssue, useDuplicateCheck } from '@/hooks/useIssues';
import { ApiError } from '@/api/client';
import { Alert, Field, fieldAria, PriorityBadge, StatusBadge } from '@/components/ui';
import { formatBytes, relativeTime } from '@/utils/format';
import type { Severity } from '@/types';

/** Mirrors the server's upload policy so the user hears about a bad file immediately. */
const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const SEVERITY_OPTIONS: { value: Severity; label: string; help: string }[] = [
  { value: 'LOW', label: 'Low', help: 'Cosmetic or minor inconvenience. No safety risk.' },
  { value: 'MEDIUM', label: 'Medium', help: 'Affects daily use. Should be fixed soon.' },
  { value: 'HIGH', label: 'High', help: 'Significant disruption or a developing hazard.' },
  { value: 'CRITICAL', label: 'Critical', help: 'Immediate danger to people or property.' },
];

const STEPS = ['Category', 'Details', 'Photos', 'Location', 'Review'] as const;

interface FormState {
  categoryId: number | null;
  title: string;
  description: string;
  citizenSeverity: Severity;
  latitude: number | null;
  longitude: number | null;
  address: string;
  landmark: string;
  isPublic: boolean;
}

export function ReportIssuePage(): JSX.Element {
  const navigate = useNavigate();
  const categories = useCategories();
  const createIssue = useCreateIssue();

  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    categoryId: null,
    title: '',
    description: '',
    citizenSeverity: 'MEDIUM',
    latitude: null,
    longitude: null,
    address: '',
    landmark: '',
    isPublic: true,
  });
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [geoStatus, setGeoStatus] = useState<'idle' | 'locating' | 'denied' | 'unavailable' | 'ok'>('idle');
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const selectedCategory = useMemo(
    () => categories.data?.find((category) => category.id === form.categoryId) ?? null,
    [categories.data, form.categoryId],
  );

  // Live duplicate check once a category and a location exist.
  const duplicates = useDuplicateCheck({
    ...(form.categoryId !== null ? { categoryId: form.categoryId } : {}),
    ...(form.latitude !== null ? { latitude: form.latitude } : {}),
    ...(form.longitude !== null ? { longitude: form.longitude } : {}),
    enabled: step >= 3 && form.categoryId !== null && form.latitude !== null,
  });

  // Object URLs must be revoked or the tab leaks memory on every re-pick.
  useEffect(() => {
    const urls = files.map((file) => URL.createObjectURL(file));
    setPreviews(urls);
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);

  // Move focus to the step heading so keyboard/screen-reader users follow along.
  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  /* ------------------------------ Validation ------------------------------ */

  const validateStep = (index: number): Record<string, string> => {
    const next: Record<string, string> = {};
    if (index === 0 && form.categoryId === null) next.categoryId = 'Choose the category that best fits the problem';
    if (index === 1) {
      if (form.title.trim().length < 5) next.title = 'Give the report a title of at least 5 characters';
      if (form.title.trim().length > 150) next.title = 'Keep the title under 150 characters';
      if (form.description.trim().length < 10) next.description = 'Describe the problem in at least 10 characters';
      if (form.description.trim().length > 5000) next.description = 'Keep the description under 5000 characters';
    }
    if (index === 3) {
      if (form.latitude === null || form.longitude === null) next.location = 'Set the location of the problem';
      else if (form.latitude < -90 || form.latitude > 90) next.location = 'Latitude must be between -90 and 90';
      else if (form.longitude < -180 || form.longitude > 180) next.location = 'Longitude must be between -180 and 180';
    }
    return next;
  };

  const goNext = (): void => {
    const validation = validateStep(step);
    setErrors(validation);
    if (Object.keys(validation).length > 0) return;
    setStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const goBack = (): void => {
    setErrors({});
    setStep((prev) => Math.max(prev - 1, 0));
  };

  /* -------------------------------- Files -------------------------------- */

  const addFiles = (incoming: FileList | null): void => {
    if (!incoming) return;
    const accepted: File[] = [];
    const problems: string[] = [];

    for (const file of Array.from(incoming)) {
      if (files.length + accepted.length >= MAX_FILES) {
        problems.push(`You can attach at most ${MAX_FILES} photos.`);
        break;
      }
      if (!ACCEPTED_TYPES.includes(file.type)) {
        problems.push(`"${file.name}" is not a JPEG, PNG or WebP image.`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        problems.push(`"${file.name}" is ${formatBytes(file.size)} — the limit is 5 MB.`);
        continue;
      }
      accepted.push(file);
    }

    if (accepted.length > 0) setFiles((prev) => [...prev, ...accepted]);
    setErrors((prev) => ({ ...prev, files: problems.join(' ') }));
    if (problems.length === 0) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next.files;
        return next;
      });
    }
  };

  const removeFile = (index: number): void => setFiles((prev) => prev.filter((_, i) => i !== index));

  /* ------------------------------ Geolocation ----------------------------- */

  const useMyLocation = (): void => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('unavailable');
      return;
    }
    setGeoStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        update('latitude', Number(position.coords.latitude.toFixed(6)));
        update('longitude', Number(position.coords.longitude.toFixed(6)));
        setGeoStatus('ok');
        setErrors((prev) => {
          const next = { ...prev };
          delete next.location;
          return next;
        });
      },
      (error) => setGeoStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  };

  /* -------------------------------- Submit -------------------------------- */

  const handleSubmit = async (): Promise<void> => {
    setSubmitError(null);
    // Re-validate every step: nobody should reach review with a hole in the form.
    const allErrors = [0, 1, 3].reduce<Record<string, string>>(
      (acc, index) => ({ ...acc, ...validateStep(index) }),
      {},
    );
    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors);
      setStep(allErrors.categoryId ? 0 : allErrors.title || allErrors.description ? 1 : 3);
      return;
    }

    try {
      const result = await createIssue.mutateAsync({
        title: form.title.trim(),
        description: form.description.trim(),
        categoryId: form.categoryId!,
        citizenSeverity: form.citizenSeverity,
        latitude: form.latitude!,
        longitude: form.longitude!,
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        ...(form.landmark.trim() ? { landmark: form.landmark.trim() } : {}),
        isPublic: form.isPublic,
        files,
      });
      navigate(`/app/issues/${result.issue.id}`, { state: { justCreated: true } });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === 'DUPLICATE_SUBMISSION') {
          setSubmitError('You have already submitted an identical report in the last few minutes. Check your issues list before trying again.');
        } else {
          setSubmitError(error.message);
          const fieldErrors = error.fieldErrors;
          if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
        }
      } else {
        setSubmitError('Your report could not be submitted. Please try again.');
      }
    }
  };

  /* --------------------------------- View --------------------------------- */

  return (
    <div style={{ maxWidth: 760, margin: '0 auto' }}>
      <div className="stack">
        <div className="stack-sm">
          <h1>Report an issue</h1>
          <p className="muted">
            Five short steps. Everything except the photos and the landmark is required.
          </p>
        </div>

        {/* Progress */}
        <nav aria-label="Progress">
          <ol className="row" style={{ listStyle: 'none', padding: 0, gap: 4, flexWrap: 'wrap' }}>
            {STEPS.map((label, index) => {
              const state = index < step ? 'done' : index === step ? 'current' : 'todo';
              return (
                <li key={label} style={{ flex: '1 1 90px', minWidth: 90 }}>
                  <button
                    type="button"
                    // Only completed steps are navigable backwards.
                    onClick={() => index < step && setStep(index)}
                    disabled={index > step}
                    aria-current={state === 'current' ? 'step' : undefined}
                    className="stack-sm"
                    style={{
                      width: '100%', textAlign: 'left', background: 'none',
                      border: 0, padding: 0, gap: 6,
                      cursor: index < step ? 'pointer' : 'default',
                    }}
                  >
                    <span
                      style={{
                        display: 'block', height: 4, borderRadius: 'var(--radius-full)',
                        background: state === 'todo' ? 'var(--ink-200)' : state === 'current' ? 'var(--navy-700)' : 'var(--success-700)',
                      }}
                    />
                    <span className="tiny" style={{ fontWeight: state === 'current' ? 700 : 500, color: state === 'todo' ? 'var(--ink-500)' : 'var(--ink-800)' }}>
                      {state === 'done' && <span aria-hidden="true">✓ </span>}
                      {index + 1}. {label}
                      {state === 'current' && <span className="sr-only"> (current step)</span>}
                      {state === 'done' && <span className="sr-only"> (completed)</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {submitError && <Alert variant="error" title="Report not submitted" onDismiss={() => setSubmitError(null)}>{submitError}</Alert>}

        <div className="card card-pad stack">
          <h2 ref={headingRef} tabIndex={-1} style={{ fontSize: 'var(--text-lg)', outline: 'none' }}>
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </h2>

          {/* -------- Step 0: Category -------- */}
          {step === 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack-sm">
              <legend className="label">
                What kind of problem is it?<span className="req" aria-hidden="true">*</span>
              </legend>
              {errors.categoryId && <span className="field-error" role="alert"><span aria-hidden="true">⚠</span> {errors.categoryId}</span>}

              {categories.isLoading && <p className="small muted">Loading categories…</p>}
              {categories.isError && (
                <Alert variant="error">
                  Categories could not be loaded.{' '}
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void categories.refetch()}>Retry</button>
                </Alert>
              )}

              <div className="grid-2">
                {(categories.data ?? []).map((category) => (
                  <label
                    key={category.id}
                    className="radio-card"
                    data-selected={form.categoryId === category.id}
                  >
                    <input
                      type="radio"
                      name="category"
                      value={category.id}
                      checked={form.categoryId === category.id}
                      onChange={() => {
                        update('categoryId', category.id);
                        update('citizenSeverity', category.defaultSeverity);
                      }}
                    />
                    <span>
                      <span className="row" style={{ gap: 8 }}>
                        <span aria-hidden="true" style={{ fontSize: 20 }}>{category.icon ?? '📍'}</span>
                        <span className="strong">{category.name}</span>
                      </span>
                      {category.description && <span className="tiny muted" style={{ display: 'block', marginTop: 4 }}>{category.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* -------- Step 1: Details -------- */}
          {step === 1 && (
            <div className="stack">
              <Field
                label="Title"
                htmlFor="title"
                required
                error={errors.title}
                hint="A short summary, e.g. “Deep pothole outside the primary school gate”."
              >
                <input
                  {...fieldAria('title', errors.title, 'A short summary')}
                  className="input"
                  type="text"
                  maxLength={150}
                  value={form.title}
                  onChange={(event) => update('title', event.target.value)}
                />
                <span className="tiny muted" style={{ alignSelf: 'flex-end' }}>{form.title.length}/150</span>
              </Field>

              <Field
                label="Description"
                htmlFor="description"
                required
                error={errors.description}
                hint="What is wrong, how long it has been there, and who it affects."
              >
                <textarea
                  {...fieldAria('description', errors.description, 'What is wrong')}
                  className="textarea"
                  rows={6}
                  maxLength={5000}
                  value={form.description}
                  onChange={(event) => update('description', event.target.value)}
                />
                <span className="tiny muted" style={{ alignSelf: 'flex-end' }}>{form.description.length}/5000</span>
              </Field>

              <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack-sm">
                <legend className="label">How urgent does it feel to you?</legend>
                <p className="hint">
                  Your assessment is recorded as-is. The final priority is set by the municipality using the category,
                  how many people have reported it and how long it has been open.
                </p>
                <div className="grid-2">
                  {SEVERITY_OPTIONS.map((option) => (
                    <label key={option.value} className="radio-card" data-selected={form.citizenSeverity === option.value}>
                      <input
                        type="radio"
                        name="severity"
                        value={option.value}
                        checked={form.citizenSeverity === option.value}
                        onChange={() => update('citizenSeverity', option.value)}
                      />
                      <span>
                        <span className="strong">{option.label}</span>
                        <span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>{option.help}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          )}

          {/* -------- Step 2: Photos -------- */}
          {step === 2 && (
            <div className="stack">
              <Field
                label="Photographs"
                htmlFor="images"
                error={errors.files}
                hint={`Optional but very helpful. Up to ${MAX_FILES} images, JPEG, PNG or WebP, max 5 MB each.`}
              >
                <input
                  {...fieldAria('images', errors.files, `Up to ${MAX_FILES} images`)}
                  className="input"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  disabled={files.length >= MAX_FILES}
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </Field>

              {files.length > 0 && (
                <>
                  <p className="small muted" aria-live="polite">
                    {files.length} of {MAX_FILES} photos attached
                  </p>
                  <ul className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
                    {files.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="card" style={{ overflow: 'hidden' }}>
                        <img
                          src={previews[index]}
                          alt={`Preview of ${file.name}`}
                          style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', display: 'block' }}
                        />
                        <div className="row-between" style={{ padding: 8, gap: 8 }}>
                          <span className="tiny muted truncate" title={file.name}>
                            {file.name} · {formatBytes(file.size)}
                          </span>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => removeFile(index)}
                            aria-label={`Remove ${file.name}`}
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {files.length === 0 && (
                <div className="alert alert-info" role="note">
                  <span className="alert-icon" aria-hidden="true">ℹ</span>
                  <div>
                    You can submit without a photo, but reports with pictures are verified faster because the crew can
                    see what they are dealing with before they arrive.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* -------- Step 3: Location -------- */}
          {step === 3 && (
            <div className="stack">
              <div className="stack-sm">
                <p className="label" id="location-label">
                  Where is it?<span className="req" aria-hidden="true">*</span>
                </p>
                {errors.location && <span className="field-error" role="alert"><span aria-hidden="true">⚠</span> {errors.location}</span>}

                <button type="button" className="btn btn-primary" onClick={useMyLocation} disabled={geoStatus === 'locating'}>
                  {geoStatus === 'locating' ? (<><span className="spinner" aria-hidden="true" /> Finding you…</>) : '📍 Use my current location'}
                </button>

                <div aria-live="polite">
                  {geoStatus === 'ok' && form.latitude !== null && (
                    <p className="small" style={{ color: 'var(--success-700)' }}>
                      ✓ Location captured: {form.latitude.toFixed(5)}, {form.longitude!.toFixed(5)}
                    </p>
                  )}
                  {geoStatus === 'denied' && (
                    <Alert variant="warning">
                      Location permission was declined. Enter the coordinates manually below, or allow location access in
                      your browser settings and try again.
                    </Alert>
                  )}
                  {geoStatus === 'unavailable' && (
                    <Alert variant="warning">
                      Your device could not provide a location. Please enter the coordinates manually.
                    </Alert>
                  )}
                </div>
              </div>

              <div className="grid-2">
                <Field label="Latitude" htmlFor="latitude" required hint="Between -90 and 90">
                  <input
                    {...fieldAria('latitude', undefined, 'Between -90 and 90')}
                    className="input"
                    type="number"
                    step="0.000001"
                    min={-90}
                    max={90}
                    inputMode="decimal"
                    value={form.latitude ?? ''}
                    onChange={(event) => update('latitude', event.target.value === '' ? null : Number(event.target.value))}
                  />
                </Field>
                <Field label="Longitude" htmlFor="longitude" required hint="Between -180 and 180">
                  <input
                    {...fieldAria('longitude', undefined, 'Between -180 and 180')}
                    className="input"
                    type="number"
                    step="0.000001"
                    min={-180}
                    max={180}
                    inputMode="decimal"
                    value={form.longitude ?? ''}
                    onChange={(event) => update('longitude', event.target.value === '' ? null : Number(event.target.value))}
                  />
                </Field>
              </div>

              <Field label="Landmark" htmlFor="landmark" hint="Something a driver would recognise: “opposite the bus stand”.">
                <input
                  {...fieldAria('landmark', undefined, 'Something a driver would recognise')}
                  className="input"
                  type="text"
                  maxLength={150}
                  value={form.landmark}
                  onChange={(event) => update('landmark', event.target.value)}
                />
              </Field>

              <Field label="Street or area" htmlFor="address" hint="Optional. Helps route the report to the right ward.">
                <input
                  {...fieldAria('address', undefined, 'Optional')}
                  className="input"
                  type="text"
                  maxLength={300}
                  value={form.address}
                  onChange={(event) => update('address', event.target.value)}
                />
              </Field>

              {/* Duplicate warning — a genuine server-side proximity query. */}
              {duplicates.data && duplicates.data.length > 0 && (
                <div className="alert alert-warning" role="alert">
                  <span className="alert-icon" aria-hidden="true">⚠</span>
                  <div className="stack-sm" style={{ flex: 1 }}>
                    <strong>
                      {duplicates.data.length} similar {duplicates.data.length === 1 ? 'report has' : 'reports have'} already
                      been filed nearby
                    </strong>
                    <ul className="stack-sm small" style={{ listStyle: 'none', padding: 0 }}>
                      {duplicates.data.slice(0, 3).map((candidate) => (
                        <li key={candidate.id} className="card card-pad" style={{ padding: 10 }}>
                          <div className="row-between" style={{ gap: 8, flexWrap: 'wrap' }}>
                            <span className="strong clamp-2">{candidate.title}</span>
                            <StatusBadge status={candidate.status} />
                          </div>
                          <p className="tiny muted">
                            {Math.round(candidate.distanceMeters)} m away · reported {relativeTime(candidate.createdAt)}
                            {' · '}
                            <Link to={`/app/issues/${candidate.id}`}>View it</Link>
                          </p>
                        </li>
                      ))}
                    </ul>
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={duplicateAcknowledged}
                        onChange={(event) => setDuplicateAcknowledged(event.target.checked)}
                      />
                      <span className="small">
                        This is a different problem, or the existing report has not been fixed — submit mine as well.
                      </span>
                    </label>
                    <p className="tiny muted">
                      Reporting the same problem again is not wasted: additional reports raise its priority.
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* -------- Step 4: Review -------- */}
          {step === 4 && (
            <div className="stack">
              <dl className="stack-sm" style={{ margin: 0 }}>
                {[
                  ['Category', selectedCategory ? `${selectedCategory.icon ?? ''} ${selectedCategory.name}`.trim() : '—'],
                  ['Title', form.title],
                  ['Your urgency', SEVERITY_OPTIONS.find((o) => o.value === form.citizenSeverity)?.label ?? '—'],
                  ['Photos', files.length === 0 ? 'None attached' : `${files.length} attached`],
                  ['Location', form.latitude !== null ? `${form.latitude.toFixed(5)}, ${form.longitude!.toFixed(5)}` : '—'],
                  ['Landmark', form.landmark || '—'],
                  ['Street or area', form.address || '—'],
                ].map(([term, value]) => (
                  <div key={term} className="row" style={{ gap: 12, alignItems: 'flex-start', paddingBottom: 8, borderBottom: '1px solid var(--ink-100)' }}>
                    <dt className="small muted" style={{ minWidth: 130, flexShrink: 0 }}>{term}</dt>
                    <dd className="small" style={{ margin: 0, minWidth: 0, wordBreak: 'break-word' }}>{value}</dd>
                  </div>
                ))}
              </dl>

              <div>
                <p className="small muted" style={{ marginBottom: 4 }}>Description</p>
                <p className="small" style={{ whiteSpace: 'pre-wrap', padding: 12, background: 'var(--ink-50)', borderRadius: 'var(--radius)' }}>
                  {form.description}
                </p>
              </div>

              <fieldset style={{ border: 0, padding: 0, margin: 0 }} className="stack-sm">
                <legend className="label">Visibility</legend>
                <label className="radio-card" data-selected={form.isPublic}>
                  <input type="radio" name="visibility" checked={form.isPublic} onChange={() => update('isPublic', true)} />
                  <span>
                    <span className="strong">Public</span>
                    <span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>
                      Shown on the community map with an approximate location. Your name and contact details are never
                      published.
                    </span>
                  </span>
                </label>
                <label className="radio-card" data-selected={!form.isPublic}>
                  <input type="radio" name="visibility" checked={!form.isPublic} onChange={() => update('isPublic', false)} />
                  <span>
                    <span className="strong">Private</span>
                    <span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>
                      Visible only to you, the assigned worker and municipal administrators.
                    </span>
                  </span>
                </label>
              </fieldset>

              {duplicates.data && duplicates.data.length > 0 && !duplicateAcknowledged && (
                <Alert variant="warning" title="Similar reports nearby">
                  Go back to the location step and confirm you still want to submit this as a separate report.
                </Alert>
              )}
            </div>
          )}

          {/* -------- Navigation -------- */}
          <div className="row-between" style={{ gap: 12, paddingTop: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <div>
              {step > 0 && (
                <button type="button" className="btn btn-secondary" onClick={goBack} disabled={createIssue.isPending}>
                  ← Back
                </button>
              )}
            </div>
            <div className="row" style={{ gap: 8 }}>
              {step < STEPS.length - 1 ? (
                <button type="button" className="btn btn-primary" onClick={goNext}>Continue →</button>
              ) : (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => void handleSubmit()}
                  disabled={createIssue.isPending || (Boolean(duplicates.data?.length) && !duplicateAcknowledged)}
                >
                  {createIssue.isPending ? (<><span className="spinner" aria-hidden="true" /> Submitting…</>) : 'Submit report'}
                </button>
              )}
            </div>
          </div>
        </div>

        {selectedCategory && step > 0 && (
          <div className="card card-pad row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div className="row" style={{ gap: 8 }}>
              <span aria-hidden="true">{selectedCategory.icon}</span>
              <span className="small strong">{selectedCategory.name}</span>
              <PriorityBadge priority={selectedCategory.defaultSeverity} />
            </div>
            <span className="tiny muted">
              Target response:{' '}
              {selectedCategory.slaHours >= 24
                ? `${Math.round(selectedCategory.slaHours / 24)} days`
                : `${selectedCategory.slaHours} hours`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
