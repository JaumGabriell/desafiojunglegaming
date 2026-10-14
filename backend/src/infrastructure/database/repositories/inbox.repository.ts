import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { InboxMessageEntity } from "../entities/inbox-message.entity";
import {
  InboxMessage,
  InboxMessageState,
} from "../../../domain/entities/inbox-message";

export interface InboxRepository {
  findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null>;
  save(message: InboxMessage): Promise<void>;
  isProcessed(consumerName: string, messageId: string): Promise<boolean>;
}

@Injectable()
export class MikroOrmInboxRepository implements InboxRepository {
  constructor(private readonly em: EntityManager) {}

  async findByConsumerAndMessageId(
    consumerName: string,
    messageId: string,
  ): Promise<InboxMessage | null> {
    const entity = await this.em.findOne(InboxMessageEntity, {
      consumerName,
      messageId,
    });
    if (!entity) return null;
    return this.toDomain(entity);
  }

  async save(message: InboxMessage): Promise<void> {
    const state = message.toState();
    let entity = await this.em.findOne(InboxMessageEntity, {
      consumerName: state.consumerName,
      messageId: state.messageId,
    });

    if (entity) {
      entity.processedAt = state.processedAt;
    } else {
      entity = this.em.create(InboxMessageEntity, {
        messageId: state.messageId,
        consumerName: state.consumerName,
        payloadHash: state.payloadHash,
        receivedAt: state.receivedAt,
        processedAt: state.processedAt,
      });
      this.em.persist(entity);
    }
  }

  async isProcessed(consumerName: string, messageId: string): Promise<boolean> {
    const entity = await this.em.findOne(InboxMessageEntity, {
      consumerName,
      messageId,
    });
    return entity?.processedAt != null;
  }

  private toDomain(entity: InboxMessageEntity): InboxMessage {
    const state: InboxMessageState = {
      messageId: entity.messageId,
      consumerName: entity.consumerName,
      payloadHash: entity.payloadHash,
      receivedAt: entity.receivedAt,
      processedAt: entity.processedAt,
    };
    return InboxMessage.rehydrate(state);
  }
}
