import { EntityManager, LockMode, raw } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { OutboxMessageEntity } from "../entities/outbox-message.entity";
import {
  OutboxMessage,
  OutboxMessageState,
} from "../../../domain/entities/outbox-message";

export interface OutboxRepository {
  save(message: OutboxMessage): Promise<void>;
  findPendingMessages(limit: number): Promise<OutboxMessage[]>;
  markPublished(id: string, publishedAt: Date): Promise<void>;
  scheduleRetry(
    id: string,
    nextAttemptAt: Date,
    attempts: number,
  ): Promise<void>;
  claimPendingMessages(
    limit: number,
    instanceId: string,
  ): Promise<OutboxMessage[]>;
}

@Injectable()
export class MikroOrmOutboxRepository implements OutboxRepository {
  constructor(private readonly em: EntityManager) {}

  async save(message: OutboxMessage): Promise<void> {
    const state = message.toState();
    const entity = this.em.create(OutboxMessageEntity, {
      id: state.id,
      aggregateId: state.aggregateId,
      eventType: state.eventType,
      payload: state.payload,
      occurredAt: state.occurredAt,
      attempts: state.attempts,
      nextAttemptAt: state.nextAttemptAt,
      publishedAt: state.publishedAt,
    });
    this.em.persist(entity);
  }

  async findPendingMessages(limit: number): Promise<OutboxMessage[]> {
    const now = new Date();
    const entities = await this.em.find(
      OutboxMessageEntity,
      {
        publishedAt: null,
        $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
      },
      {
        orderBy: { occurredAt: "ASC" },
        limit,
      },
    );
    return entities.map((e) => this.toDomain(e));
  }

  /**
   * Claims pending messages using SELECT FOR UPDATE SKIP LOCKED
   * to allow concurrent publishers to work on different messages.
   */
  async claimPendingMessages(
    limit: number,
    instanceId: string,
  ): Promise<OutboxMessage[]> {
    const now = new Date();

    // Use raw query for SKIP LOCKED support
    interface RawOutboxRow {
      id: string;
      aggregate_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      occurred_at: string;
      attempts: number;
      next_attempt_at: string | null;
      published_at: string | null;
    }

    const result = await this.em.getConnection().execute<RawOutboxRow[]>(
      `SELECT * FROM outbox_messages
       WHERE published_at IS NULL
       AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY occurred_at ASC
       LIMIT ?
       FOR UPDATE SKIP LOCKED`,
      [now, limit],
    );

    return result.map((row) =>
      OutboxMessage.rehydrate({
        id: row.id,
        aggregateId: row.aggregate_id,
        eventType: row.event_type,
        payload: row.payload,
        occurredAt: new Date(row.occurred_at),
        attempts: row.attempts,
        nextAttemptAt: row.next_attempt_at
          ? new Date(row.next_attempt_at)
          : undefined,
        publishedAt: row.published_at ? new Date(row.published_at) : undefined,
      }),
    );
  }

  async markPublished(id: string, publishedAt: Date): Promise<void> {
    await this.em.nativeUpdate(
      OutboxMessageEntity,
      { id },
      { publishedAt, attempts: raw("attempts + 1") },
    );
  }

  async scheduleRetry(
    id: string,
    nextAttemptAt: Date,
    attempts: number,
  ): Promise<void> {
    await this.em.nativeUpdate(
      OutboxMessageEntity,
      { id },
      { nextAttemptAt, attempts },
    );
  }

  private toDomain(entity: OutboxMessageEntity): OutboxMessage {
    const state: OutboxMessageState = {
      id: entity.id,
      aggregateId: entity.aggregateId,
      eventType: entity.eventType,
      payload: entity.payload,
      occurredAt: entity.occurredAt,
      attempts: entity.attempts,
      nextAttemptAt: entity.nextAttemptAt,
      publishedAt: entity.publishedAt,
    };
    return OutboxMessage.rehydrate(state);
  }
}
