/**
 * Issue routes.
 *
 * Route-level guards are the coarse filter; the service re-checks object-level
 * access on every handler, so a URL alone never grants access to a row.
 */
import { Router } from 'express';
import * as controller from './issue.controller';
import * as schemas from './issue.validators';
import { validate } from '../../middleware/validate';
import { requireAuth, requireRole, optionalAuth } from '../../middleware/auth';
import { uploadIssueImages } from '../../middleware/upload';
import { asyncHandler } from '../../utils/http';
import {
  authenticatedLimiter,
  createIssueLimiter,
  uploadLimiter,
  commentLimiter,
  publicLimiter,
} from '../../middleware/rateLimit';

export const issueRouter = Router();

/* ---------------- Public (anonymous) endpoints ---------------- */

// Community map/list. Returns anonymised, coarse-location projections only.
issueRouter.get(
  '/public',
  publicLimiter,
  validate({ query: schemas.publicIssuesQuerySchema }),
  asyncHandler(controller.listPublic),
);

/* ---------------- Authenticated endpoints ---------------- */

issueRouter.get(
  '/duplicate-check',
  requireAuth,
  authenticatedLimiter,
  validate({ query: schemas.duplicateCheckSchema }),
  asyncHandler(controller.duplicateCheck),
);

issueRouter.get(
  '/my-work',
  requireAuth,
  requireRole('WORKER', 'ADMIN'),
  authenticatedLimiter,
  validate({ query: schemas.listIssuesQuerySchema }),
  asyncHandler(controller.myWorkHistory),
);

issueRouter.get(
  '/',
  requireAuth,
  authenticatedLimiter,
  validate({ query: schemas.listIssuesQuerySchema }),
  asyncHandler(controller.list),
);

// Citizens report issues. Multipart: multer runs BEFORE validation so that
// req.body text fields exist by the time Zod inspects them.
issueRouter.post(
  '/',
  requireAuth,
  requireRole('CITIZEN', 'ADMIN'),
  createIssueLimiter,
  uploadIssueImages,
  validate({ body: schemas.createIssueSchema }),
  asyncHandler(controller.create),
);

// optionalAuth: a signed-out visitor may open a PUBLIC issue; the service
// decides what they are allowed to see.
issueRouter.get(
  '/:id',
  optionalAuth,
  publicLimiter,
  validate({ params: schemas.idParamsSchema }),
  asyncHandler(controller.detail),
);

issueRouter.patch(
  '/:id',
  requireAuth,
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema, body: schemas.updateIssueSchema }),
  asyncHandler(controller.update),
);

// Soft delete, admin only — auditability is preserved.
issueRouter.delete(
  '/:id',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema }),
  asyncHandler(controller.remove),
);

/* ---------------- Lifecycle ---------------- */

issueRouter.post(
  '/:id/status',
  requireAuth,
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema, body: schemas.changeStatusSchema }),
  asyncHandler(controller.changeStatus),
);

issueRouter.get(
  '/:id/history',
  optionalAuth,
  publicLimiter,
  validate({ params: schemas.idParamsSchema }),
  asyncHandler(controller.history),
);

/* ---------------- Assignment (admin only) ---------------- */

issueRouter.post(
  '/:id/assign',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema, body: schemas.assignSchema }),
  asyncHandler(controller.assign),
);

issueRouter.delete(
  '/:id/assignments/:assignmentId',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ params: schemas.assignmentParamsSchema }),
  asyncHandler(controller.unassign),
);

issueRouter.patch(
  '/:id/priority',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema, body: schemas.changePrioritySchema }),
  asyncHandler(controller.changePriority),
);

issueRouter.patch(
  '/:id/spam',
  requireAuth,
  requireRole('ADMIN'),
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema, body: schemas.markSpamSchema }),
  asyncHandler(controller.markSpam),
);

/* ---------------- Comments ---------------- */

issueRouter.get(
  '/:id/comments',
  requireAuth,
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema }),
  asyncHandler(controller.listComments),
);

issueRouter.post(
  '/:id/comments',
  requireAuth,
  commentLimiter,
  validate({ params: schemas.idParamsSchema, body: schemas.createCommentSchema }),
  asyncHandler(controller.addComment),
);

/* ---------------- Images ---------------- */

issueRouter.get(
  '/:id/images',
  requireAuth,
  authenticatedLimiter,
  validate({ params: schemas.idParamsSchema }),
  asyncHandler(controller.listImages),
);

issueRouter.post(
  '/:id/images',
  requireAuth,
  uploadLimiter,
  uploadIssueImages,
  validate({ params: schemas.idParamsSchema, body: schemas.uploadImagesSchema }),
  asyncHandler(controller.uploadImages),
);

// Files are streamed through this authorising route, never served statically.
issueRouter.get(
  '/:id/images/:imageId',
  optionalAuth,
  publicLimiter,
  validate({ params: schemas.imageParamsSchema }),
  asyncHandler(controller.downloadImage),
);
