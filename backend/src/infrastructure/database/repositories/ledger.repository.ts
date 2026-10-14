import { EntityManager } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import {
  WalletLedgerEntryEntity,
  LedgerDirectionEnum,
} from "../entities/wallet-ledger-entry.entity";
import {
  WalletLedgerEntry,
  LedgerEntryState,
  LedgerDirection,
} from "../../../domain/entities/wallet-ledger-entry";
import { Money } from "../../../domain/value-objects/money";

export interface LedgerRepository {
  save(entry: WalletLedgerEntry): Promise<void>;
  findByWalletId(
    walletId: string,
    cursor?: string,
    limit?: number,
  ): Promise<WalletLedgerEntry[]>;
  calculateBalanceFromLedger(walletId: string): Promise<Money>;
  countByWalletId(walletId: string): Promise<number>;
}

@Injectable()
export class MikroOrmLedgerRepository implements LedgerRepository {
  constructor(private readonly em: EntityManager) {}

  async save(entry: WalletLedgerEntry): Promise<void> {
    const state = entry.toState();
    const entity = this.em.create(WalletLedgerEntryEntity, {
      id: state.id,
      walletId: state.walletId,
      transactionId: state.transactionId,
      direction: this.toDirectionEnum(state.direction),
      amount: state.money.getAmount(),
      currency: state.money.currency,
      balanceBeforeAmount: state.balanceBefore.getAmount(),
      balanceAfterAmount: state.balanceAfter.getAmount(),
      createdAt: state.createdAt,
    });
    this.em.persist(entity);
  }

  async findByWalletId(
    walletId: string,
    cursor?: string,
    limit = 50,
  ): Promise<WalletLedgerEntry[]> {
    const qb = this.em
      .createQueryBuilder(WalletLedgerEntryEntity, "e")
      .where({ walletId })
      .orderBy({ createdAt: "DESC", id: "DESC" })
      .limit(limit);

    if (cursor) {
      // Cursor is the ID of the last item from the previous page
      const cursorEntry = await this.em.findOne(WalletLedgerEntryEntity, {
        id: cursor,
      });
      if (cursorEntry) {
        qb.andWhere({
          $or: [
            { createdAt: { $lt: cursorEntry.createdAt } },
            {
              createdAt: cursorEntry.createdAt,
              id: { $lt: cursor },
            },
          ],
        });
      }
    }

    const entities = await qb.getResultList();
    return entities.map((e) => this.toDomain(e));
  }

  async calculateBalanceFromLedger(walletId: string): Promise<Money> {
    const result = await this.em
      .getConnection()
      .execute<{ currency: string; balance: string }[]>(
        `SELECT 
        currency,
        COALESCE(
          SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END),
          0
        )::numeric(20,2) as balance
       FROM wallet_ledger_entries
       WHERE wallet_id = ?
       GROUP BY currency`,
        [walletId],
      );

    if (result.length === 0) {
      // No entries yet, need to get currency from wallet
      const wallet = await this.em
        .getConnection()
        .execute<
          { currency: string }[]
        >(`SELECT currency FROM wallets WHERE id = ?`, [walletId]);
      if (wallet.length === 0) {
        return Money.zero("BRL");
      }
      return Money.zero(wallet[0].currency);
    }

    return Money.rehydrate(result[0].balance, result[0].currency);
  }

  async countByWalletId(walletId: string): Promise<number> {
    return this.em.count(WalletLedgerEntryEntity, { walletId });
  }

  private toDomain(entity: WalletLedgerEntryEntity): WalletLedgerEntry {
    const state: LedgerEntryState = {
      id: entity.id,
      walletId: entity.walletId,
      transactionId: entity.transactionId,
      direction: this.toDirectionDomain(entity.direction),
      money: Money.rehydrate(entity.amount, entity.currency),
      balanceBefore: Money.rehydrate(
        entity.balanceBeforeAmount,
        entity.currency,
      ),
      balanceAfter: Money.rehydrate(entity.balanceAfterAmount, entity.currency),
      createdAt: entity.createdAt,
    };
    return WalletLedgerEntry.rehydrate(state);
  }

  private toDirectionEnum(direction: LedgerDirection): LedgerDirectionEnum {
    return direction === LedgerDirection.Debit
      ? LedgerDirectionEnum.Debit
      : LedgerDirectionEnum.Credit;
  }

  private toDirectionDomain(direction: LedgerDirectionEnum): LedgerDirection {
    return direction === LedgerDirectionEnum.Debit
      ? LedgerDirection.Debit
      : LedgerDirection.Credit;
  }
}
