import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  useAddComment,
  useAssignIssue,
  useChangePriority,
  useChangeStatus,
  useIssue,
  useMarkSpam,
  useUploadImages,
  useWorkers,
} from '@/hooks/useIssues';
import { useAuth } from '@/contexts/AuthContext';
import { ApiError } from '@/api/client';
import {
  Alert,
  ErrorState,
  Field,
  LoadingState,
  Modal,
  PriorityBadge,
  StatusBadge,
  fieldAria,
} from '@/components/ui';
import { IssueTimeline } from '@/components/IssueTimeline';
import { PRIORITY_META, STATUS_META, ROLE_LABEL, formatBytes, formatCoords, formatDateTime, mapLink, relativeTime } from '@/utils/format';
import type { IssueStatus, Severity } from '@/types';

/** Statuses whose transition the API requires a written reason for. */
const REASON_REQUIRED: IssueStatus[] = ['REJECTED', 'ON_HOLD', 'REOPENED'];

/** Statuses that need at least one RESOLUTION image before the API will accept. */
const EVIDENCE_REQUIRED: IssueStatus[] = ['RESOLVED'];

const MAX_FILES = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function IssueDetailPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const justCreated = (location.state as { justCreated?: boolean } | null)?.justCreated ?? false;

  const query = useIssue(id);
  const workers = useWorkers();

  const changeStatus = useChangeStatus(id ?? '');
  const assignIssue = useAssignIssue(id ?? '');
  const changePriority = useChangePriority(id ?? '');
  const markSpam = useMarkSpam(id ?? '');
  const addComment = useAddComment(id ?? '');
  const uploadImages = useUploadImages(id ?? '');

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // Modal state
  const [statusTarget, setStatusTarget] = useState<IssueStatus | null>(null);
  const [statusReason, setStatusReason] = useState('');
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignWorkerId, setAssignWorkerId] = useState('');
  const [assignNote, setAssignNote] = useState('');
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityValue, setPriorityValue] = useState<Severity>('MEDIUM');
  const [priorityReason, setPriorityReason] = useState('');

  // Comment + upload state
  const [commentBody, setCommentBody] = useState('');
  const [commentInternal, setCommentInternal] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadType, setUploadType] = useState<'RESOLUTION' | 'ADDITIONAL'>('RESOLUTION');
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) setPriorityValue(query.data.issue.officialPriority);
  }, [query.data]);

  // Auto-dismiss transient success messages.
  useEffect(() => {
    if (!actionSuccess) return undefined;
    const timer = setTimeout(() => setActionSuccess(null), 6000);
    return () => clearTimeout(timer);
  }, [actionSuccess]);

  if (query.isLoading) return <LoadingState label="Loading issue…" rows={5} />;

  if (query.isError) {
    const notFound = query.error instanceof ApiError && query.error.status === 404;
    return (
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <ErrorState
          title={notFound ? 'Issue not found' : 'Could not load this issue'}
          message={
            notFound
              ? 'This issue does not exist, or you do not have permission to view it.'
              : (query.error as Error).message
          }
          onRetry={notFound ? undefined : () => void query.refetch()}
        />
        <div className="row" style={{ justifyContent: 'center', marginTop: 'var(--sp-4)' }}>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>Go back</button>
        </div>
      </div>
    );
  }

  const detail = query.data!;
  const { issue, images, comments, history, assignments, allowedTransitions, access } = detail;

  const isAdmin = access === 'ADMIN';
  const isAssignedWorker = access === 'ASSIGNED_WORKER';
  const isOwner = access === 'OWNER';
  const isStaff = isAdmin || isAssignedWorker;

  const reportImages = images.filter((image) => image.type !== 'RESOLUTION');
  const resolutionImages = images.filter((image) => image.type === 'RESOLUTION');
  const hasResolutionEvidence = resolutionImages.length > 0;

  /* ------------------------------ Handlers ------------------------------ */

  const runAction = async (fn: () => Promise<unknown>, successMessage: string): Promise<boolean> => {
    setActionError(null);
    setActionSuccess(null);
    try {
      await fn();
      setActionSuccess(successMessage);
      return true;
    } catch (error) {
      setActionError(error instanceof ApiError ? error.message : 'The action could not be completed. Please try again.');
      return false;
    }
  };

  const submitStatusChange = async (): Promise<void> => {
    if (!statusTarget) return;
    if (REASON_REQUIRED.includes(statusTarget) && statusReason.trim().length === 0) {
      setActionError('A written reason is required for this change.');
      return;
    }
    const ok = await runAction(
      () => changeStatus.mutateAsync({ status: statusTarget, ...(statusReason.trim() ? { reason: statusReason.trim() } : {}) }),
      `Status changed to ${STATUS_META[statusTarget].label}.`,
    );
    if (ok) {
      setStatusTarget(null);
      setStatusReason('');
    }
  };

  const submitAssignment = async (): Promise<void> => {
    if (!assignWorkerId) {
      setActionError('Choose a worker to assign.');
      return;
    }
    const ok = await runAction(
      () => assignIssue.mutateAsync({ workerId: assignWorkerId, ...(assignNote.trim() ? { note: assignNote.trim() } : {}) }),
      'Issue assigned. The worker has been notified.',
    );
    if (ok) {
      setAssignOpen(false);
      setAssignWorkerId('');
      setAssignNote('');
    }
  };

  const submitPriority = async (): Promise<void> => {
    const ok = await runAction(
      () => changePriority.mutateAsync({ priority: priorityValue, ...(priorityReason.trim() ? { reason: priorityReason.trim() } : {}) }),
      `Priority set to ${PRIORITY_META[priorityValue].label}.`,
    );
    if (ok) {
      setPriorityOpen(false);
      setPriorityReason('');
    }
  };

  const submitComment = async (): Promise<void> => {
    if (commentBody.trim().length === 0) return;
    const ok = await runAction(
      () => addComment.mutateAsync({ body: commentBody.trim(), isInternal: commentInternal }),
      commentInternal ? 'Internal note added.' : 'Comment posted.',
    );
    if (ok) {
      setCommentBody('');
      setCommentInternal(false);
    }
  };

  const pickFiles = (list: FileList | null): void => {
    if (!list) return;
    const accepted: File[] = [];
    const problems: string[] = [];
    for (const file of Array.from(list)) {
      if (uploadFiles.length + accepted.length >= MAX_FILES) { problems.push(`At most ${MAX_FILES} images.`); break; }
      if (!ACCEPTED_TYPES.includes(file.type)) { problems.push(`"${file.name}" is not a JPEG, PNG or WebP image.`); continue; }
      if (file.size > MAX_FILE_BYTES) { problems.push(`"${file.name}" exceeds the 5 MB limit.`); continue; }
      accepted.push(file);
    }
    if (accepted.length > 0) setUploadFiles((prev) => [...prev, ...accepted]);
    setUploadError(problems.length > 0 ? problems.join(' ') : null);
  };

  const submitUpload = async (): Promise<void> => {
    if (uploadFiles.length === 0) {
      setUploadError('Select at least one photo.');
      return;
    }
    const ok = await runAction(
      () => uploadImages.mutateAsync({ files: uploadFiles, type: uploadType }),
      `${uploadFiles.length} photo${uploadFiles.length === 1 ? '' : 's'} uploaded.`,
    );
    if (ok) {
      setUploadFiles([]);
      setUploadError(null);
    }
  };

  const busy =
    changeStatus.isPending || assignIssue.isPending || changePriority.isPending ||
    markSpam.isPending || addComment.isPending || uploadImages.isPending;

  /* -------------------------------- View -------------------------------- */

  return (
    <div className="stack" style={{ maxWidth: 1100 }}>
      <nav aria-label="Breadcrumb">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(-1)}>← Back</button>
      </nav>

      {justCreated && (
        <Alert variant="success" title="Report submitted">
          Your report has the reference <strong>{issue.publicId}</strong>. You will be notified as it progresses.
        </Alert>
      )}
      {actionSuccess && <Alert variant="success" onDismiss={() => setActionSuccess(null)}>{actionSuccess}</Alert>}
      {actionError && <Alert variant="error" title="Action failed" onDismiss={() => setActionError(null)}>{actionError}</Alert>}

      {/* -------- Header -------- */}
      <header className="card card-pad stack-sm">
        <div className="row-between" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div className="stack-sm" style={{ minWidth: 0, flex: '1 1 400px' }}>
            <p className="small muted">
              <span className="strong">{issue.publicId}</span> · reported{' '}
              <time dateTime={issue.createdAt} title={formatDateTime(issue.createdAt)}>{relativeTime(issue.createdAt)}</time>
              {isStaff && issue.reporterName && <> · by {issue.reporterName}</>}
            </p>
            <h1 style={{ fontSize: 'var(--text-2xl)' }}>{issue.title}</h1>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <StatusBadge status={issue.status} />
              <PriorityBadge priority={issue.officialPriority} />
              {issue.categoryName && <span className="badge badge-neutral">{issue.categoryName}</span>}
              {!issue.isPublic && <span className="badge badge-neutral" title="Not shown on the community map">🔒 Private</span>}
              {issue.isSpam && <span className="badge badge-danger">Marked as spam</span>}
              {issue.duplicateCount > 0 && (
                <span className="badge badge-info" title="Similar reports nearby in the same period">
                  {issue.duplicateCount} similar {issue.duplicateCount === 1 ? 'report' : 'reports'}
                </span>
              )}
            </div>
          </div>

          <div className="stack-sm" style={{ minWidth: 200 }}>
            <p className="tiny muted">Current status</p>
            <p className="small">{STATUS_META[issue.status].description}</p>
            {issue.assignedWorkerName && (
              <p className="small">
                <span className="muted">Assigned to:</span> <span className="strong">{issue.assignedWorkerName}</span>
              </p>
            )}
            {issue.resolvedAt && (
              <p className="small"><span className="muted">Resolved:</span> {formatDateTime(issue.resolvedAt)}</p>
            )}
            {issue.closedAt && (
              <p className="small"><span className="muted">Closed:</span> {formatDateTime(issue.closedAt)}</p>
            )}
          </div>
        </div>
      </header>

      {/* -------- Actions -------- */}
      {user && (allowedTransitions.length > 0 || isAdmin) && (
        <section className="card card-pad stack-sm" style={{ borderLeft: '4px solid var(--navy-700)' }}>
          <h2 style={{ fontSize: 'var(--text-base)' }}>Actions available to you</h2>
          <p className="small muted">
            You are viewing this as {access === 'OWNER' ? 'the reporter' : access === 'ADMIN' ? 'an administrator' : access === 'ASSIGNED_WORKER' ? 'the assigned worker' : 'a member of the public'}.
          </p>

          {/* Evidence gate — explain BEFORE the user hits a 409. */}
          {allowedTransitions.includes('RESOLVED') && !hasResolutionEvidence && (
            <Alert variant="warning">
              Before you can mark this resolved you must upload at least one photograph showing the completed work. Use
              the upload form below.
            </Alert>
          )}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {allowedTransitions.map((status) => {
              const blocked = EVIDENCE_REQUIRED.includes(status) && !hasResolutionEvidence;
              const tone =
                status === 'RESOLVED' || status === 'CLOSED' ? 'btn-success'
                : status === 'REJECTED' || status === 'REOPENED' ? 'btn-danger'
                : 'btn-secondary';
              return (
                <button
                  key={status}
                  type="button"
                  className={`btn ${tone}`}
                  disabled={busy || blocked}
                  title={blocked ? 'Upload resolution evidence first' : STATUS_META[status].description}
                  onClick={() => {
                    setStatusTarget(status);
                    setStatusReason('');
                    setActionError(null);
                  }}
                >
                  <span aria-hidden="true">{STATUS_META[status].icon}</span>
                  Mark as {STATUS_META[status].label.toLowerCase()}
                </button>
              );
            })}

            {isAdmin && (
              <>
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setAssignOpen(true); setActionError(null); }}>
                  {issue.assignedWorkerName ? 'Reassign worker' : 'Assign a worker'}
                </button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => { setPriorityOpen(true); setActionError(null); }}>
                  Change priority
                </button>
                <button
                  type="button"
                  className={issue.isSpam ? 'btn btn-secondary' : 'btn btn-ghost'}
                  disabled={busy}
                  onClick={() => void runAction(() => markSpam.mutateAsync(!issue.isSpam), issue.isSpam ? 'Unmarked as spam.' : 'Marked as spam.')}
                >
                  {issue.isSpam ? 'Remove spam flag' : 'Flag as spam'}
                </button>
              </>
            )}
          </div>

          {allowedTransitions.length === 0 && !isAdmin && (
            <p className="small muted">
              There is nothing for you to do at this stage. You will be notified when the status changes.
            </p>
          )}
        </section>
      )}

      <div className="grid-2" style={{ gap: 'var(--sp-6)', alignItems: 'start' }}>
        {/* ---------------- Left column ---------------- */}
        <div className="stack">
          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Description</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{issue.description}</p>
            <p className="tiny muted">
              Urgency as reported by the citizen: {PRIORITY_META[issue.citizenSeverity].label}. Official priority is set
              by the municipality.
            </p>
          </section>

          {/* Photos */}
          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Photographs</h2>

            {images.length === 0 && <p className="small muted">No photographs were attached to this report.</p>}

            {reportImages.length > 0 && (
              <>
                <h3 className="small strong">As reported ({reportImages.length})</h3>
                <ul className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
                  {reportImages.map((image) => (
                    <li key={image.id}>
                      <a href={`/api/issues/${issue.id}/images/${image.id}`} target="_blank" rel="noopener noreferrer">
                        <img
                          src={`/api/issues/${issue.id}/images/${image.id}`}
                          alt={`Photograph of the reported problem: ${issue.title}`}
                          loading="lazy"
                          style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius)', border: '1px solid var(--ink-200)' }}
                        />
                      </a>
                      <p className="tiny muted">{formatBytes(image.sizeBytes)}{image.uploaderName && isStaff ? ` · ${image.uploaderName}` : ''}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {resolutionImages.length > 0 && (
              <>
                <h3 className="small strong" style={{ color: 'var(--success-700)' }}>
                  After the repair ({resolutionImages.length})
                </h3>
                <ul className="grid-3" style={{ listStyle: 'none', padding: 0 }}>
                  {resolutionImages.map((image) => (
                    <li key={image.id}>
                      <a href={`/api/issues/${issue.id}/images/${image.id}`} target="_blank" rel="noopener noreferrer">
                        <img
                          src={`/api/issues/${issue.id}/images/${image.id}`}
                          alt={`Photograph showing the completed repair for: ${issue.title}`}
                          loading="lazy"
                          style={{ width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 'var(--radius)', border: '2px solid var(--success-500)' }}
                        />
                      </a>
                      <p className="tiny muted">{formatDateTime(image.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* Upload — the assigned worker and admins can add evidence. */}
            {(isAssignedWorker || isAdmin) && (
              <div className="stack-sm" style={{ paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--ink-100)' }}>
                <h3 className="small strong">Upload photographs</h3>
                <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <label className="checkbox-row">
                    <input type="radio" name="upload-type" checked={uploadType === 'RESOLUTION'} onChange={() => setUploadType('RESOLUTION')} />
                    <span className="small">Evidence of completed work</span>
                  </label>
                  <label className="checkbox-row">
                    <input type="radio" name="upload-type" checked={uploadType === 'ADDITIONAL'} onChange={() => setUploadType('ADDITIONAL')} />
                    <span className="small">Additional context</span>
                  </label>
                </div>
                <Field label="Choose images" htmlFor="issue-upload" error={uploadError ?? undefined} hint="JPEG, PNG or WebP. Max 5 MB each, 5 files.">
                  <input
                    {...fieldAria('issue-upload', uploadError ?? undefined, 'JPEG, PNG or WebP')}
                    className="input"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(event) => { pickFiles(event.target.files); event.target.value = ''; }}
                  />
                </Field>
                {uploadFiles.length > 0 && (
                  <ul className="stack-sm small" style={{ listStyle: 'none', padding: 0 }}>
                    {uploadFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`} className="row-between">
                        <span className="truncate">{file.name} · {formatBytes(file.size)}</span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setUploadFiles((prev) => prev.filter((_, i) => i !== index))}
                          aria-label={`Remove ${file.name}`}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="btn btn-primary" onClick={() => void submitUpload()} disabled={uploadImages.isPending || uploadFiles.length === 0}>
                  {uploadImages.isPending ? (<><span className="spinner" aria-hidden="true" /> Uploading…</>) : `Upload ${uploadFiles.length || ''} photo${uploadFiles.length === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </section>

          {/* Comments */}
          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>
              Comments {comments.length > 0 && <span className="muted">({comments.length})</span>}
            </h2>

            {comments.length === 0 && <p className="small muted">No comments yet.</p>}

            <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
              {comments.map((comment) => (
                <li
                  key={comment.id}
                  className="stack-sm"
                  style={{
                    padding: 12,
                    borderRadius: 'var(--radius)',
                    background: comment.isInternal ? 'var(--warning-50)' : 'var(--ink-50)',
                    border: comment.isInternal ? '1px solid var(--warning-500)' : '1px solid var(--ink-100)',
                    gap: 4,
                  }}
                >
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <span className="small strong">{comment.authorName}</span>
                    <span className="badge badge-neutral" style={{ fontSize: 10 }}>{ROLE_LABEL[comment.authorRole]}</span>
                    {comment.isInternal && (
                      <span className="badge badge-warning" style={{ fontSize: 10 }}>Internal — not visible to the reporter</span>
                    )}
                    <time className="tiny muted" dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)}>
                      {relativeTime(comment.createdAt)}
                    </time>
                  </div>
                  <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{comment.body}</p>
                </li>
              ))}
            </ul>

            {user && (
              <div className="stack-sm" style={{ paddingTop: 'var(--sp-3)', borderTop: '1px solid var(--ink-100)' }}>
                <Field label="Add a comment" htmlFor="comment-body">
                  <textarea
                    {...fieldAria('comment-body')}
                    className="textarea"
                    rows={3}
                    maxLength={2000}
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    placeholder={isStaff ? 'Update the reporter, or leave an internal note for colleagues…' : 'Add extra detail for the crew…'}
                  />
                  <span className="tiny muted" style={{ alignSelf: 'flex-end' }}>{commentBody.length}/2000</span>
                </Field>
                {isStaff && (
                  <label className="checkbox-row">
                    <input type="checkbox" checked={commentInternal} onChange={(event) => setCommentInternal(event.target.checked)} />
                    <span className="small">Internal note — visible only to staff, never to the reporter</span>
                  </label>
                )}
                <button type="button" className="btn btn-primary" onClick={() => void submitComment()} disabled={addComment.isPending || commentBody.trim().length === 0}>
                  {addComment.isPending ? (<><span className="spinner" aria-hidden="true" /> Posting…</>) : 'Post comment'}
                </button>
              </div>
            )}
          </section>
        </div>

        {/* ---------------- Right column ---------------- */}
        <div className="stack">
          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Location</h2>
            {issue.landmark && <p className="small"><span className="muted">Landmark:</span> {issue.landmark}</p>}
            {issue.address && <p className="small"><span className="muted">Area:</span> {issue.address}</p>}
            <p className="small">
              <span className="muted">Coordinates:</span> {formatCoords(issue.latitude, issue.longitude)}
            </p>
            <a href={mapLink(issue.latitude, issue.longitude)} target="_blank" rel="noopener noreferrer" className="small">
              Open in OpenStreetMap<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </section>

          <section className="card card-pad stack-sm">
            <h2 style={{ fontSize: 'var(--text-base)' }}>Status history</h2>
            <IssueTimeline entries={history} />
          </section>

          {/* Assignment roster — administrative data, admin only. */}
          {isAdmin && assignments.length > 0 && (
            <section className="card card-pad stack-sm">
              <h2 style={{ fontSize: 'var(--text-base)' }}>Assignment history</h2>
              <ul className="stack-sm" style={{ listStyle: 'none', padding: 0 }}>
                {assignments.map((assignment) => (
                  <li key={assignment.id} className="stack-sm" style={{ gap: 2, paddingBottom: 8, borderBottom: '1px solid var(--ink-100)' }}>
                    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                      <span className="small strong">{assignment.workerName}</span>
                      {assignment.active
                        ? <span className="badge badge-success">Active</span>
                        : <span className="badge badge-neutral">Ended</span>}
                    </div>
                    <p className="tiny muted">
                      Assigned {formatDateTime(assignment.assignedAt)}
                      {assignment.assignedByName && ` by ${assignment.assignedByName}`}
                      {assignment.completedAt && ` · completed ${formatDateTime(assignment.completedAt)}`}
                    </p>
                    {assignment.note && <p className="tiny" style={{ fontStyle: 'italic' }}>“{assignment.note}”</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {isOwner && issue.status === 'RESOLVED' && (
            <section className="card card-pad stack-sm" style={{ borderLeft: '4px solid var(--success-700)' }}>
              <h2 style={{ fontSize: 'var(--text-base)' }}>Is it actually fixed?</h2>
              <p className="small muted">
                Compare the “after” photographs with what you can see. If the problem is genuinely resolved, close the
                report. If it is not, reopen it and say what is still wrong — it goes straight back into the queue.
              </p>
            </section>
          )}

          {!user && (
            <section className="card card-pad stack-sm">
              <p className="small muted">Sign in to comment on this report or to track your own.</p>
              <Link to="/login" className="btn btn-primary btn-sm">Sign in</Link>
            </section>
          )}
        </div>
      </div>

      {/* ---------------- Modals ---------------- */}

      <Modal
        open={statusTarget !== null}
        title={statusTarget ? `Mark as ${STATUS_META[statusTarget].label.toLowerCase()}` : ''}
        onClose={() => { setStatusTarget(null); setStatusReason(''); }}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => { setStatusTarget(null); setStatusReason(''); }}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void submitStatusChange()} disabled={changeStatus.isPending}>
              {changeStatus.isPending ? (<><span className="spinner" aria-hidden="true" /> Saving…</>) : 'Confirm'}
            </button>
          </>
        }
      >
        {statusTarget && (
          <div className="stack-sm">
            <p className="small">
              This will move <strong>{issue.publicId}</strong> from {STATUS_META[issue.status].label} to{' '}
              {STATUS_META[statusTarget].label}. The change is recorded in the timeline with your name and the time.
            </p>
            <Field
              label={REASON_REQUIRED.includes(statusTarget) ? 'Reason' : 'Note (optional)'}
              htmlFor="status-reason"
              required={REASON_REQUIRED.includes(statusTarget)}
              hint={
                statusTarget === 'REOPENED' ? 'Explain what is still wrong so the crew knows what to look for.'
                : statusTarget === 'REJECTED' ? 'The reporter will see this, so be specific and courteous.'
                : statusTarget === 'ON_HOLD' ? 'What is blocking the work? Parts, weather, access, permissions?'
                : 'Anything useful for the record.'
              }
            >
              <textarea
                {...fieldAria('status-reason', undefined, 'reason')}
                className="textarea"
                rows={4}
                maxLength={1000}
                value={statusReason}
                onChange={(event) => setStatusReason(event.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={assignOpen}
        title={issue.assignedWorkerName ? 'Reassign this issue' : 'Assign this issue'}
        onClose={() => setAssignOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setAssignOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void submitAssignment()} disabled={assignIssue.isPending || !assignWorkerId}>
              {assignIssue.isPending ? (<><span className="spinner" aria-hidden="true" /> Assigning…</>) : 'Assign'}
            </button>
          </>
        }
      >
        <div className="stack-sm">
          {workers.isLoading && <p className="small muted">Loading the worker directory…</p>}
          {workers.isError && <Alert variant="error">The worker directory could not be loaded.</Alert>}
          {workers.data && workers.data.length === 0 && (
            <Alert variant="warning">
              There are no active workers to assign. Add one from the <Link to="/app/admin/users">Users</Link> page first.
            </Alert>
          )}
          {workers.data && workers.data.length > 0 && (
            <>
              <Field label="Worker" htmlFor="assign-worker" required hint="Ordered by current workload — least busy first.">
                <select
                  {...fieldAria('assign-worker', undefined, 'Ordered by current workload')}
                  className="select"
                  value={assignWorkerId}
                  onChange={(event) => setAssignWorkerId(event.target.value)}
                >
                  <option value="">Choose a worker…</option>
                  {workers.data.map((worker) => (
                    <option key={worker.id} value={worker.id} disabled={!worker.isActive}>
                      {worker.name}
                      {worker.departmentName ? ` — ${worker.departmentName}` : ''}
                      {` (${worker.activeAssignments} active)`}
                      {worker.isActive ? '' : ' — inactive'}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Note for the worker" htmlFor="assign-note" hint="Optional. Access instructions, equipment needed, urgency context.">
                <textarea
                  {...fieldAria('assign-note', undefined, 'Optional')}
                  className="textarea"
                  rows={3}
                  maxLength={1000}
                  value={assignNote}
                  onChange={(event) => setAssignNote(event.target.value)}
                />
              </Field>
              <p className="tiny muted">
                Assigning creates the assignment, moves the issue to Assigned, records the history entry, notifies the
                worker and writes an audit entry — all in one database transaction.
              </p>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={priorityOpen}
        title="Change official priority"
        onClose={() => setPriorityOpen(false)}
        footer={
          <>
            <button type="button" className="btn btn-secondary" onClick={() => setPriorityOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={() => void submitPriority()} disabled={changePriority.isPending}>
              {changePriority.isPending ? (<><span className="spinner" aria-hidden="true" /> Saving…</>) : 'Update priority'}
            </button>
          </>
        }
      >
        <div className="stack-sm">
          <p className="small muted">
            The system suggested {PRIORITY_META[issue.officialPriority].label} from the category, the citizen's own
            urgency rating and the number of nearby reports. An override is recorded in the audit log.
          </p>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">Priority</legend>
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as Severity[]).map((severity) => (
              <label key={severity} className="radio-card" data-selected={priorityValue === severity}>
                <input type="radio" name="priority" checked={priorityValue === severity} onChange={() => setPriorityValue(severity)} />
                <span>
                  <span className="strong">{PRIORITY_META[severity].label}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <Field label="Reason" htmlFor="priority-reason" hint="Recommended when overriding the calculated priority.">
            <textarea
              {...fieldAria('priority-reason', undefined, 'Recommended')}
              className="textarea"
              rows={3}
              maxLength={1000}
              value={priorityReason}
              onChange={(event) => setPriorityReason(event.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
