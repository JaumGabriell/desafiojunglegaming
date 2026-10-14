import { describe, it, expect } from "bun:test";
import {
  WagerTransaction,
  WagerTransactionKind,
  WagerTransactionStatus,
} from "./wager-transaction";
import { Money } from "../value-objects/money";
import {
  MissingReferenceError,
  InvalidTransactionStateError,
  FailureCode,
} from "../errors/domain-errors";

describe("WagerTransaction", () => {
  const createBasicProps = (
    kind: WagerTransactionKind,
    referenceExternalTransactionId?: string,
  ) => ({
    id: "tx-1",
    providerId: "provider-a",
    externalTransactionId: "ext-tx-1",
    idempotencyKey: "provider-a:ext-tx-1",
    payloadHash: "hash123",
    walletId: "wallet-1",
    playerId: "player-1",
    roundId: "round-1",
    gameId: "game-1",
    kind,
    money: Money.from({ amount: "100.00", currency: "BRL" }),
    referenceExternalTransactionId,
  });

  describe("create()", () => {
    it("should create BET transaction", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );

      expect(tx.id).toBe("tx-1");
      expect(tx.kind).toBe(WagerTransactionKind.Bet);
      expect(tx.status).toBe(WagerTransactionStatus.Pending);
      expect(tx.isTerminal()).toBe(false);
    });

    it("should create WIN transaction", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Win),
      );
      expect(tx.kind).toBe(WagerTransactionKind.Win);
    });

    it("should create LOSS transaction", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Loss),
      );
      expect(tx.kind).toBe(WagerTransactionKind.Loss);
      expect(tx.affectsBalance()).toBe(false);
    });

    it("should create REFUND transaction with reference", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Refund, "ref-tx-1"),
      );
      expect(tx.kind).toBe(WagerTransactionKind.Refund);
      expect(tx.referenceExternalTransactionId).toBe("ref-tx-1");
    });

    it("should throw MissingReferenceError for REFUND without reference", () => {
      expect(() =>
        WagerTransaction.create(createBasicProps(WagerTransactionKind.Refund)),
      ).toThrow(MissingReferenceError);
    });

    it("should throw MissingReferenceError for ROLLBACK without reference", () => {
      expect(() =>
        WagerTransaction.create(
          createBasicProps(WagerTransactionKind.Rollback),
        ),
      ).toThrow(MissingReferenceError);
    });
  });

  describe("requiresReference()", () => {
    it("should return true for REFUND", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Refund, "ref-tx-1"),
      );
      expect(tx.requiresReference()).toBe(true);
    });

    it("should return true for ROLLBACK", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Rollback, "ref-tx-1"),
      );
      expect(tx.requiresReference()).toBe(true);
    });

    it("should return false for BET", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );
      expect(tx.requiresReference()).toBe(false);
    });
  });

  describe("affectsBalance()", () => {
    it("should return true for BET", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );
      expect(tx.affectsBalance()).toBe(true);
    });

    it("should return true for WIN", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Win),
      );
      expect(tx.affectsBalance()).toBe(true);
    });

    it("should return false for LOSS", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Loss),
      );
      expect(tx.affectsBalance()).toBe(false);
    });
  });

  describe("state transitions", () => {
    it("should transition to PROCESSED", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );
      const now = new Date();

      tx.markProcessed(undefined, now);

      expect(tx.status).toBe(WagerTransactionStatus.Processed);
      expect(tx.processedAt).toEqual(now);
      expect(tx.isTerminal()).toBe(true);
    });

    it("should transition to PENDING_REFERENCE", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Refund, "ref-tx-1"),
      );

      tx.markPendingReference();

      expect(tx.status).toBe(WagerTransactionStatus.PendingReference);
      expect(tx.isTerminal()).toBe(false);
    });

    it("should transition to REJECTED", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );

      tx.reject(FailureCode.INSUFFICIENT_BALANCE);

      expect(tx.status).toBe(WagerTransactionStatus.Rejected);
      expect(tx.failureCode).toBe(FailureCode.INSUFFICIENT_BALANCE);
      expect(tx.isTerminal()).toBe(true);
    });

    it("should transition to FAILED", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );

      tx.fail(FailureCode.DATABASE_ERROR);

      expect(tx.status).toBe(WagerTransactionStatus.Failed);
      expect(tx.failureCode).toBe(FailureCode.DATABASE_ERROR);
      expect(tx.isTerminal()).toBe(true);
    });

    it("should throw on transition from terminal state", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );
      tx.markProcessed(undefined, new Date());

      expect(() => tx.reject(FailureCode.INSUFFICIENT_BALANCE)).toThrow(
        InvalidTransactionStateError,
      );
    });
  });

  describe("matchesPayload()", () => {
    it("should return true for matching hash", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );
      expect(tx.matchesPayload("hash123")).toBe(true);
    });

    it("should return false for non-matching hash", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Bet),
      );
      expect(tx.matchesPayload("different-hash")).toBe(false);
    });
  });

  describe("getAllowedReferenceKinds()", () => {
    it("should return BET for REFUND", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Refund, "ref-tx-1"),
      );
      const allowed = tx.getAllowedReferenceKinds();
      expect(allowed.has(WagerTransactionKind.Bet)).toBe(true);
      expect(allowed.size).toBe(1);
    });

    it("should return BET, WIN, REFUND for ROLLBACK", () => {
      const tx = WagerTransaction.create(
        createBasicProps(WagerTransactionKind.Rollback, "ref-tx-1"),
      );
      const allowed = tx.getAllowedReferenceKinds();
      expect(allowed.has(WagerTransactionKind.Bet)).toBe(true);
      expect(allowed.has(WagerTransactionKind.Win)).toBe(true);
      expect(allowed.has(WagerTransactionKind.Refund)).toBe(true);
      expect(allowed.size).toBe(3);
    });
  });
});
