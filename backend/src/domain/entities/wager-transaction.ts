import { Money } from "../value-objects/money";
import {
  InvalidTransactionStateError,
  MissingReferenceError,
  FailureCode,
} from "../errors/domain-errors";
import { LedgerDirection } from "./wallet-ledger-entry";

export enum WagerTransactionKind {
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatus {
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}

export interface WagerTransactionState {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
  createdAt: Date;
  status: WagerTransactionStatus;
  referenceTransactionId?: string;
  failureCode?: FailureCode;
  processedAt?: Date;
  retryCount: number;
  lastRetryAt?: Date;
}

export interface CreateWagerTransactionProps {
  id: string;
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  payloadHash: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

const TERMINAL_STATUSES = new Set([
  WagerTransactionStatus.Processed,
  WagerTransactionStatus.Rejected,
  WagerTransactionStatus.Failed,
]);

const KINDS_REQUIRING_REFERENCE = new Set([
  WagerTransactionKind.Refund,
  WagerTransactionKind.Rollback,
]);

const REFUND_ALLOWED_REFERENCE_KINDS = new Set([WagerTransactionKind.Bet]);
const ROLLBACK_ALLOWED_REFERENCE_KINDS = new Set([
  WagerTransactionKind.Bet,
  WagerTransactionKind.Win,
  WagerTransactionKind.Refund,
]);

/**
 * WagerTransaction entity - represents a wagering operation.
 * State machine with terminal states: PROCESSED, REJECTED, FAILED.
 */
export class WagerTransaction {
  private constructor(
    public readonly id: string,
    public readonly providerId: string,
    public readonly externalTransactionId: string,
    public readonly idempotencyKey: string,
    public readonly payloadHash: string,
    public readonly walletId: string,
    public readonly playerId: string,
    public readonly roundId: string,
    public readonly gameId: string,
    public readonly kind: WagerTransactionKind,
    public readonly money: Money,
    public readonly referenceExternalTransactionId: string | undefined,
    public readonly createdAt: Date,
    private _status: WagerTransactionStatus,
    private _referenceTransactionId?: string,
    private _failureCode?: FailureCode,
    private _processedAt?: Date,
    private _retryCount: number = 0,
    private _lastRetryAt?: Date,
  ) {}

  /**
   * Creates a new transaction in PENDING status.
   * Validates reference requirement based on kind.
   */
  static create(props: CreateWagerTransactionProps): WagerTransaction {
    // Validate reference requirement
    if (
      KINDS_REQUIRING_REFERENCE.has(props.kind) &&
      !props.referenceExternalTransactionId
    ) {
      throw new MissingReferenceError(props.kind);
    }

    return new WagerTransaction(
      props.id,
      props.providerId,
      props.externalTransactionId,
      props.idempotencyKey,
      props.payloadHash,
      props.walletId,
      props.playerId,
      props.roundId,
      props.gameId,
      props.kind,
      props.money,
      props.referenceExternalTransactionId,
      new Date(),
      WagerTransactionStatus.Pending,
      undefined,
      undefined,
      undefined,
      0,
      undefined,
    );
  }

  /**
   * Creates an internal OPENING transaction.
   */
  static createOpening(
    id: string,
    walletId: string,
    playerId: string,
    money: Money,
  ): WagerTransaction {
    return new WagerTransaction(
      id,
      "SYSTEM",
      `opening-${walletId}`,
      `SYSTEM:opening-${walletId}`,
      "OPENING",
      walletId,
      playerId,
      "OPENING",
      "OPENING",
      WagerTransactionKind.Opening,
      money,
      undefined,
      new Date(),
      WagerTransactionStatus.Processed,
      undefined,
      undefined,
      new Date(),
      0,
      undefined,
    );
  }

  /**
   * Reconstructs from persistence - no validation.
   */
  static rehydrate(state: WagerTransactionState): WagerTransaction {
    return new WagerTransaction(
      state.id,
      state.providerId,
      state.externalTransactionId,
      state.idempotencyKey,
      state.payloadHash,
      state.walletId,
      state.playerId,
      state.roundId,
      state.gameId,
      state.kind,
      state.money,
      state.referenceExternalTransactionId,
      state.createdAt,
      state.status,
      state.referenceTransactionId,
      state.failureCode,
      state.processedAt,
      state.retryCount,
      state.lastRetryAt,
    );
  }

  get status(): WagerTransactionStatus {
    return this._status;
  }

  get referenceTransactionId(): string | undefined {
    return this._referenceTransactionId;
  }

  get failureCode(): FailureCode | undefined {
    return this._failureCode;
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  get retryCount(): number {
    return this._retryCount;
  }

  get lastRetryAt(): Date | undefined {
    return this._lastRetryAt;
  }

  /**
   * Marks transaction as processed.
   */
  markProcessed(referenceTransactionId: string | undefined, at: Date): void {
    this.assertNotTerminal("PROCESSED");
    this._status = WagerTransactionStatus.Processed;
    this._referenceTransactionId = referenceTransactionId;
    this._processedAt = at;
  }

  /**
   * Marks transaction as pending reference (out-of-order delivery).
   */
  markPendingReference(): void {
    this.assertNotTerminal("PENDING_REFERENCE");
    this._status = WagerTransactionStatus.PendingReference;
  }

  /**
   * Rejects transaction due to business rule violation.
   */
  reject(code: FailureCode): void {
    this.assertNotTerminal("REJECTED");
    this._status = WagerTransactionStatus.Rejected;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  /**
   * Fails transaction due to permanent infrastructure error.
   */
  fail(code: FailureCode): void {
    this.assertNotTerminal("FAILED");
    this._status = WagerTransactionStatus.Failed;
    this._failureCode = code;
    this._processedAt = new Date();
  }

  /**
   * Increments retry count for pending reference processing.
   */
  incrementRetry(): void {
    this._retryCount++;
    this._lastRetryAt = new Date();
  }

  isTerminal(): boolean {
    return TERMINAL_STATUSES.has(this._status);
  }

  /**
   * Returns true if this transaction affects wallet balance.
   * LOSS does not affect balance.
   */
  affectsBalance(): boolean {
    return this.kind !== WagerTransactionKind.Loss;
  }

  /**
   * Returns true if this transaction requires a reference.
   */
  requiresReference(): boolean {
    return KINDS_REQUIRING_REFERENCE.has(this.kind);
  }

  /**
   * Checks if payload hash matches.
   */
  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  /**
   * Determines ledger direction for this transaction.
   */
  ledgerDirectionFor(reference?: WagerTransaction): LedgerDirection {
    switch (this.kind) {
      case WagerTransactionKind.Opening:
      case WagerTransactionKind.Win:
        return LedgerDirection.Credit;

      case WagerTransactionKind.Bet:
        return LedgerDirection.Debit;

      case WagerTransactionKind.Refund:
        // REFUND reverses a BET, so it's a credit
        return LedgerDirection.Credit;

      case WagerTransactionKind.Rollback:
        // ROLLBACK reverses the reference, so opposite direction
        if (!reference) {
          throw new Error("ROLLBACK requires reference transaction");
        }
        const refDirection = reference.ledgerDirectionFor();
        return refDirection === LedgerDirection.Debit
          ? LedgerDirection.Credit
          : LedgerDirection.Debit;

      case WagerTransactionKind.Loss:
        throw new Error("LOSS does not have a ledger direction");

      default:
        throw new Error(`Unknown transaction kind: ${this.kind}`);
    }
  }

  /**
   * Gets allowed reference kinds for this transaction kind.
   */
  getAllowedReferenceKinds(): Set<WagerTransactionKind> {
    switch (this.kind) {
      case WagerTransactionKind.Refund:
        return REFUND_ALLOWED_REFERENCE_KINDS;
      case WagerTransactionKind.Rollback:
        return ROLLBACK_ALLOWED_REFERENCE_KINDS;
      default:
        return new Set();
    }
  }

  private assertNotTerminal(targetState: string): void {
    if (this.isTerminal()) {
      throw new InvalidTransactionStateError(
        this.id,
        this._status,
        targetState,
      );
    }
  }

  toState(): WagerTransactionState {
    return {
      id: this.id,
      providerId: this.providerId,
      externalTransactionId: this.externalTransactionId,
      idempotencyKey: this.idempotencyKey,
      payloadHash: this.payloadHash,
      walletId: this.walletId,
      playerId: this.playerId,
      roundId: this.roundId,
      gameId: this.gameId,
      kind: this.kind,
      money: this.money,
      referenceExternalTransactionId: this.referenceExternalTransactionId,
      createdAt: this.createdAt,
      status: this._status,
      referenceTransactionId: this._referenceTransactionId,
      failureCode: this._failureCode,
      processedAt: this._processedAt,
      retryCount: this._retryCount,
      lastRetryAt: this._lastRetryAt,
    };
  }
}
