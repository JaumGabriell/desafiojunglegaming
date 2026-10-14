import { Entity, PrimaryKeyProp, Property, Index } from "@mikro-orm/core";

/**
 * MikroORM entity for InboxMessage persistence.
 * Composite primary key: (consumerName, messageId)
 * Used for at-least-once message deduplication.
 */
@Entity({ tableName: "inbox_messages" })
@Index({ properties: ["processedAt"] })
export class InboxMessageEntity {
  @Property({
    type: "varchar",
    length: 255,
    fieldName: "message_id",
    primary: true,
  })
  messageId!: string;

  @Property({
    type: "varchar",
    length: 100,
    fieldName: "consumer_name",
    primary: true,
  })
  consumerName!: string;

  [PrimaryKeyProp]?: ["messageId", "consumerName"];

  @Property({ type: "varchar", length: 64, fieldName: "payload_hash" })
  payloadHash!: string;

  @Property({ type: "timestamptz", fieldName: "received_at" })
  receivedAt!: Date;

  @Property({ type: "timestamptz", fieldName: "processed_at", nullable: true })
  processedAt?: Date;
}
