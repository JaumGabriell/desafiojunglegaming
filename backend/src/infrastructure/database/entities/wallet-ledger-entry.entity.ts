import {
  Entity,
  PrimaryKey,
  Property,
  Index,
  Enum,
  Check,
} from "@mikro-orm/core";

export enum LedgerDirectionEnum {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

/**
 * MikroORM entity for WalletLedgerEntry persistence.
 * Immutable - no update operations allowed.
 * Schema enforces:
 * - Non-negative amounts
 * - Non-negative balances
 * - Referential integrity to wallet
 */
@Entity({ tableName: "wallet_ledger_entries" })
@Index({ properties: ["walletId", "createdAt"] })
@Check({ expression: "amount >= 0" })
@Check({ expression: "balance_before_amount >= 0" })
@Check({ expression: "balance_after_amount >= 0" })
export class WalletLedgerEntryEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid", fieldName: "wallet_id" })
  @Index()
  walletId!: string;

  @Property({ type: "uuid", fieldName: "transaction_id" })
  @Index()
  transactionId!: string;

  @Enum({
    items: () => LedgerDirectionEnum,
    nativeEnumName: "ledger_direction",
  })
  direction!: LedgerDirectionEnum;

  @Property({ type: "numeric", precision: 20, scale: 2 })
  amount!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({
    type: "numeric",
    precision: 20,
    scale: 2,
    fieldName: "balance_before_amount",
  })
  balanceBeforeAmount!: string;

  @Property({
    type: "numeric",
    precision: 20,
    scale: 2,
    fieldName: "balance_after_amount",
  })
  balanceAfterAmount!: string;

  @Property({ type: "timestamptz", fieldName: "created_at" })
  createdAt!: Date;
}
