import { validationError } from '../utils/errors.mjs';

export function validateQuery(schema) {
  return (request, _response, next) => {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      next(validationError(result.error.flatten()));
      return;
    }
    request.validatedQuery = result.data;
    next();
  };
}

export function validateBody(schema) {
  return (request, _response, next) => {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      next(validationError(result.error.flatten()));
      return;
    }
    request.validatedBody = result.data;
    next();
  };
}
