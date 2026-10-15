import { v4 as uuidv4 } from "uuid";
import { IntegrationEvent, IntegrationEventProps } from "./integration-event";
import { MoneyProps } from "../value-objects/money";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../entities/wager-transaction";
import { FailureCode } from "../errors/domain-errors";
import { EventContext } from "./wallet-events";

export interface WagerTransactionProcessedData {
  transactionId: string;
  externalTransactionId: string;
  providerId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceTransactionId?: string;
  processedAt: string;
}

/**
 * Event emitted when a wager transaction is processed.
 */
export class WagerTransactionProcessed extends IntegrationEvent<WagerTransactionProcessedData> {
  readonly eventType = "WagerTransactionProcessed";
  readonly version = 1;

  private constructor(
    props: IntegrationEventProps<WagerTransactionProcessedData>,
  ) {
    super(props);
  }

  static from(
    tx: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionProcessed {
    return new WagerTransactionProcessed({
      eventId: uuidv4(),
      aggregateId: tx.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        transactionId: tx.id,
        externalTransactionId: tx.externalTransactionId,
        providerId: tx.providerId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        referenceTransactionId: tx.referenceTransactionId,
        processedAt: tx.processedAt?.toISOString() ?? new Date().toISOString(),
      },
    });
  }
}

export interface WagerTransactionRejectedData {
  transactionId: string;
  externalTransactionId: string;
  providerId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  failureCode: FailureCode;
  rejectedAt: string;
}

/**
 * Event emitted when a wager transaction is rejected.
 */
export class WagerTransactionRejected extends IntegrationEvent<WagerTransactionRejectedData> {
  readonly eventType = "WagerTransactionRejected";
  readonly version = 1;

  private constructor(
    props: IntegrationEventProps<WagerTransactionRejectedData>,
  ) {
    super(props);
  }

  static from(
    tx: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionRejected {
    return new WagerTransactionRejected({
      eventId: uuidv4(),
      aggregateId: tx.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        transactionId: tx.id,
        externalTransactionId: tx.externalTransactionId,
        providerId: tx.providerId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        failureCode: tx.failureCode!,
        rejectedAt: tx.processedAt?.toISOString() ?? new Date().toISOString(),
      },
    });
  }
}

export interface WagerTransactionPendingReferenceData {
  transactionId: string;
  externalTransactionId: string;
  providerId: string;
  walletId: string;
  playerId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: MoneyProps;
  referenceExternalTransactionId: string;
  retryCount: number;
}

/**
 * Event emitted when a wager transaction is pending reference resolution.
 */
export class WagerTransactionPendingReference extends IntegrationEvent<WagerTransactionPendingReferenceData> {
  readonly eventType = "WagerTransactionPendingReference";
  readonly version = 1;

  private constructor(
    props: IntegrationEventProps<WagerTransactionPendingReferenceData>,
  ) {
    super(props);
  }

  static from(
    tx: WagerTransaction,
    ctx: EventContext,
  ): WagerTransactionPendingReference {
    return new WagerTransactionPendingReference({
      eventId: uuidv4(),
      aggregateId: tx.walletId,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        transactionId: tx.id,
        externalTransactionId: tx.externalTransactionId,
        providerId: tx.providerId,
        walletId: tx.walletId,
        playerId: tx.playerId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money.toJSON(),
        referenceExternalTransactionId: tx.referenceExternalTransactionId!,
        retryCount: tx.retryCount,
      },
    });
  }
}
