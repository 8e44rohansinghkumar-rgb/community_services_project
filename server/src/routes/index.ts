/** Root API router — mounts every feature module under /api. */
import { Router } from 'express';
import { authRouter } from '../modules/auth/auth.routes';
import { userRouter, workerRouter } from '../modules/users/user.routes';
import { issueRouter } from '../modules/issues/issue.routes';
import { categoryRouter } from '../modules/categories/category.routes';
import { notificationRouter } from '../modules/notifications/notification.routes';
import { analyticsRouter } from '../modules/analytics/analytics.routes';
import { auditRouter } from '../modules/audit/audit.routes';
import { departmentRouter } from '../modules/departments/department.routes';
import { healthRouter } from './health.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/workers', workerRouter);
apiRouter.use('/issues', issueRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/departments', departmentRouter);
apiRouter.use('/notifications', notificationRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/audit-logs', auditRouter);
