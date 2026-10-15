import { v4 as uuidv4 } from "uuid";
import { IntegrationEvent, IntegrationEventProps } from "./integration-event";
import { MoneyProps } from "../value-objects/money";
import { LedgerDirection } from "../entities/wallet-ledger-entry";
import { Wallet } from "../entities/wallet";
import { WalletLedgerEntry } from "../entities/wallet-ledger-entry";

export interface EventContext {
  correlationId: string;
  causationId?: string;
}

export interface WalletBalanceChangedData {
  walletId: string;
  transactionId: string;
  direction: LedgerDirection;
  money: MoneyProps;
  balanceBefore: MoneyProps;
  balanceAfter: MoneyProps;
  walletVersion: number;
}

/**
 * Event emitted when a wallet balance changes.
 */
export class WalletBalanceChanged extends IntegrationEvent<WalletBalanceChangedData> {
  readonly eventType = "WalletBalanceChanged";
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WalletBalanceChangedData>) {
    super(props);
  }

  static from(
    wallet: Wallet,
    entry: WalletLedgerEntry,
    ctx: EventContext,
  ): WalletBalanceChanged {
    return new WalletBalanceChanged({
      eventId: uuidv4(),
      aggregateId: wallet.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        walletId: wallet.id,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        walletVersion: wallet.version,
      },
    });
  }
}

export interface WalletCreatedData {
  walletId: string;
  playerId: string;
  currency: string;
  initialBalance: MoneyProps;
}

/**
 * Event emitted when a new wallet is created.
 */
export class WalletCreated extends IntegrationEvent<WalletCreatedData> {
  readonly eventType = "WalletCreated";
  readonly version = 1;

  private constructor(props: IntegrationEventProps<WalletCreatedData>) {
    super(props);
  }

  static from(wallet: Wallet, ctx: EventContext): WalletCreated {
    return new WalletCreated({
      eventId: uuidv4(),
      aggregateId: wallet.id,
      correlationId: ctx.correlationId,
      causationId: ctx.causationId,
      occurredAt: new Date(),
      data: {
        walletId: wallet.id,
        playerId: wallet.playerId,
        currency: wallet.currency,
        initialBalance: wallet.balance.toJSON(),
      },
    });
  }
}
