import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EntityManager } from "@mikro-orm/postgresql";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { MikroOrmOutboxRepository } from "../database/repositories/outbox.repository";
import { MetricsService } from "../observability/metrics.service";

const BATCH_SIZE = 100;

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly instanceId: string;
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    private readonly outboxRepo: MikroOrmOutboxRepository,
    private readonly metricsService: MetricsService,
  ) {
    this.sqsClient = new SQSClient({
      endpoint: this.configService.get("SQS_ENDPOINT"),
      region: this.configService.get("AWS_REGION", "us-east-1"),
      credentials: {
        accessKeyId: this.configService.get("AWS_ACCESS_KEY_ID", "test"),
        secretAccessKey: this.configService.get(
          "AWS_SECRET_ACCESS_KEY",
          "test",
        ),
      },
    });
    this.queueUrl = this.configService.get(
      "SQS_EVENTS_QUEUE_URL",
      "http://localhost:4566/000000000000/wager-events.fifo",
    );
    this.instanceId = this.configService.get("INSTANCE_ID", "instance-1");
  }

  onModuleInit() {
    this.isRunning = true;
    this.logger.log("Outbox publisher started");
  }

  onModuleDestroy() {
    this.isRunning = false;
    this.logger.log("Outbox publisher stopped");
  }

  @Cron(CronExpression.EVERY_SECOND)
  async publishPendingMessages() {
    if (!this.isRunning) return;

    try {
      await this.em.transactional(async (em) => {
        const outboxRepo = new MikroOrmOutboxRepository(em);
        const messages = await outboxRepo.claimPendingMessages(
          BATCH_SIZE,
          this.instanceId,
        );

        if (messages.length === 0) return;

        this.logger.debug(`Publishing ${messages.length} outbox messages`);

        for (const message of messages) {
          try {
            await this.publishToSqs(message);
            await outboxRepo.markPublished(message.id, new Date());

            this.logger.debug({
              message: "Outbox message published",
              eventId: message.id,
              eventType: message.eventType,
            });
          } catch (error) {
            this.logger.error({
              message: "Failed to publish outbox message",
              eventId: message.id,
              error: error instanceof Error ? error.message : "Unknown error",
            });

            // Schedule retry with exponential backoff
            message.scheduleRetry(new Date());
            await outboxRepo.scheduleRetry(
              message.id,
              message.nextAttemptAt!,
              message.attempts,
            );
          }
        }
      });

      // Update outbox lag metric
      await this.updateOutboxLagMetric();
    } catch (error) {
      this.logger.error("Error in outbox publisher", error);
    }
  }

  private async publishToSqs(message: {
    id: string;
    aggregateId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }) {
    const command = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(message.payload),
      MessageGroupId: message.aggregateId,
      MessageDeduplicationId: message.id,
    });

    await this.sqsClient.send(command);
  }

  private async updateOutboxLagMetric() {
    try {
      const result = await this.em
        .getConnection()
        .execute<{ lag_seconds: number }[]>(
          `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(occurred_at))) as lag_seconds
         FROM outbox_messages
         WHERE published_at IS NULL`,
        );

      if (result.length > 0 && result[0].lag_seconds !== null) {
        this.metricsService.setOutboxLag(result[0].lag_seconds);
      } else {
        this.metricsService.setOutboxLag(0);
      }
    } catch (error) {
      this.logger.error("Error updating outbox lag metric", error);
    }
  }
}
