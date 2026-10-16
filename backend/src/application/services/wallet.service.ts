import { Injectable, Logger } from "@nestjs/common";
import { EntityManager } from "@mikro-orm/postgresql";
import { v4 as uuidv4 } from "uuid";

import { Wallet } from "../../domain/entities/wallet";
import {
  WagerTransaction,
  WagerTransactionKind,
} from "../../domain/entities/wager-transaction";
import { OutboxMessage } from "../../domain/entities/outbox-message";
import { Money } from "../../domain/value-objects/money";
import {
  LedgerDirection,
  WalletLedgerEntry,
} from "../../domain/entities/wallet-ledger-entry";
import {
  WalletCreated,
  WalletBalanceChanged,
  EventContext,
} from "../../domain/events/wallet-events";

import { MikroOrmWalletRepository } from "../../infrastructure/database/repositories/wallet.repository";
import { MikroOrmWagerTransactionRepository } from "../../infrastructure/database/repositories/wager-transaction.repository";
import { MikroOrmLedgerRepository } from "../../infrastructure/database/repositories/ledger.repository";
import { MikroOrmOutboxRepository } from "../../infrastructure/database/repositories/outbox.repository";

export interface CreateWalletInput {
  playerId: string;
  initialBalance: Money;
}

export interface CreateWalletResult {
  id: string;
  playerId: string;
  balance: Money;
  version: number;
}

export interface ReconciliationResult {
  walletId: string;
  storedBalance: Money;
  calculatedBalance: Money;
  difference: Money;
  consistent: boolean;
  checkedEntries: number;
}

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly walletRepo: MikroOrmWalletRepository,
    private readonly transactionRepo: MikroOrmWagerTransactionRepository,
    private readonly ledgerRepo: MikroOrmLedgerRepository,
    private readonly outboxRepo: MikroOrmOutboxRepository,
  ) {}

  async createWallet(input: CreateWalletInput): Promise<CreateWalletResult> {
    return this.em.transactional(async (em) => {
      const walletRepo = new MikroOrmWalletRepository(em);
      const transactionRepo = new MikroOrmWagerTransactionRepository(em);
      const ledgerRepo = new MikroOrmLedgerRepository(em);
      const outboxRepo = new MikroOrmOutboxRepository(em);

      // Check for existing wallet
      const existing = await walletRepo.findByPlayerIdAndCurrency(
        input.playerId,
        input.initialBalance.currency,
      );
      if (existing) {
        throw new Error(
          `Wallet already exists for player ${input.playerId} with currency ${input.initialBalance.currency}`,
        );
      }

      const walletId = uuidv4();
      const eventContext: EventContext = { correlationId: uuidv4() };

      // Create wallet
      const wallet = Wallet.open({
        id: walletId,
        playerId: input.playerId,
        initialBalance: input.initialBalance,
      });

      await walletRepo.save(wallet);
      await em.flush();

      if (!input.initialBalance.isZero()) {
        const openingTransaction = WagerTransaction.createOpening(
          uuidv4(),
          wallet.id,
          wallet.playerId,
          input.initialBalance,
        );
        const openingEntry = WalletLedgerEntry.create({
          id: uuidv4(),
          walletId: wallet.id,
          transactionId: openingTransaction.id,
          direction: LedgerDirection.Credit,
          money: input.initialBalance,
          balanceBefore: Money.zero(input.initialBalance.currency),
          balanceAfter: input.initialBalance,
        });

        await transactionRepo.save(openingTransaction);
        await em.flush();
        await ledgerRepo.save(openingEntry);
        await em.flush();
      }

      // Emit wallet created event
      const createdEvent = WalletCreated.from(wallet, eventContext);
      await outboxRepo.save(OutboxMessage.enqueue(createdEvent));
      await em.flush();

      return {
        id: wallet.id,
        playerId: wallet.playerId,
        balance: wallet.balance,
        version: wallet.version,
      };
    });
  }

  async getWallet(walletId: string): Promise<Wallet | null> {
    return this.walletRepo.findById(walletId);
  }

  async getWalletByPlayerId(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    return this.walletRepo.findByPlayerIdAndCurrency(playerId, currency);
  }

  async reconcileWallet(walletId: string): Promise<ReconciliationResult> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new Error(`Wallet not found: ${walletId}`);
    }

    const calculatedBalance =
      await this.ledgerRepo.calculateBalanceFromLedger(walletId);
    const checkedEntries = await this.ledgerRepo.countByWalletId(walletId);

    const difference = wallet.balance.subtract(calculatedBalance);
    const consistent = difference.isZero();

    if (!consistent) {
      this.logger.error({
        message: "Wallet reconciliation failed",
        walletId,
        storedBalance: wallet.balance.toJSON(),
        calculatedBalance: calculatedBalance.toJSON(),
        difference: difference.toJSON(),
      });
    }

    return {
      walletId,
      storedBalance: wallet.balance,
      calculatedBalance,
      difference,
      consistent,
      checkedEntries,
    };
  }
}
