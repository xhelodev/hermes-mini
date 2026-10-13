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
  if (error instanceof HermesError) {
    switch (error.code) {
      case 'unauthorized':
        return 'La clave fue rechazada.';
      case 'timeout':
        return 'El servidor no respondió a tiempo.';
      case 'down':
        return 'No se pudo conectar con el servidor.';
      case 'rate_limit':
        return 'Hay demasiadas tareas en curso. Probá de nuevo en un momento.';
      case 'not_found':
        return 'No se encontró esa conversación.';
      case 'aborted':
        return 'La solicitud se canceló.';
      default:
        return error.message || 'El servidor rechazó la solicitud.';
    }
  }
  return 'No se pudo conectar con el servidor.';
}
