import { describe, it, expect } from "bun:test";
import { Wallet } from "./wallet";
import { Money, CurrencyMismatchError } from "../value-objects/money";
import { InsufficientBalanceError } from "../errors/domain-errors";
import { LedgerDirection } from "./wallet-ledger-entry";

describe("Wallet", () => {
  describe("open()", () => {
    it("should create a new wallet with initial balance", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      expect(wallet.id).toBe("wallet-1");
      expect(wallet.playerId).toBe("player-1");
      expect(wallet.currency).toBe("BRL");
      expect(wallet.balance.getAmount()).toBe("1000.00");
      expect(wallet.version).toBe(1);
    });

    it("should create wallet with zero balance", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.zero("BRL"),
      });

      expect(wallet.balance.isZero()).toBe(true);
    });
  });

  describe("debit()", () => {
    it("should debit wallet and create ledger entry", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });
      const initialVersion = wallet.version;

      const result = wallet.debit(
        "tx-1",
        Money.from({ amount: "300.00", currency: "BRL" }),
        "ledger-1",
      );

      expect(wallet.balance.getAmount()).toBe("700.00");
      expect(wallet.version).toBe(initialVersion + 1);
      expect(result.entry.direction).toBe(LedgerDirection.Debit);
      expect(result.entry.money.getAmount()).toBe("300.00");
      expect(result.entry.balanceBefore.getAmount()).toBe("1000.00");
      expect(result.entry.balanceAfter.getAmount()).toBe("700.00");
      expect(result.previousBalance.getAmount()).toBe("1000.00");
    });

    it("should throw InsufficientBalanceError when balance is insufficient", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(() =>
        wallet.debit(
          "tx-1",
          Money.from({ amount: "150.00", currency: "BRL" }),
          "ledger-1",
        ),
      ).toThrow(InsufficientBalanceError);
    });

    it("should throw CurrencyMismatchError for different currency", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      expect(() =>
        wallet.debit(
          "tx-1",
          Money.from({ amount: "100.00", currency: "USD" }),
          "ledger-1",
        ),
      ).toThrow(CurrencyMismatchError);
    });

    it("should allow debit that results in zero balance", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      wallet.debit(
        "tx-1",
        Money.from({ amount: "100.00", currency: "BRL" }),
        "ledger-1",
      );
      expect(wallet.balance.isZero()).toBe(true);
    });
  });

  describe("credit()", () => {
    it("should credit wallet and create ledger entry", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });
      const initialVersion = wallet.version;

      const result = wallet.credit(
        "tx-1",
        Money.from({ amount: "500.00", currency: "BRL" }),
        "ledger-1",
      );

      expect(wallet.balance.getAmount()).toBe("1500.00");
      expect(wallet.version).toBe(initialVersion + 1);
      expect(result.entry.direction).toBe(LedgerDirection.Credit);
      expect(result.entry.money.getAmount()).toBe("500.00");
      expect(result.entry.balanceBefore.getAmount()).toBe("1000.00");
      expect(result.entry.balanceAfter.getAmount()).toBe("1500.00");
    });

    it("should throw CurrencyMismatchError for different currency", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "1000.00", currency: "BRL" }),
      });

      expect(() =>
        wallet.credit(
          "tx-1",
          Money.from({ amount: "100.00", currency: "USD" }),
          "ledger-1",
        ),
      ).toThrow(CurrencyMismatchError);
    });
  });

  describe("canAfford()", () => {
    it("should return true when balance is sufficient", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(
        wallet.canAfford(Money.from({ amount: "50.00", currency: "BRL" })),
      ).toBe(true);
      expect(
        wallet.canAfford(Money.from({ amount: "100.00", currency: "BRL" })),
      ).toBe(true);
    });

    it("should return false when balance is insufficient", () => {
      const wallet = Wallet.open({
        id: "wallet-1",
        playerId: "player-1",
        initialBalance: Money.from({ amount: "100.00", currency: "BRL" }),
      });

      expect(
        wallet.canAfford(Money.from({ amount: "150.00", currency: "BRL" })),
      ).toBe(false);
    });
  });

  describe("rehydrate()", () => {
    it("should reconstruct wallet from state", () => {
      const now = new Date();
      const wallet = Wallet.rehydrate({
        id: "wallet-1",
        playerId: "player-1",
        currency: "BRL",
        balance: Money.from({ amount: "500.00", currency: "BRL" }),
        version: 5,
        createdAt: now,
        updatedAt: now,
      });

      expect(wallet.id).toBe("wallet-1");
      expect(wallet.playerId).toBe("player-1");
      expect(wallet.balance.getAmount()).toBe("500.00");
      expect(wallet.version).toBe(5);
    });
  });
});
