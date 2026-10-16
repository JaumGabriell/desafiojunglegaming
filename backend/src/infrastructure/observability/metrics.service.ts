import { Injectable } from "@nestjs/common";
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

@Injectable()
export class MetricsService {
  private readonly registry: Registry;
  private readonly transactionsTotal: Counter;
  private readonly transactionsByStatus: Counter;
  private readonly transactionDuration: Histogram;
  private readonly duplicatesDetected: Counter;
  private readonly retriesTotal: Counter;
  private readonly dlqMessages: Counter;
  private readonly lockConflicts: Counter;
  private readonly outboxLag: Gauge;
  private readonly messagesProcessed: Counter;
  private readonly messageProcessingDuration: Histogram;

  constructor() {
    this.registry = new Registry();
    collectDefaultMetrics({ register: this.registry });

    this.transactionsTotal = new Counter({
      name: "wager_transactions_total",
      help: "Total number of wager transactions processed",
      labelNames: ["kind", "status"],
      registers: [this.registry],
    });

    this.transactionsByStatus = new Counter({
      name: "wager_transactions_by_status_total",
      help: "Transactions by final status",
      labelNames: ["status"],
      registers: [this.registry],
    });

    this.transactionDuration = new Histogram({
      name: "wager_transaction_duration_seconds",
      help: "Transaction processing duration",
      labelNames: ["kind"],
      buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [this.registry],
    });

    this.duplicatesDetected = new Counter({
      name: "wager_duplicates_detected_total",
      help: "Number of duplicate transactions detected",
      registers: [this.registry],
    });

    this.retriesTotal = new Counter({
      name: "wager_retries_total",
      help: "Total number of retries",
      labelNames: ["reason"],
      registers: [this.registry],
    });

    this.dlqMessages = new Counter({
      name: "wager_dlq_messages_total",
      help: "Messages sent to DLQ",
      registers: [this.registry],
    });

    this.lockConflicts = new Counter({
      name: "wager_lock_conflicts_total",
      help: "Number of lock/concurrency conflicts",
      registers: [this.registry],
    });

    this.outboxLag = new Gauge({
      name: "wager_outbox_lag_seconds",
      help: "Lag of oldest unpublished outbox message",
      registers: [this.registry],
    });

    this.messagesProcessed = new Counter({
      name: "sqs_messages_processed_total",
      help: "Total SQS messages processed",
      labelNames: ["status"],
      registers: [this.registry],
    });

    this.messageProcessingDuration = new Histogram({
      name: "sqs_message_processing_duration_ms",
      help: "SQS message processing duration in milliseconds",
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });
  }

  recordTransaction(kind: string, status: string, durationMs: number) {
    this.transactionsTotal.inc({ kind, status });
    this.transactionsByStatus.inc({ status });
    this.transactionDuration.observe({ kind }, durationMs / 1000);
  }

  recordDuplicate() {
    this.duplicatesDetected.inc();
  }

  recordRetry(reason: string) {
    this.retriesTotal.inc({ reason });
  }

  recordDlqMessage() {
    this.dlqMessages.inc();
  }

  recordLockConflict() {
    this.lockConflicts.inc();
  }

  setOutboxLag(lagSeconds: number) {
    this.outboxLag.set(lagSeconds);
  }

  recordMessageProcessed(status: string, durationMs: number) {
    this.messagesProcessed.inc({ status });
    this.messageProcessingDuration.observe(durationMs);
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
