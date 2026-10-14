import { EntityManager, LockMode } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import {
  WagerTransactionEntity,
  WagerTransactionKindEnum,
  WagerTransactionStatusEnum,
} from "../entities/wager-transaction.entity";
import {
  WagerTransaction,
  WagerTransactionState,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../../domain/entities/wager-transaction";
import { Money } from "../../../domain/value-objects/money";
import { FailureCode } from "../../../domain/errors/domain-errors";

export interface WagerTransactionRepository {
  findById(id: string): Promise<WagerTransaction | null>;
  findByIdempotencyKey(key: string): Promise<WagerTransaction | null>;
  findByProviderAndExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null>;
  findPendingReferenceTransactions(limit: number): Promise<WagerTransaction[]>;
  save(transaction: WagerTransaction): Promise<void>;
  exists(idempotencyKey: string): Promise<boolean>;
}

@Injectable()
export class MikroOrmWagerTransactionRepository implements WagerTransactionRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, { id });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByIdempotencyKey(key: string): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      idempotencyKey: key,
    });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findByProviderAndExternalId(
    providerId: string,
    externalId: string,
  ): Promise<WagerTransaction | null> {
    const entity = await this.em.findOne(WagerTransactionEntity, {
      providerId,
      externalTransactionId: externalId,
    });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async findPendingReferenceTransactions(
    limit: number,
  ): Promise<WagerTransaction[]> {
    const entities = await this.em.find(
      WagerTransactionEntity,
      { status: WagerTransactionStatusEnum.PendingReference },
      {
        orderBy: { lastRetryAt: "ASC" },
        limit,
      },
    );
    return entities.map((e) => this.toDomain(e));
  }

  async save(transaction: WagerTransaction): Promise<void> {
    const state = transaction.toState();
    let entity = await this.em.findOne(WagerTransactionEntity, {
      id: transaction.id,
    });

    if (entity) {
      // Update existing
      entity.status = this.toStatusEnum(state.status);
      entity.referenceTransactionId = state.referenceTransactionId;
      entity.failureCode = state.failureCode;
      entity.processedAt = state.processedAt;
      entity.retryCount = state.retryCount;
      entity.lastRetryAt = state.lastRetryAt;
    } else {
      // Create new
      entity = this.em.create(WagerTransactionEntity, {
        id: state.id,
        providerId: state.providerId,
        externalTransactionId: state.externalTransactionId,
        idempotencyKey: state.idempotencyKey,
        payloadHash: state.payloadHash,
        walletId: state.walletId,
        playerId: state.playerId,
        roundId: state.roundId,
        gameId: state.gameId,
        kind: this.toKindEnum(state.kind),
        amount: state.money.getAmount(),
        currency: state.money.currency,
        referenceExternalTransactionId: state.referenceExternalTransactionId,
        status: this.toStatusEnum(state.status),
        referenceTransactionId: state.referenceTransactionId,
        failureCode: state.failureCode,
        createdAt: state.createdAt,
        processedAt: state.processedAt,
        retryCount: state.retryCount,
        lastRetryAt: state.lastRetryAt,
      });
      this.em.persist(entity);
    }
  }

  async exists(idempotencyKey: string): Promise<boolean> {
    const count = await this.em.count(WagerTransactionEntity, {
      idempotencyKey,
    });
    return count > 0;
  }

  private toDomain(entity: WagerTransactionEntity): WagerTransaction {
    const state: WagerTransactionState = {
      id: entity.id,
      providerId: entity.providerId,
      externalTransactionId: entity.externalTransactionId,
      idempotencyKey: entity.idempotencyKey,
      payloadHash: entity.payloadHash,
      walletId: entity.walletId,
      playerId: entity.playerId,
      roundId: entity.roundId,
      gameId: entity.gameId,
      kind: this.toKindDomain(entity.kind),
      money: Money.rehydrate(entity.amount, entity.currency),
      referenceExternalTransactionId: entity.referenceExternalTransactionId,
      createdAt: entity.createdAt,
      status: this.toStatusDomain(entity.status),
      referenceTransactionId: entity.referenceTransactionId,
      failureCode: entity.failureCode as FailureCode | undefined,
      processedAt: entity.processedAt,
      retryCount: entity.retryCount,
      lastRetryAt: entity.lastRetryAt,
    };

    return WagerTransaction.rehydrate(state);
  }

  private toKindEnum(kind: WagerTransactionKind): WagerTransactionKindEnum {
    const map: Record<WagerTransactionKind, WagerTransactionKindEnum> = {
      [WagerTransactionKind.Opening]: WagerTransactionKindEnum.Opening,
      [WagerTransactionKind.Bet]: WagerTransactionKindEnum.Bet,
      [WagerTransactionKind.Win]: WagerTransactionKindEnum.Win,
      [WagerTransactionKind.Loss]: WagerTransactionKindEnum.Loss,
      [WagerTransactionKind.Refund]: WagerTransactionKindEnum.Refund,
      [WagerTransactionKind.Rollback]: WagerTransactionKindEnum.Rollback,
    };
    return map[kind];
  }

  private toKindDomain(kind: WagerTransactionKindEnum): WagerTransactionKind {
    const map: Record<WagerTransactionKindEnum, WagerTransactionKind> = {
      [WagerTransactionKindEnum.Opening]: WagerTransactionKind.Opening,
      [WagerTransactionKindEnum.Bet]: WagerTransactionKind.Bet,
      [WagerTransactionKindEnum.Win]: WagerTransactionKind.Win,
      [WagerTransactionKindEnum.Loss]: WagerTransactionKind.Loss,
      [WagerTransactionKindEnum.Refund]: WagerTransactionKind.Refund,
      [WagerTransactionKindEnum.Rollback]: WagerTransactionKind.Rollback,
    };
    return map[kind];
  }

  private toStatusEnum(
    status: WagerTransactionStatus,
  ): WagerTransactionStatusEnum {
    const map: Record<WagerTransactionStatus, WagerTransactionStatusEnum> = {
      [WagerTransactionStatus.Pending]: WagerTransactionStatusEnum.Pending,
      [WagerTransactionStatus.PendingReference]:
        WagerTransactionStatusEnum.PendingReference,
      [WagerTransactionStatus.Processed]: WagerTransactionStatusEnum.Processed,
      [WagerTransactionStatus.Rejected]: WagerTransactionStatusEnum.Rejected,
      [WagerTransactionStatus.Failed]: WagerTransactionStatusEnum.Failed,
    };
    return map[status];
  }

  private toStatusDomain(
    status: WagerTransactionStatusEnum,
  ): WagerTransactionStatus {
    const map: Record<WagerTransactionStatusEnum, WagerTransactionStatus> = {
      [WagerTransactionStatusEnum.Pending]: WagerTransactionStatus.Pending,
      [WagerTransactionStatusEnum.PendingReference]:
        WagerTransactionStatus.PendingReference,
      [WagerTransactionStatusEnum.Processed]: WagerTransactionStatus.Processed,
      [WagerTransactionStatusEnum.Rejected]: WagerTransactionStatus.Rejected,
      [WagerTransactionStatusEnum.Failed]: WagerTransactionStatus.Failed,
    };
    return map[status];
  }
}
