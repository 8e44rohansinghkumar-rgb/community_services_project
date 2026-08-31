/** Issue HTTP layer — thin: unwrap validated input, delegate, format. */
import type { Request, Response } from 'express';
import * as issueService from './issue.service';
import * as issueRepo from './issue.repository';
import { getAuthUser } from '../../middleware/auth';
import { validatedQuery } from '../../middleware/validate';
import { sendCreated, sendOk, sendNoContent, sendPaginated } from '../../utils/http';
import { ValidationError } from '../../utils/errors';
import { assertAllowedUpload } from '../storage/image.service';
import { storageService } from '../storage/storage.service';
import type { z } from 'zod';
import type { listIssuesQuerySchema, publicIssuesQuerySchema } from './issue.validators';
import type { IssueFilters } from './issue.repository';

function meta(req: Request) {
  return { ipAddress: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

function uploadedFiles(req: Request): { buffer: Buffer; mimetype: string; originalname: string }[] {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  for (const file of files) assertAllowedUpload(file);
  return files.map((f) => ({ buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname }));
}

type ListQuery = z.infer<typeof listIssuesQuerySchema>;
type PublicQuery = z.infer<typeof publicIssuesQuerySchema>;

function toFilters(query: ListQuery | PublicQuery): IssueFilters {
  const bbox =
    'minLat' in query && query.minLat !== undefined && query.maxLat !== undefined &&
    query.minLng !== undefined && query.maxLng !== undefined
      ? { minLat: query.minLat, maxLat: query.maxLat, minLng: query.minLng, maxLng: query.maxLng }
      : undefined;

  return {
    page: query.page,
    limit: query.limit,
    status: query.status,
    categoryIds: query.categoryId,
    search: query.search,
    sortBy: query.sortBy,
    sortDir: query.sortDir,
    ...('priority' in query ? { priority: query.priority } : {}),
    ...('from' in query ? { from: query.from } : {}),
    ...('to' in query ? { to: query.to } : {}),
    ...('workerId' in query ? { workerId: query.workerId } : {}),
    ...('reporterId' in query ? { reporterId: query.reporterId } : {}),
    ...('onlyOpen' in query ? { onlyOpen: query.onlyOpen } : {}),
    ...(bbox ? { bbox } : {}),
  };
}

export async function create(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const files = uploadedFiles(req);
  const result = await issueService.createIssue(req.body, files, actor, meta(req));
  sendCreated(res, result);
}

export async function list(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const query = validatedQuery<ListQuery>(req);
  const result = await issueService.listForViewer(toFilters(query), actor);
  sendPaginated(res, result.rows, result.pagination);
}

export async function listPublic(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<PublicQuery>(req);
  const result = await issueService.listPublic(toFilters(query));
  sendPaginated(res, result.rows, result.pagination);
}

export async function detail(req: Request, res: Response): Promise<void> {
  const result = await issueService.getDetail(req.params.id!, req.user ?? null);
  sendOk(res, result);
}

export async function update(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const issue = await issueService.updateIssue(req.params.id!, req.body, actor);
  sendOk(res, { issue });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  await issueService.deleteIssue(req.params.id!, actor, meta(req));
  sendNoContent(res);
}

export async function changeStatus(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const issue = await issueService.changeStatus(
    req.params.id!,
    req.body.status,
    req.body.reason ?? null,
    actor,
    meta(req),
  );
  sendOk(res, { issue });
}

export async function history(req: Request, res: Response): Promise<void> {
  const entries = await issueService.getHistory(req.params.id!, req.user ?? null);
  sendOk(res, { history: entries });
}

export async function assign(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const issue = await issueService.assignIssue(
    req.params.id!,
    req.body.workerId,
    req.body.note ?? null,
    actor,
    meta(req),
  );
  sendOk(res, { issue });
}

export async function unassign(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const issue = await issueService.unassignIssue(req.params.id!, req.params.assignmentId!, actor, meta(req));
  sendOk(res, { issue });
}

export async function changePriority(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const issue = await issueService.changePriority(
    req.params.id!,
    req.body.priority,
    req.body.reason ?? null,
    actor,
    meta(req),
  );
  sendOk(res, { issue });
}

export async function markSpam(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const issue = await issueService.markSpam(req.params.id!, req.body.isSpam, actor, meta(req));
  sendOk(res, { issue });
}

export async function listComments(req: Request, res: Response): Promise<void> {
  const comments = await issueService.listComments(req.params.id!, req.user ?? null);
  sendOk(res, { comments });
}

export async function addComment(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const comment = await issueService.addComment(
    req.params.id!,
    req.body.body,
    req.body.isInternal ?? false,
    actor,
  );
  sendCreated(res, { comment });
}

export async function listImages(req: Request, res: Response): Promise<void> {
  const images = await issueService.listImages(req.params.id!, req.user ?? null);
  sendOk(res, { images });
}

export async function uploadImages(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const files = uploadedFiles(req);
  if (files.length === 0) throw new ValidationError('Select at least one image to upload');
  const images = await issueService.addImages(req.params.id!, files, req.body.type ?? 'ADDITIONAL', actor);
  sendCreated(res, { images });
}

/**
 * Streams image bytes after re-checking authorization.
 * Headers are deliberately restrictive so a browser can never treat a stored
 * file as an executable document.
 */
export async function downloadImage(req: Request, res: Response): Promise<void> {
  const { storageKey, mimeType } = await issueService.getImageForDownload(
    req.params.id!,
    req.params.imageId!,
    req.user ?? null,
  );

  const stream = await storageService.getStream(storageKey);
  res.setHeader('Content-Type', mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  stream.on('error', () => {
    if (!res.headersSent) res.status(404).json({ success: false, error: { code: 'IMAGE_NOT_FOUND', message: 'Image not found' } });
  });
  stream.pipe(res);
}

export async function duplicateCheck(req: Request, res: Response): Promise<void> {
  const query = validatedQuery<{
    categoryId: number;
    latitude: number;
    longitude: number;
    excludeIssueId?: string;
  }>(req);
  const candidates = await issueService.getDuplicatesFor(query);
  sendOk(res, { candidates });
}

/** Worker's own assignment history (completed and current). */
export async function myWorkHistory(req: Request, res: Response): Promise<void> {
  const actor = getAuthUser(req);
  const query = validatedQuery<ListQuery>(req);
  const result = await issueRepo.listIssues({
    ...toFilters(query),
    workerId: actor.id,
  });
  sendPaginated(res, result.rows.map((i) => issueService.projectIssue(i, actor)), result.pagination);
}
