/**
 * Small, stable catalog of machine-readable error codes. Deliberately kept
 * generic (not one code per resource/exception) so the frontend has a
 * short, finite list to switch on immediately. `HttpExceptionFilter`
 * auto-assigns one of these based on HTTP status when a thrown exception
 * doesn't specify its own `code`. Extend this enum before adding a new
 * generic category — don't invent per-resource codes here (see
 * `docs/ai/backend/ERROR-HANDLING.md` for the more granular catalog some
 * call sites may adopt over time via an explicit `code` in the exception
 * body).
 */
export enum ErrorCode {
  AUTH_REQUIRED = 'AUTH_REQUIRED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INTERNAL = 'INTERNAL',
}

/**
 * Default `code` per HTTP status, used when a thrown exception doesn't
 * carry an explicit `code` in its response body. Statuses not listed here
 * are left without a `code` (optional per
 * `docs/ai/backend/ERROR-HANDLING.md` — don't block the rollout on having
 * one for every status).
 */
export const DEFAULT_ERROR_CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.AUTH_REQUIRED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  422: ErrorCode.VALIDATION_ERROR,
  500: ErrorCode.INTERNAL,
};
