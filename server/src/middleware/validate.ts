/**
 * Zod request validation.
 *
 * Runs before any business logic. The PARSED result replaces req.body/query/params,
 * which is what prevents mass assignment: unknown keys are stripped by the schema,
 * so a client cannot smuggle `role: "ADMIN"` into a profile update.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { ValidationError, type ErrorDetail } from '../utils/errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function toDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || undefined,
    message: issue.message,
  }));
}

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) {
        // Express 5 makes req.query a getter; assign to a shadow property that
        // controllers read via getValidatedQuery().
        const parsedQuery = schemas.query.parse(req.query);
        Object.defineProperty(req, 'validatedQuery', { value: parsedQuery, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('The submitted data is invalid', toDetails(error)));
        return;
      }
      next(error);
    }
  };
}

/** Typed accessor for the validated query object. */
export function validatedQuery<T>(req: Request): T {
  return ((req as unknown as { validatedQuery?: T }).validatedQuery ?? req.query) as T;
}
