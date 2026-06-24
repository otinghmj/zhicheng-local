export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message, details) {
  return new ApiError(404, 'NOT_FOUND', message, details);
}

export function validationError(details) {
  return new ApiError(400, 'VALIDATION_ERROR', '请求参数不合法', details);
}

export function unprocessable(message, details) {
  return new ApiError(422, 'VALIDATION_ERROR', message, details);
}

export function unauthorized(message = '未登录或令牌已过期', details) {
  return new ApiError(401, 'UNAUTHORIZED', message, details);
}

export function forbidden(message = '无权限', details) {
  return new ApiError(403, 'FORBIDDEN', message, details);
}

export function conflict(message = '文件正在被其他操作修改，请稍后重试', details) {
  return new ApiError(409, 'CONFLICT', message, details);
}

export function errorMiddleware(error, _request, response, _next) {
  const status = error.status ?? 500;
  if (status === 500) console.error('[API Error]', error);
  response.status(status).json({
    error: status === 500 ? '服务器内部错误' : error.message,
    code: error.code ?? 'INTERNAL_ERROR',
    ...(error.details === undefined ? {} : { details: error.details }),
  });
}
