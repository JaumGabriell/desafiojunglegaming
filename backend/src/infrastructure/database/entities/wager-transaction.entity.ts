import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Enum,
  Unique,
  Check,
} from "@mikro-orm/core";

export enum WagerTransactionKindEnum {
  Opening = "OPENING",
  Bet = "BET",
  Win = "WIN",
  Loss = "LOSS",
  Refund = "REFUND",
  Rollback = "ROLLBACK",
}

export enum WagerTransactionStatusEnum {
  Pending = "PENDING",
  PendingReference = "PENDING_REFERENCE",
  Processed = "PROCESSED",
  Rejected = "REJECTED",
  Failed = "FAILED",
}

/**
 * MikroORM entity for WagerTransaction persistence.
 * Schema enforces:
 * - Unique idempotency key
 * - Unique (providerId, externalTransactionId)
 * - Non-negative amounts
 */
@Entity({ tableName: "wager_transactions" })
@Unique({ properties: ["idempotencyKey"] })
@Unique({ properties: ["providerId", "externalTransactionId"] })
@Index({ properties: ["walletId", "createdAt"] })
@Index({ properties: ["status"] })
@Index({ properties: ["roundId"] })
@Check({ expression: "amount >= 0" })
export class WagerTransactionEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "varchar", length: 100, fieldName: "provider_id" })
  @Index()
  providerId!: string;

  @Property({
    type: "varchar",
    length: 255,
    fieldName: "external_transaction_id",
  })
  externalTransactionId!: string;

  @Property({ type: "varchar", length: 500, fieldName: "idempotency_key" })
  idempotencyKey!: string;

  @Property({ type: "varchar", length: 64, fieldName: "payload_hash" })
  payloadHash!: string;

  @Property({ type: "uuid", fieldName: "wallet_id" })
  @Index()
  walletId!: string;

  @Property({ type: "uuid", fieldName: "player_id" })
  @Index()
  playerId!: string;

  @Property({ type: "varchar", length: 255, fieldName: "round_id" })
  roundId!: string;

  @Property({ type: "varchar", length: 255, fieldName: "game_id" })
  gameId!: string;

  @Enum({
    items: () => WagerTransactionKindEnum,
    nativeEnumName: "wager_transaction_kind",
  })
  kind!: WagerTransactionKindEnum;

  @Property({ type: "numeric", precision: 20, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({
    type: "varchar",
    length: 255,
    fieldName: "reference_external_transaction_id",
    nullable: true,
  })
  referenceExternalTransactionId?: string;

  @Enum({
    items: () => WagerTransactionStatusEnum,
    nativeEnumName: "wager_transaction_status",
  })
  status!: WagerTransactionStatusEnum;

  @Property({
    type: "uuid",
    fieldName: "reference_transaction_id",
    nullable: true,
  })
  referenceTransactionId?: string;

  @Property({
    type: "varchar",
    length: 100,
    fieldName: "failure_code",
    nullable: true,
  })
  failureCode?: string;

  @Property({ type: "timestamptz", fieldName: "created_at" })
  createdAt!: Date;

  @Property({ type: "timestamptz", fieldName: "processed_at", nullable: true })
  processedAt?: Date;

  @Property({ type: "int", fieldName: "retry_count", default: 0 })
  retryCount!: number;

  @Property({ type: "timestamptz", fieldName: "last_retry_at", nullable: true })
  lastRetryAt?: Date;
}
