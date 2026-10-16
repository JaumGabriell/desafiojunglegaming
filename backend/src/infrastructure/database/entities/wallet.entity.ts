import {
  Entity,
  PrimaryKey,
  Property,
  Unique,
  Index,
  Check,
} from "@mikro-orm/core";

/**
 * MikroORM entity for Wallet persistence.
 * Schema enforces:
 * - Unique (playerId, currency)
 * - Non-negative balance
 * - Version for optimistic locking
 */
@Entity({ tableName: "wallets" })
@Unique({ properties: ["playerId", "currency"] })
@Index({ properties: ["playerId"] })
@Check({ expression: "balance_amount >= 0" })
export class WalletEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid", fieldName: "player_id" })
  @Index()
  playerId!: string;

  @Property({ type: "varchar", length: 3 })
  currency!: string;

  @Property({
    type: "numeric",
    precision: 20,
    scale: 2,
    fieldName: "balance_amount",
  })
  balanceAmount!: string;

  @Property({ type: "int" })
  version!: number;

  @Property({ type: "timestamptz", fieldName: "created_at" })
  createdAt!: Date;

  @Property({
    type: "timestamptz",
    fieldName: "updated_at",
    onUpdate: () => new Date(),
  })
  updatedAt!: Date;
}
