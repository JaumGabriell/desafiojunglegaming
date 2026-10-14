import { Money, CurrencyMismatchError } from "../value-objects/money";
import {
  InsufficientBalanceError,
  NegativeBalanceError,
} from "../errors/domain-errors";
import {
  WalletLedgerEntry,
  LedgerDirection,
  CreateLedgerEntryProps,
} from "./wallet-ledger-entry";

export interface WalletState {
  id: string;
  playerId: string;
  currency: string;
  balance: Money;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface OpenWalletProps {
  id: string;
  playerId: string;
  initialBalance: Money;
}

export interface DebitResult {
  entry: WalletLedgerEntry;
  previousBalance: Money;
}

export interface CreditResult {
  entry: WalletLedgerEntry;
  previousBalance: Money;
}

/**
 * Wallet Aggregate Root - manages player's balance with strict invariants:
 * - No negative balance
 * - One wallet per player+currency
 * - All balance changes produce ledger entries
 * - Version increments only on balance changes (for optimistic locking)
 */
export class Wallet {
  private constructor(
    public readonly id: string,
    public readonly playerId: string,
    public readonly currency: string,
    private _balance: Money,
    private _version: number,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  /**
   * Opens a new wallet with initial balance.
   */
  static open(props: OpenWalletProps): Wallet {
    const now = new Date();
    return new Wallet(
      props.id,
      props.playerId,
      props.initialBalance.currency,
      props.initialBalance,
      1,
      now,
      now,
    );
  }

  /**
   * Reconstructs wallet from persistence - no validation of transitions.
   */
  static rehydrate(state: WalletState): Wallet {
    return new Wallet(
      state.id,
      state.playerId,
      state.currency,
      state.balance,
      state.version,
      state.createdAt,
      state.updatedAt,
    );
  }

  get balance(): Money {
    return this._balance;
  }

  get version(): number {
    return this._version;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /**
   * Debits the wallet, creating a ledger entry.
   * Throws InsufficientBalanceError if balance would go negative.
   */
  debit(
    transactionId: string,
    amount: Money,
    ledgerEntryId: string,
  ): DebitResult {
    this.assertSameCurrency(amount);

    const previousBalance = this._balance;
    const newBalance = this._balance.subtract(amount);

    if (newBalance.isNegative()) {
      throw new InsufficientBalanceError(
        this.id,
        this._balance.getAmount(),
        amount.getAmount(),
      );
    }

    const entry = WalletLedgerEntry.create({
      id: ledgerEntryId,
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Debit,
      money: amount,
      balanceBefore: previousBalance,
      balanceAfter: newBalance,
    });

    this._balance = newBalance;
    this._version++;
    this._updatedAt = new Date();

    return { entry, previousBalance };
  }

  /**
   * Credits the wallet, creating a ledger entry.
   */
  credit(
    transactionId: string,
    amount: Money,
    ledgerEntryId: string,
  ): CreditResult {
    this.assertSameCurrency(amount);

    const previousBalance = this._balance;
    const newBalance = this._balance.add(amount);

    const entry = WalletLedgerEntry.create({
      id: ledgerEntryId,
      walletId: this.id,
      transactionId,
      direction: LedgerDirection.Credit,
      money: amount,
      balanceBefore: previousBalance,
      balanceAfter: newBalance,
    });

    this._balance = newBalance;
    this._version++;
    this._updatedAt = new Date();

    return { entry, previousBalance };
  }

  /**
   * Applies a reversal (refund/rollback) that restores balance.
   * Validates that the reversal won't cause negative balance.
   */
  applyReversal(
    transactionId: string,
    amount: Money,
    direction: LedgerDirection,
    ledgerEntryId: string,
  ): WalletLedgerEntry {
    this.assertSameCurrency(amount);

    const previousBalance = this._balance;
    let newBalance: Money;

    if (direction === LedgerDirection.Credit) {
      newBalance = this._balance.add(amount);
    } else {
      newBalance = this._balance.subtract(amount);
      if (newBalance.isNegative()) {
        throw new NegativeBalanceError(
          this.id,
          this._balance.getAmount(),
          "ROLLBACK",
          amount.getAmount(),
        );
      }
    }

    const entry = WalletLedgerEntry.create({
      id: ledgerEntryId,
      walletId: this.id,
      transactionId,
      direction,
      money: amount,
      balanceBefore: previousBalance,
      balanceAfter: newBalance,
    });

    this._balance = newBalance;
    this._version++;
    this._updatedAt = new Date();

    return entry;
  }

  /**
   * Checks if the wallet can afford a debit of the given amount.
   */
  canAfford(amount: Money): boolean {
    this.assertSameCurrency(amount);
    return !this._balance.subtract(amount).isNegative();
  }

  private assertSameCurrency(money: Money): void {
    if (this.currency !== money.currency) {
      throw new CurrencyMismatchError(this.currency, money.currency);
    }
  }

  toState(): WalletState {
    return {
      id: this.id,
      playerId: this.playerId,
      currency: this.currency,
      balance: this._balance,
      version: this._version,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
    };
  }
}
