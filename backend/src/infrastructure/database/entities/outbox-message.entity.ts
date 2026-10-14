import { Entity, PrimaryKey, Property, Index } from "@mikro-orm/core";

/**
 * MikroORM entity for OutboxMessage persistence.
 * Used for transactional outbox pattern.
 */
@Entity({ tableName: "outbox_messages" })
@Index({ properties: ["publishedAt"] })
@Index({ properties: ["nextAttemptAt"] })
export class OutboxMessageEntity {
  @PrimaryKey({ type: "uuid" })
  id!: string;

  @Property({ type: "uuid", fieldName: "aggregate_id" })
  @Index()
  aggregateId!: string;

  @Property({ type: "varchar", length: 100, fieldName: "event_type" })
  eventType!: string;

  @Property({ type: "jsonb" })
  payload!: Record<string, unknown>;

  @Property({ type: "timestamptz", fieldName: "occurred_at" })
  occurredAt!: Date;

  @Property({ type: "int", default: 0 })
  attempts!: number;

  @Property({
    type: "timestamptz",
    fieldName: "next_attempt_at",
    nullable: true,
  })
  nextAttemptAt?: Date;

  @Property({ type: "timestamptz", fieldName: "published_at", nullable: true })
  publishedAt?: Date;
}
