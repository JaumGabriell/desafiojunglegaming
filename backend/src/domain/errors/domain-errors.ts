/**
 * Base class for all domain errors.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Failure codes for transaction rejections.
 * These are stable, machine-readable codes for providers.
 */
export enum FailureCode {
  // Balance-related
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",
  NEGATIVE_BALANCE_WOULD_RESULT = "NEGATIVE_BALANCE_WOULD_RESULT",

  // Reference-related
  REFERENCE_NOT_FOUND = "REFERENCE_NOT_FOUND",
  REFERENCE_TIMEOUT = "REFERENCE_TIMEOUT",
  INVALID_REFERENCE_KIND = "INVALID_REFERENCE_KIND",
  REFERENCE_ALREADY_REVERSED = "REFERENCE_ALREADY_REVERSED",
  REFERENCE_NOT_PROCESSED = "REFERENCE_NOT_PROCESSED",

  // Validation
  INVALID_AMOUNT = "INVALID_AMOUNT",
  AMOUNT_MISMATCH = "AMOUNT_MISMATCH",
  CURRENCY_MISMATCH = "CURRENCY_MISMATCH",
  INVALID_TRANSACTION_KIND = "INVALID_TRANSACTION_KIND",
  MISSING_REFERENCE = "MISSING_REFERENCE",

  // Context mismatch
  WALLET_NOT_FOUND = "WALLET_NOT_FOUND",
  PLAYER_MISMATCH = "PLAYER_MISMATCH",
  PROVIDER_MISMATCH = "PROVIDER_MISMATCH",
  ROUND_MISMATCH = "ROUND_MISMATCH",

  // Idempotency
  IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT",
  PAYLOAD_HASH_MISMATCH = "PAYLOAD_HASH_MISMATCH",

  // State
  INVALID_STATE_TRANSITION = "INVALID_STATE_TRANSITION",
  TRANSACTION_ALREADY_TERMINAL = "TRANSACTION_ALREADY_TERMINAL",

  // Infrastructure
  DATABASE_ERROR = "DATABASE_ERROR",
  CONCURRENCY_CONFLICT = "CONCURRENCY_CONFLICT",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export class InsufficientBalanceError extends DomainError {
  readonly code = FailureCode.INSUFFICIENT_BALANCE;

  constructor(
    public readonly walletId: string,
    public readonly currentBalance: string,
    public readonly requiredAmount: string,
  ) {
    super(
      `Insufficient balance in wallet ${walletId}: current ${currentBalance}, required ${requiredAmount}`,
    );
  }
}

export class WalletNotFoundError extends DomainError {
  readonly code = FailureCode.WALLET_NOT_FOUND;

  constructor(public readonly walletId: string) {
    super(`Wallet not found: ${walletId}`);
  }
}

export class InvalidTransactionStateError extends DomainError {
  readonly code = FailureCode.INVALID_STATE_TRANSITION;

  constructor(
    public readonly transactionId: string,
    public readonly currentStatus: string,
    public readonly attemptedTransition: string,
  ) {
    super(
      `Invalid state transition for transaction ${transactionId}: cannot transition from ${currentStatus} to ${attemptedTransition}`,
    );
  }
}

export class ReferenceNotFoundError extends DomainError {
  readonly code = FailureCode.REFERENCE_NOT_FOUND;

  constructor(
    public readonly providerId: string,
    public readonly referenceExternalTransactionId: string,
  ) {
    super(
      `Reference transaction not found: provider=${providerId}, externalId=${referenceExternalTransactionId}`,
    );
  }
}

export class ReferenceAlreadyReversedError extends DomainError {
  readonly code = FailureCode.REFERENCE_ALREADY_REVERSED;

  constructor(
    public readonly referenceTransactionId: string,
    public readonly reversalKind: string,
  ) {
    super(
      `Reference transaction ${referenceTransactionId} has already been reversed by a ${reversalKind}`,
    );
  }
}

export class InvalidReferenceKindError extends DomainError {
  readonly code = FailureCode.INVALID_REFERENCE_KIND;

  constructor(
    public readonly transactionKind: string,
    public readonly referenceKind: string,
    public readonly allowedKinds: string[],
  ) {
    super(
      `${transactionKind} cannot reference a ${referenceKind}. Allowed: ${allowedKinds.join(", ")}`,
    );
  }
}

export class AmountMismatchError extends DomainError {
  readonly code = FailureCode.AMOUNT_MISMATCH;

  constructor(
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`Amount mismatch: expected ${expected}, got ${actual}`);
  }
}

export class IdempotencyConflictError extends DomainError {
  readonly code = FailureCode.IDEMPOTENCY_CONFLICT;

  constructor(public readonly idempotencyKey: string) {
    super(
      `Idempotency conflict: same key "${idempotencyKey}" with different payload`,
    );
  }
}

export class MissingReferenceError extends DomainError {
  readonly code = FailureCode.MISSING_REFERENCE;

  constructor(public readonly transactionKind: string) {
    super(`${transactionKind} requires a referenceExternalTransactionId`);
  }
}

export class ContextMismatchError extends DomainError {
  readonly code: FailureCode;

  constructor(
    code: FailureCode,
    public readonly field: string,
    public readonly expected: string,
    public readonly actual: string,
  ) {
    super(`${field} mismatch: expected ${expected}, got ${actual}`);
    this.code = code;
  }
}

export class ConcurrencyConflictError extends DomainError {
  readonly code = FailureCode.CONCURRENCY_CONFLICT;

  constructor(
    public readonly entity: string,
    public readonly id: string,
  ) {
    super(`Concurrency conflict on ${entity} ${id}`);
  }
}

export class NegativeBalanceError extends DomainError {
  readonly code = FailureCode.NEGATIVE_BALANCE_WOULD_RESULT;

  constructor(
    public readonly walletId: string,
    public readonly currentBalance: string,
    public readonly operation: string,
    public readonly amount: string,
  ) {
    super(
      `${operation} of ${amount} on wallet ${walletId} would result in negative balance (current: ${currentBalance})`,
    );
  }
}
