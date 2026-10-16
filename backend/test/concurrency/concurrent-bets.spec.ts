import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { Test, TestingModule } from "@nestjs/testing";
import {
  MikroORM,
  EntityManager,
  PostgreSqlDriver,
} from "@mikro-orm/postgresql";
import { MikroOrmModule } from "@mikro-orm/nestjs";
import { ConfigModule } from "@nestjs/config";

import { WalletService } from "../../src/application/services/wallet.service";
import { WagerTransactionService } from "../../src/application/services/wager-transaction.service";
import { MikroOrmWalletRepository } from "../../src/infrastructure/database/repositories/wallet.repository";
import { MikroOrmWagerTransactionRepository } from "../../src/infrastructure/database/repositories/wager-transaction.repository";
import { MikroOrmLedgerRepository } from "../../src/infrastructure/database/repositories/ledger.repository";
import { MikroOrmInboxRepository } from "../../src/infrastructure/database/repositories/inbox.repository";
import { MikroOrmOutboxRepository } from "../../src/infrastructure/database/repositories/outbox.repository";
import { Money } from "../../src/domain/value-objects/money";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../src/domain/entities/wager-transaction";

import { WalletEntity } from "../../src/infrastructure/database/entities/wallet.entity";
import {
  WalletLedgerEntryEntity,
  LedgerDirectionEnum,
} from "../../src/infrastructure/database/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "../../src/infrastructure/database/entities/wager-transaction.entity";
import { InboxMessageEntity } from "../../src/infrastructure/database/entities/inbox-message.entity";
import { OutboxMessageEntity } from "../../src/infrastructure/database/entities/outbox-message.entity";

describe("Concurrency Tests", () => {
  let module: TestingModule;
  let orm: MikroORM;
  let em: EntityManager;
  let walletService: WalletService;
  let wagerService: WagerTransactionService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        MikroOrmModule.forRoot({
          driver: PostgreSqlDriver,
          host: process.env.DATABASE_HOST || "localhost",
          port: parseInt(process.env.DATABASE_PORT || "5432"),
          user: process.env.DATABASE_USER || "wager",
          password: process.env.DATABASE_PASSWORD || "wager123",
          dbName: process.env.DATABASE_NAME || "wager_db_test",
          entities: [
            WalletEntity,
            WalletLedgerEntryEntity,
            WagerTransactionEntity,
            InboxMessageEntity,
            OutboxMessageEntity,
          ],
          allowGlobalContext: true,
        }),
        MikroOrmModule.forFeature([
          WalletEntity,
          WalletLedgerEntryEntity,
          WagerTransactionEntity,
          InboxMessageEntity,
          OutboxMessageEntity,
        ]),
      ],
      providers: [
        WalletService,
        WagerTransactionService,
        MikroOrmWalletRepository,
        MikroOrmWagerTransactionRepository,
        MikroOrmLedgerRepository,
        MikroOrmInboxRepository,
        MikroOrmOutboxRepository,
      ],
    }).compile();

    orm = module.get(MikroORM);
    em = orm.em.fork();
    walletService = module.get(WalletService);
    wagerService = module.get(WagerTransactionService);
  });

  afterAll(async () => {
    await orm.close(true);
    await module.close();
  });

  beforeEach(async () => {
    await em.execute(
      "TRUNCATE wallets, wager_transactions, wallet_ledger_entries, inbox_messages, outbox_messages CASCADE",
    );
  });

  describe("Concurrent Bet Scenario (Section 8)", () => {
    it("should process only one of two 80 BRL bets on 100 BRL balance", async () => {
      // Create wallet with 100 BRL
      const wallet = await walletService.createWallet({
        playerId: "player-1",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      // Submit two concurrent bets of 80 BRL each
      const [result1, result2] = await Promise.all([
        wagerService.processTransaction({
          providerId: "provider-a",
          externalTransactionId: "bet-1",
          idempotencyKey: "provider-a:bet-1",
          playerId: "player-1",
          walletId: wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: "80.00", currency: "BRL" }),
        }),
        wagerService.processTransaction({
          providerId: "provider-a",
          externalTransactionId: "bet-2",
          idempotencyKey: "provider-a:bet-2",
          playerId: "player-1",
          walletId: wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: "80.00", currency: "BRL" }),
        }),
      ]);

      // Count processed and rejected
      const statuses = [result1.status, result2.status];
      const processedCount = statuses.filter(
        (s) => s === WagerTransactionStatus.Processed,
      ).length;
      const rejectedCount = statuses.filter(
        (s) => s === WagerTransactionStatus.Rejected,
      ).length;

      expect(processedCount).toBe(1);
      expect(rejectedCount).toBe(1);

      // Verify final balance
      const finalWallet = await walletService.getWallet(wallet.id);
      expect(finalWallet!.balance.getAmount()).toBe("20.00");

      // Verify exactly one ledger entry
      const ledgerCount = await em.count(WalletLedgerEntryEntity, {
        walletId: wallet.id,
        direction: LedgerDirectionEnum.Debit,
      });
      expect(ledgerCount).toBe(1);
    });
  });

  describe("Same Transaction 50 Times Parallel", () => {
    it("should only create one debit when same bet sent 50 times", async () => {
      const wallet = await walletService.createWallet({
        playerId: "player-1",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      // Send same transaction 50 times in parallel
      const promises = Array.from({ length: 50 }, () =>
        wagerService.processTransaction({
          providerId: "provider-a",
          externalTransactionId: "bet-1",
          idempotencyKey: "provider-a:bet-1",
          playerId: "player-1",
          walletId: wallet.id,
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: "100.00", currency: "BRL" }),
        }),
      );

      const results = await Promise.all(promises);

      // All should return same transaction ID
      const transactionIds = new Set(results.map((r) => r.transactionId));
      expect(transactionIds.size).toBe(1);

      // Most should be idempotent replays
      const replays = results.filter((r) => r.idempotentReplay).length;
      expect(replays).toBe(49);

      // Final balance should be 900
      const finalWallet = await walletService.getWallet(wallet.id);
      expect(finalWallet!.balance.getAmount()).toBe("900.00");

      // Only one ledger entry
      const ledgerCount = await em.count(WalletLedgerEntryEntity, {
        walletId: wallet.id,
        direction: LedgerDirectionEnum.Debit,
      });
      expect(ledgerCount).toBe(1);
    });
  });

  describe("Different Wallets Parallel", () => {
    it("should process different wallets independently", async () => {
      // Create 10 wallets
      const wallets = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          walletService.createWallet({
            playerId: `player-${i}`,
            initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
          }),
        ),
      );

      // Submit bets on all wallets simultaneously
      const results = await Promise.all(
        wallets.map((w, i) =>
          wagerService.processTransaction({
            providerId: "provider-a",
            externalTransactionId: `bet-${i}`,
            idempotencyKey: `provider-a:bet-${i}`,
            playerId: `player-${i}`,
            walletId: w.id,
            roundId: "round-1",
            gameId: "game-1",
            kind: WagerTransactionKind.Bet,
            money: Money.from({ amount: "100.00", currency: "BRL" }),
          }),
        ),
      );

      // All should be processed
      expect(
        results.every((r) => r.status === WagerTransactionStatus.Processed),
      ).toBe(true);

      // All wallets should have 900 BRL
      for (const w of wallets) {
        const updated = await walletService.getWallet(w.id);
        expect(updated!.balance.getAmount()).toBe("900.00");
      }
    });
  });

  describe("Reconciliation Invariant", () => {
    it("should maintain balance = ledger sum after concurrent operations", async () => {
      const wallet = await walletService.createWallet({
        playerId: "player-1",
        initialBalance: Money.from({ amount: "10000.00", currency: "BRL" }),
      });

      // Run many concurrent operations
      const operations = Array.from({ length: 100 }, (_, i) => ({
        kind: i % 3 === 0 ? WagerTransactionKind.Win : WagerTransactionKind.Bet,
        amount: "10.00",
        id: `tx-${i}`,
      }));

      await Promise.all(
        operations.map(
          (op) =>
            wagerService
              .processTransaction({
                providerId: "provider-a",
                externalTransactionId: op.id,
                idempotencyKey: `provider-a:${op.id}`,
                playerId: "player-1",
                walletId: wallet.id,
                roundId: "round-1",
                gameId: "game-1",
                kind: op.kind,
                money: Money.from({ amount: op.amount, currency: "BRL" }),
              })
              .catch(() => {}), // Ignore rejections
        ),
      );

      // Reconcile
      const result = await walletService.reconcileWallet(wallet.id);

      expect(result.consistent).toBe(true);
      expect(result.storedBalance.equals(result.calculatedBalance)).toBe(true);
    });
  });
});
