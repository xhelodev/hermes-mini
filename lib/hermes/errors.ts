import { strings } from '@/lib/i18n';

export type HermesErrorCode =
  | 'unauthorized'
  | 'timeout'
  | 'down'
  | 'rate_limit'
  | 'not_found'
  | 'conflict'
  | 'unavailable'
  | 'bad_response'
  | 'aborted';

export class HermesError extends Error {
  readonly code: HermesErrorCode;
  readonly status: number | null;

  constructor(code: HermesErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = 'HermesError';
    this.code = code;
    this.status = status;
  }
}

export function describeHermesError(error: unknown): string {
  const text = strings().errors;
  if (error instanceof HermesError) {
    switch (error.code) {
      case 'unauthorized':
        return text.unauthorized;
      case 'timeout':
        return text.timeout;
      case 'down':
        return text.down;
      case 'rate_limit':
        return text.rateLimit;
      case 'not_found':
        return text.notFound;
      case 'aborted':
        return text.aborted;
      default:
        return error.message || text.rejected;
    }
  }
  return text.down;
}
