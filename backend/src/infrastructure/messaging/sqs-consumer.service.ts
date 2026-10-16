import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
  Message,
} from "@aws-sdk/client-sqs";
import { WagerTransactionService } from "../../application/services/wager-transaction.service";
import { WagerTransactionKind } from "../../domain/entities/wager-transaction";
import { Money } from "../../domain/value-objects/money";
import { MetricsService } from "../observability/metrics.service";

interface WagerTransactionMessage {
  messageId: string;
  type: string;
  occurredAt: string;
  data: {
    providerId: string;
    externalTransactionId: string;
    idempotencyKey: string;
    playerId: string;
    walletId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: { amount: string; currency: string };
    referenceExternalTransactionId?: string;
  };
}

const CONSUMER_NAME = "wager-transaction-consumer";
const MAX_MESSAGES = 10;
const VISIBILITY_TIMEOUT = 30;
const WAIT_TIME_SECONDS = 20;

@Injectable()
export class SqsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsConsumerService.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private isRunning = false;
  private isShuttingDown = false;
  private activeMessages = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly wagerService: WagerTransactionService,
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
      "SQS_WAGER_QUEUE_URL",
      "http://localhost:4566/000000000000/wager-transactions.fifo",
    );
  }

  async onModuleInit() {
    this.isRunning = true;
    this.startPolling();
  }

  async onModuleDestroy() {
    this.logger.log("Shutting down SQS consumer...");
    this.isShuttingDown = true;
    this.isRunning = false;

    // Wait for active messages to complete
    const maxWait = 30000;
    const start = Date.now();
    while (this.activeMessages > 0 && Date.now() - start < maxWait) {
      await this.sleep(100);
    }

    if (this.activeMessages > 0) {
      this.logger.warn(
        `Shutdown with ${this.activeMessages} messages still processing`,
      );
    }
  }

  private async startPolling() {
    while (this.isRunning) {
      try {
        await this.pollMessages();
      } catch (error) {
        this.logger.error("Error polling messages", error);
        await this.sleep(5000); // Back off on error
      }
    }
  }

  private async pollMessages() {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: MAX_MESSAGES,
      WaitTimeSeconds: WAIT_TIME_SECONDS,
      VisibilityTimeout: VISIBILITY_TIMEOUT,
      AttributeNames: ["All"],
      MessageAttributeNames: ["All"],
    });

    const response = await this.sqsClient.send(command);
    const messages = response.Messages ?? [];

    await Promise.all(messages.map((msg) => this.processMessage(msg)));
  }

  private async processMessage(message: Message) {
    if (!message.Body || !message.ReceiptHandle) {
      this.logger.warn("Received message without body or receipt handle");
      return;
    }

    this.activeMessages++;
    const startTime = Date.now();

    try {
      const parsed = JSON.parse(message.Body) as WagerTransactionMessage;

      this.logger.log({
        message: "Processing SQS message",
        messageId: parsed.messageId,
        type: parsed.type,
        walletId: parsed.data.walletId,
      });

      if (parsed.type !== "WagerTransactionRequested") {
        this.logger.warn(`Unknown message type: ${parsed.type}`);
        await this.deleteMessage(message.ReceiptHandle);
        return;
      }

      await this.wagerService.processTransaction(
        {
          providerId: parsed.data.providerId,
          externalTransactionId: parsed.data.externalTransactionId,
          idempotencyKey: parsed.data.idempotencyKey,
          playerId: parsed.data.playerId,
          walletId: parsed.data.walletId,
          roundId: parsed.data.roundId,
          gameId: parsed.data.gameId,
          kind: parsed.data.kind,
          money: Money.from(parsed.data.money),
          referenceExternalTransactionId:
            parsed.data.referenceExternalTransactionId,
        },
        {
          messageId: parsed.messageId,
          consumerName: CONSUMER_NAME,
        },
      );

      // ACK only after successful processing
      await this.deleteMessage(message.ReceiptHandle);

      const duration = Date.now() - startTime;
      this.metricsService.recordMessageProcessed("success", duration);

      this.logger.log({
        message: "Message processed successfully",
        messageId: parsed.messageId,
        durationMs: duration,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metricsService.recordMessageProcessed("error", duration);

      this.logger.error({
        message: "Error processing message",
        messageId: message.MessageId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // For transient errors, let the visibility timeout expire for retry
      // For permanent errors, we could send to DLQ, but SQS handles this via redrive policy
    } finally {
      this.activeMessages--;
    }
  }

  private async deleteMessage(receiptHandle: string) {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.sqsClient.send(command);
  }

  private async extendVisibility(receiptHandle: string, seconds: number) {
    const command = new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: seconds,
    });
    await this.sqsClient.send(command);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
