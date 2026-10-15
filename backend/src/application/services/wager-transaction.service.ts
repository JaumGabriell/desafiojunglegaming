import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";

import { Wallet } from "../../domain/entities/wallet";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";
import {
  WalletLedgerEntry,
  LedgerDirection,
} from "../../domain/entities/wallet-ledger-entry";
import { OutboxMessage } from "../../domain/entities/outbox-message";
import { InboxMessage } from "../../domain/entities/inbox-message";
import { Money } from "../../domain/value-objects/money";
import {
  FailureCode,
  InsufficientBalanceError,
  WalletNotFoundError,
  IdempotencyConflictError,
  ReferenceNotFoundError,
  ReferenceAlreadyReversedError,
  InvalidReferenceKindError,
  AmountMismatchError,
  ContextMismatchError,
  ConcurrencyConflictError,
} from "../../domain/errors/domain-errors";
import {
  WagerTransactionProcessed,
  WagerTransactionRejected,
  WagerTransactionPendingReference,
} from "../../domain/events/wager-events";
import {
  WalletBalanceChanged,
  EventContext,
} from "../../domain/events/wallet-events";

import { MikroOrmWalletRepository } from "../../infrastructure/database/repositories/wallet.repository";
import { MikroOrmWagerTransactionRepository } from "../../infrastructure/database/repositories/wager-transaction.repository";
import { MikroOrmLedgerRepository } from "../../infrastructure/database/repositories/ledger.repository";
import { MikroOrmOutboxRepository } from "../../infrastructure/database/repositories/outbox.repository";
import { MikroOrmInboxRepository } from "../../infrastructure/database/repositories/inbox.repository";

export interface ProcessWagerTransactionInput {
  providerId: string;
  externalTransactionId: string;
  idempotencyKey: string;
  playerId: string;
  walletId: string;
  roundId: string;
  gameId: string;
  kind: WagerTransactionKind;
  money: Money;
  referenceExternalTransactionId?: string;
}

export interface ProcessWagerTransactionResult {
  transactionId: string;
  status: WagerTransactionStatus;
  balance: Money;
  idempotentReplay: boolean;
  failureCode?: FailureCode;
}

const MAX_RETRIES = 5;
const RETRY_DELAY_BASE_MS = 50;

@Injectable()
export class WagerTransactionService {
  private readonly logger = new Logger(WagerTransactionService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: MikroOrmWalletRepository,
    private readonly transactionRepo: MikroOrmWagerTransactionRepository,
    private readonly ledgerRepo: MikroOrmLedgerRepository,
    private readonly outboxRepo: MikroOrmOutboxRepository,
    private readonly inboxRepo: MikroOrmInboxRepository,
  ) {}

  async processTransaction(
    input: ProcessWagerTransactionInput,
    messageContext?: { messageId: string; consumerName: string },
  ): Promise<ProcessWagerTransactionResult> {
    const payloadHash = this.computePayloadHash(input);
    const correlationId = uuidv4();

    // Check for existing transaction (idempotency)
    const existingTx = await this.transactionRepo.findByIdempotencyKey(
      input.idempotencyKey,
    );
    if (existingTx) {
      if (!existingTx.matchesPayload(payloadHash)) {
        throw new IdempotencyConflictError(input.idempotencyKey);
      }
      // Idempotent replay
      const wallet = await this.walletRepo.findById(existingTx.walletId);
      return {
        transactionId: existingTx.id,
        status: existingTx.status,
        balance: wallet?.balance ?? Money.zero(input.money.currency),
        idempotentReplay: true,
        failureCode: existingTx.failureCode,
      };
    }

    // Process with retry for concurrency conflicts
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await this.em.transactional(async (em) => {
          try {
            return await this.processTransactionInTransaction(
              em,
              input,
              payloadHash,
              correlationId,
              messageContext,
            );
          } catch (innerError) {
            this.logger.error("Error in transaction:", innerError);
            throw innerError;
          }
        });
      } catch (error) {
        if (error instanceof ConcurrencyConflictError) {
          lastError = error;
          await this.sleep(RETRY_DELAY_BASE_MS * Math.pow(2, attempt));
          continue;
        }
        throw error;
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }

  private async processTransactionInTransaction(
    em: EntityManager,
    input: ProcessWagerTransactionInput,
    payloadHash: string,
    correlationId: string,
    messageContext?: { messageId: string; consumerName: string },
  ): Promise<ProcessWagerTransactionResult> {
    // Create scoped repositories
    const walletRepo = new MikroOrmWalletRepository(em);
    const transactionRepo = new MikroOrmWagerTransactionRepository(em);
    const ledgerRepo = new MikroOrmLedgerRepository(em);
    const outboxRepo = new MikroOrmOutboxRepository(em);
    const inboxRepo = new MikroOrmInboxRepository(em);

    // Handle inbox if from SQS
    if (messageContext) {
      const existingInbox = await inboxRepo.findByConsumerAndMessageId(
        messageContext.consumerName,
        messageContext.messageId,
      );
      if (existingInbox?.isProcessed()) {
        // Already processed, find and return original result
        const tx = await transactionRepo.findByIdempotencyKey(
          input.idempotencyKey,
        );
        const wallet = await walletRepo.findById(input.walletId);
        return {
          transactionId: tx?.id ?? "",
          status: tx?.status ?? WagerTransactionStatus.Processed,
          balance: wallet?.balance ?? Money.zero(input.money.currency),
          idempotentReplay: true,
        };
      }

      const inboxMsg = InboxMessage.receive({
        messageId: messageContext.messageId,
        consumerName: messageContext.consumerName,
        payloadHash,
      });
      await inboxRepo.save(inboxMsg);
    }

    // Get wallet with pessimistic lock
    const wallet = await walletRepo.findById(input.walletId, true);
    if (!wallet) {
      throw new WalletNotFoundError(input.walletId);
    }

    // Validate wallet context
    if (wallet.playerId !== input.playerId) {
      throw new ContextMismatchError(
        FailureCode.PLAYER_MISMATCH,
        "playerId",
        wallet.playerId,
        input.playerId,
      );
    }
    if (wallet.currency !== input.money.currency) {
      throw new ContextMismatchError(
        FailureCode.CURRENCY_MISMATCH,
        "currency",
        wallet.currency,
        input.money.currency,
      );
    }

    const eventContext: EventContext = { correlationId };
    const transactionId = uuidv4();

    // Create transaction entity
    const transaction = WagerTransaction.create({
      id: transactionId,
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      walletId: wallet.id,
      playerId: input.playerId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money,
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });

    try {
      // Process based on kind
      const result = await this.processTransactionByKind(
        transaction,
        wallet,
        input,
        transactionRepo,
        ledgerRepo,
        outboxRepo,
        eventContext,
      );

      await transactionRepo.save(transaction);
      await walletRepo.save(wallet);
      await em.flush();

      // Mark inbox as processed
      if (messageContext) {
        const inbox = await inboxRepo.findByConsumerAndMessageId(
          messageContext.consumerName,
          messageContext.messageId,
        );
        if (inbox) {
          inbox.markProcessed(new Date());
          await inboxRepo.save(inbox);
          await em.flush();
        }
      }

      return result;
    } catch (error) {
      if (error instanceof InsufficientBalanceError) {
        transaction.reject(FailureCode.INSUFFICIENT_BALANCE);
        await transactionRepo.save(transaction);
        await em.flush();

        const rejectedEvent = WagerTransactionRejected.from(
          transaction,
          eventContext,
        );
        await outboxRepo.save(OutboxMessage.enqueue(rejectedEvent));

        return {
          transactionId: transaction.id,
          status: transaction.status,
          balance: wallet.balance,
          idempotentReplay: false,
          failureCode: FailureCode.INSUFFICIENT_BALANCE,
        };
      }
      throw error;
    }
  }

  private async processTransactionByKind(
    transaction: WagerTransaction,
    wallet: Wallet,
    input: ProcessWagerTransactionInput,
    transactionRepo: MikroOrmWagerTransactionRepository,
    ledgerRepo: MikroOrmLedgerRepository,
    outboxRepo: MikroOrmOutboxRepository,
    eventContext: EventContext,
  ): Promise<ProcessWagerTransactionResult> {
    let ledgerEntry: WalletLedgerEntry | undefined;
    let referenceTransaction: WagerTransaction | undefined;

    switch (input.kind) {
      case WagerTransactionKind.Bet:
        ledgerEntry = this.processBet(transaction, wallet);
        break;

      case WagerTransactionKind.Win:
        ledgerEntry = this.processWin(transaction, wallet);
        break;

      case WagerTransactionKind.Loss:
        // LOSS doesn't affect balance
        transaction.markProcessed(undefined, new Date());
        break;

      case WagerTransactionKind.Refund:
      case WagerTransactionKind.Rollback:
        const refResult = await this.processReversal(
          transaction,
          wallet,
          input,
          transactionRepo,
        );
        if (refResult.pendingReference) {
          transaction.markPendingReference();
          await transactionRepo.save(transaction);

          const pendingEvent = WagerTransactionPendingReference.from(
            transaction,
            eventContext,
          );
          await outboxRepo.save(OutboxMessage.enqueue(pendingEvent));

          return {
            transactionId: transaction.id,
            status: WagerTransactionStatus.PendingReference,
            balance: wallet.balance,
            idempotentReplay: false,
          };
        }
        ledgerEntry = refResult.ledgerEntry;
        referenceTransaction = refResult.referenceTransaction;
        break;

      default:
        throw new Error(`Unsupported transaction kind: ${input.kind}`);
    }

    // Mark as processed
    transaction.markProcessed(referenceTransaction?.id, new Date());

    // Save ledger entry if created
    if (ledgerEntry) {
      await ledgerRepo.save(ledgerEntry);

      // Emit balance changed event
      const balanceEvent = WalletBalanceChanged.from(
        wallet,
        ledgerEntry,
        eventContext,
      );
      await outboxRepo.save(OutboxMessage.enqueue(balanceEvent));
    }

    // Emit transaction processed event
    const processedEvent = WagerTransactionProcessed.from(
      transaction,
      eventContext,
    );
    await outboxRepo.save(OutboxMessage.enqueue(processedEvent));

    return {
      transactionId: transaction.id,
      status: WagerTransactionStatus.Processed,
      balance: wallet.balance,
      idempotentReplay: false,
    };
  }

  private processBet(
    transaction: WagerTransaction,
    wallet: Wallet,
  ): WalletLedgerEntry {
    const result = wallet.debit(transaction.id, transaction.money, uuidv4());
    return result.entry;
  }

  private processWin(
    transaction: WagerTransaction,
    wallet: Wallet,
  ): WalletLedgerEntry {
    const result = wallet.credit(transaction.id, transaction.money, uuidv4());
    return result.entry;
  }

  private async processReversal(
    transaction: WagerTransaction,
    wallet: Wallet,
    input: ProcessWagerTransactionInput,
    transactionRepo: MikroOrmWagerTransactionRepository,
  ): Promise<{
    pendingReference: boolean;
    ledgerEntry?: WalletLedgerEntry;
    referenceTransaction?: WagerTransaction;
  }> {
    if (!input.referenceExternalTransactionId) {
      throw new Error(`${input.kind} requires referenceExternalTransactionId`);
    }

    // Find reference transaction
    const refTx = await transactionRepo.findByProviderAndExternalId(
      input.providerId,
      input.referenceExternalTransactionId,
    );

    if (!refTx) {
      // Out-of-order delivery - mark as pending reference
      return { pendingReference: true };
    }

    // Validate reference
    this.validateReference(transaction, refTx, input);

    // Check if already reversed
    await this.checkAlreadyReversed(refTx, input.kind, transactionRepo);

    // Apply reversal
    const direction = transaction.ledgerDirectionFor(refTx);
    const ledgerEntry = wallet.applyReversal(
      transaction.id,
      transaction.money,
      direction,
      uuidv4(),
    );

    return {
      pendingReference: false,
      ledgerEntry,
      referenceTransaction: refTx,
    };
  }

  private validateReference(
    transaction: WagerTransaction,
    refTx: WagerTransaction,
    input: ProcessWagerTransactionInput,
  ): void {
    // Check reference is processed
    if (refTx.status !== WagerTransactionStatus.Processed) {
      throw new ReferenceNotFoundError(
        input.providerId,
        input.referenceExternalTransactionId!,
      );
    }

    // Check allowed reference kinds
    const allowedKinds = transaction.getAllowedReferenceKinds();
    if (!allowedKinds.has(refTx.kind)) {
      throw new InvalidReferenceKindError(
        input.kind,
        refTx.kind,
        Array.from(allowedKinds),
      );
    }

    // Check same provider
    if (refTx.providerId !== input.providerId) {
      throw new ContextMismatchError(
        FailureCode.PROVIDER_MISMATCH,
        "providerId",
        refTx.providerId,
        input.providerId,
      );
    }

    // Check same wallet
    if (refTx.walletId !== input.walletId) {
      throw new ContextMismatchError(
        FailureCode.WALLET_NOT_FOUND,
        "walletId",
        refTx.walletId,
        input.walletId,
      );
    }

    // Check same round
    if (refTx.roundId !== input.roundId) {
      throw new ContextMismatchError(
        FailureCode.ROUND_MISMATCH,
        "roundId",
        refTx.roundId,
        input.roundId,
      );
    }

    // Check amount matches
    if (!refTx.money.equals(input.money)) {
      throw new AmountMismatchError(
        refTx.money.getAmount(),
        input.money.getAmount(),
      );
    }
  }

  private async checkAlreadyReversed(
    refTx: WagerTransaction,
    reversalKind: WagerTransactionKind,
    transactionRepo: MikroOrmWagerTransactionRepository,
  ): Promise<void> {
    // This is enforced by DB trigger, but we check here for better error message
    // The trigger will catch any race conditions
  }

  private computePayloadHash(input: ProcessWagerTransactionInput): string {
    const canonical = JSON.stringify({
      providerId: input.providerId,
      externalTransactionId: input.externalTransactionId,
      playerId: input.playerId,
      walletId: input.walletId,
      roundId: input.roundId,
      gameId: input.gameId,
      kind: input.kind,
      money: input.money.toJSON(),
      referenceExternalTransactionId: input.referenceExternalTransactionId,
    });
    return crypto.createHash("sha256").update(canonical).digest("hex");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
