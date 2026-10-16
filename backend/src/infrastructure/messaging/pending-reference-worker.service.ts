import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EntityManager } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";

import { WagerTransactionService } from "../../application/services/wager-transaction.service";
import { MikroOrmWagerTransactionRepository } from "../database/repositories/wager-transaction.repository";
import {
  WagerTransaction,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";
import { FailureCode } from "../../domain/errors/domain-errors";
import { MetricsService } from "../observability/metrics.service";

const BATCH_SIZE = 50;
const MAX_RETRIES = 10;
const TTL_MINUTES = 60;

@Injectable()
export class PendingReferenceWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PendingReferenceWorkerService.name);
  private isRunning = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly em: EntityManager,
    private readonly wagerService: WagerTransactionService,
    private readonly transactionRepo: MikroOrmWagerTransactionRepository,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit() {
    this.isRunning = true;
    this.logger.log("Pending reference worker started");
  }

  onModuleDestroy() {
    this.isRunning = false;
    this.logger.log("Pending reference worker stopped");
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async processPendingReferences() {
    if (!this.isRunning) return;

    try {
      const transactions =
        await this.transactionRepo.findPendingReferenceTransactions(BATCH_SIZE);

      if (transactions.length === 0) return;

      this.logger.debug(
        `Processing ${transactions.length} pending reference transactions`,
      );

      for (const tx of transactions) {
        await this.processTransaction(tx);
      }
    } catch (error) {
      this.logger.error("Error processing pending references", error);
    }
  }

  private async processTransaction(tx: WagerTransaction) {
    try {
      // Check if exceeded retries or TTL
      const createdAt = tx.createdAt.getTime();
      const now = Date.now();
      const ageMinutes = (now - createdAt) / (1000 * 60);

      if (tx.retryCount >= MAX_RETRIES || ageMinutes > TTL_MINUTES) {
        this.logger.warn({
          message: "Pending reference transaction exceeded limits",
          transactionId: tx.id,
          retryCount: tx.retryCount,
          ageMinutes,
        });

        await this.em.transactional(async (em) => {
          const repo = new MikroOrmWagerTransactionRepository(em);
          const freshTx = await repo.findById(tx.id);
          if (
            freshTx &&
            freshTx.status === WagerTransactionStatus.PendingReference
          ) {
            freshTx.reject(FailureCode.REFERENCE_TIMEOUT);
            await repo.save(freshTx);
          }
        });

        this.metricsService.recordTransaction(tx.kind, "REJECTED", 0);
        return;
      }

      // Exponential backoff check
      if (tx.lastRetryAt) {
        const backoffMs = Math.min(1000 * Math.pow(2, tx.retryCount), 60000);
        const nextRetryAt = tx.lastRetryAt.getTime() + backoffMs;
        if (now < nextRetryAt) {
          return; // Not time to retry yet
        }
      }

      // Try to process again
      this.logger.debug({
        message: "Retrying pending reference transaction",
        transactionId: tx.id,
        retryCount: tx.retryCount + 1,
      });

      const result = await this.wagerService.processTransaction({
        providerId: tx.providerId,
        externalTransactionId: tx.externalTransactionId,
        idempotencyKey: tx.idempotencyKey,
        playerId: tx.playerId,
        walletId: tx.walletId,
        roundId: tx.roundId,
        gameId: tx.gameId,
        kind: tx.kind,
        money: tx.money,
        referenceExternalTransactionId: tx.referenceExternalTransactionId,
      });

      if (result.status === WagerTransactionStatus.PendingReference) {
        // Still pending, increment retry
        await this.em.transactional(async (em) => {
          const repo = new MikroOrmWagerTransactionRepository(em);
          const freshTx = await repo.findById(tx.id);
          if (freshTx) {
            freshTx.incrementRetry();
            await repo.save(freshTx);
          }
        });
        this.metricsService.recordRetry("pending_reference");
      } else {
        this.logger.log({
          message: "Pending reference resolved",
          transactionId: tx.id,
          finalStatus: result.status,
        });
      }
    } catch (error) {
      this.logger.error({
        message: "Error processing pending reference",
        transactionId: tx.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      // Increment retry count on error
      await this.em.transactional(async (em) => {
        const repo = new MikroOrmWagerTransactionRepository(em);
        const freshTx = await repo.findById(tx.id);
        if (freshTx) {
          freshTx.incrementRetry();
          await repo.save(freshTx);
        }
      });

      this.metricsService.recordRetry("error");
    }
  }
}
