/** Application error carrying the contract's { error: { code, message } } shape. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string, id?: string): AppError =>
  new AppError(404, 'NOT_FOUND', id ? `${what} ${id} not found` : `${what} not found`);

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError(400, 'BAD_REQUEST', message, details);

export const conflict = (code: string, message: string): AppError => new AppError(409, code, message);

export const unprocessable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(422, code, message, details);
