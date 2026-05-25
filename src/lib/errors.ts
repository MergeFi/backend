export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class WalletError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'WalletError';
  }
}

export class ContractError extends Error {
  constructor(message: string, public readonly txHash?: string) {
    super(message);
    this.name = 'ContractError';
  }
}

export class OracleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OracleError';
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function toUserMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof WalletError) return err.message;
  if (err instanceof ContractError) return `Contract call failed: ${err.message}`;
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred. Please try again.';
}
