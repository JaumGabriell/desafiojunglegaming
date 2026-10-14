import { Money } from "../value-objects/money";

export enum LedgerDirection {
  Debit = "DEBIT",
  Credit = "CREDIT",
}

export interface LedgerEntryState {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
  createdAt: Date;
}

export interface CreateLedgerEntryProps {
  id: string;
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: Money;
  balanceBefore: Money;
  balanceAfter: Money;
}

export class LedgerBalanceError extends Error {
  constructor(
    public readonly balanceBefore: string,
    public readonly amount: string,
    public readonly direction: string,
    public readonly balanceAfter: string,
  ) {
    super(
      `Ledger entry balance mismatch: ${balanceBefore} ${direction === "DEBIT" ? "-" : "+"} ${amount} != ${balanceAfter}`,
    );
    this.name = "LedgerBalanceError";
  }
}

/**
 * WalletLedgerEntry - immutable record of a balance change.
 * No mutable fields, no transition methods.
 * The create factory validates arithmetic consistency.
 */
export class WalletLedgerEntry {
  private constructor(
    public readonly id: string,
    public readonly walletId: string,
    public readonly transactionId: string,
    public readonly direction: LedgerDirection,
    public readonly money: Money,
    public readonly balanceBefore: Money,
    public readonly balanceAfter: Money,
    public readonly createdAt: Date,
  ) {
    // Freeze to enforce structural immutability
    Object.freeze(this);
  }

  /**
   * Creates a new ledger entry with arithmetic validation.
   */
  static create(props: CreateLedgerEntryProps): WalletLedgerEntry {
    const entry = new WalletLedgerEntry(
      props.id,
      props.walletId,
      props.transactionId,
      props.direction,
      props.money,
      props.balanceBefore,
      props.balanceAfter,
      new Date(),
    );

    if (!entry.isBalanced()) {
      throw new LedgerBalanceError(
        props.balanceBefore.getAmount(),
        props.money.getAmount(),
        props.direction,
        props.balanceAfter.getAmount(),
      );
    }

    return entry;
  }

  /**
   * Reconstructs from persistence - no validation.
   */
  static rehydrate(state: LedgerEntryState): WalletLedgerEntry {
    return new WalletLedgerEntry(
      state.id,
      state.walletId,
      state.transactionId,
      state.direction,
      state.money,
      state.balanceBefore,
      state.balanceAfter,
      state.createdAt,
    );
  }

  /**
   * Validates: balanceBefore ± money === balanceAfter
   */
  isBalanced(): boolean {
    const expected =
      this.direction === LedgerDirection.Debit
        ? this.balanceBefore.subtract(this.money)
        : this.balanceBefore.add(this.money);

    return expected.equals(this.balanceAfter);
  }

  toState(): LedgerEntryState {
    return {
      id: this.id,
      walletId: this.walletId,
      transactionId: this.transactionId,
      direction: this.direction,
      money: this.money,
      balanceBefore: this.balanceBefore,
      balanceAfter: this.balanceAfter,
      createdAt: this.createdAt,
    };
  }
}
