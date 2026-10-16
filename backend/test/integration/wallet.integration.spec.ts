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
import { FailureCode } from "../../src/domain/errors/domain-errors";

import { WalletEntity } from "../../src/infrastructure/database/entities/wallet.entity";
import { WalletLedgerEntryEntity } from "../../src/infrastructure/database/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "../../src/infrastructure/database/entities/wager-transaction.entity";
import { InboxMessageEntity } from "../../src/infrastructure/database/entities/inbox-message.entity";
import { OutboxMessageEntity } from "../../src/infrastructure/database/entities/outbox-message.entity";

describe("Wallet Integration Tests", () => {
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
    // Clean database before each test
    await em.execute(
      "TRUNCATE wallets, wager_transactions, wallet_ledger_entries, inbox_messages, outbox_messages CASCADE",
    );
  });

  describe("Wallet Creation", () => {
    it("should create wallet with initial balance", async () => {
      const result = await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      expect(result.id).toBeDefined();
      expect(result.playerId).toBe("00000000-0000-0000-0000-000000000001");
      expect(result.balance.getAmount()).toBe("1000.00");
      expect(result.version).toBe(1);
    });

    it("should create wallet with zero balance", async () => {
      const result = await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.zero("BRL"),
      });

      expect(result.balance.isZero()).toBe(true);
      expect(result.version).toBe(1);
    });

    it("should reject duplicate wallet for same player+currency", async () => {
      await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      await expect(
        walletService.createWallet({
          playerId: "00000000-0000-0000-0000-000000000001",
          initialBalance: Money.from({ amount: "500.00", currency: "BRL" }),
        }),
      ).rejects.toThrow(/already exists/);
    });

    it("should allow same player with different currencies", async () => {
      const brl = await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      const usd = await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.from({ amount: "500.00", currency: "USD" }),
      });

      expect(brl.balance.currency).toBe("BRL");
      expect(usd.balance.currency).toBe("USD");
    });
  });

  describe("Transaction Processing", () => {
    let walletId: string;

    beforeEach(async () => {
      const wallet = await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });
      walletId = wallet.id;
    });

    it("should process BET transaction", async () => {
      const result = await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.getAmount()).toBe("900.00");
      expect(result.idempotentReplay).toBe(false);
    });

    it("should reject BET with insufficient balance", async () => {
      const result = await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "2000.00", currency: "BRL" }),
      });

      expect(result.status).toBe(WagerTransactionStatus.Rejected);
      expect(result.failureCode).toBe(FailureCode.INSUFFICIENT_BALANCE);
      expect(result.balance.getAmount()).toBe("1000.00");
    });

    it("should process WIN transaction", async () => {
      // First bet
      await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      // Then win
      const result = await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "win-1",
        idempotencyKey: "provider-a:win-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Win,
        money: Money.from({ amount: "200.00", currency: "BRL" }),
      });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.getAmount()).toBe("1100.00");
    });

    it("should process LOSS without affecting balance", async () => {
      // First bet
      await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      // Then loss
      const result = await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "loss-1",
        idempotencyKey: "provider-a:loss-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Loss,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(result.status).toBe(WagerTransactionStatus.Processed);
      expect(result.balance.getAmount()).toBe("900.00"); // Still 900, LOSS doesn't change balance
    });
  });

  describe("Idempotency", () => {
    let walletId: string;

    beforeEach(async () => {
      const wallet = await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });
      walletId = wallet.id;
    });

    it("should return same result for duplicate request", async () => {
      const first = await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const second = await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(second.transactionId).toBe(first.transactionId);
      expect(second.idempotentReplay).toBe(true);
    });

    it("should reject same key with different payload", async () => {
      await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      await expect(
        wagerService.processTransaction({
          providerId: "provider-a",
          externalTransactionId: "bet-1",
          idempotencyKey: "provider-a:bet-1",
          playerId: "00000000-0000-0000-0000-000000000001",
          walletId,
          roundId: "round-1",
          gameId: "game-1",
          kind: WagerTransactionKind.Bet,
          money: Money.from({ amount: "200.00", currency: "BRL" }), // Different amount
        }),
      ).rejects.toThrow(/conflict/i);
    });
  });

  describe("Reconciliation", () => {
    it("should show consistent balance", async () => {
      const wallet = await walletService.createWallet({
        playerId: "00000000-0000-0000-0000-000000000001",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      await wagerService.processTransaction({
        providerId: "provider-a",
        externalTransactionId: "bet-1",
        idempotencyKey: "provider-a:bet-1",
        playerId: "00000000-0000-0000-0000-000000000001",
        walletId: wallet.id,
        roundId: "round-1",
        gameId: "game-1",
        kind: WagerTransactionKind.Bet,
        money: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      const result = await walletService.reconcileWallet(wallet.id);

      expect(result.consistent).toBe(true);
      expect(result.storedBalance.getAmount()).toBe("900.00");
      expect(result.calculatedBalance.getAmount()).toBe("900.00");
      expect(result.difference.isZero()).toBe(true);
    });
  });
});
