import { EntityManager, LockMode } from "@mikro-orm/postgresql";
import { Injectable } from "@nestjs/common";
import { WalletEntity } from "../entities/wallet.entity";
import { Wallet, WalletState } from "../../../domain/entities/wallet";
import { Money } from "../../../domain/value-objects/money";
import { ConcurrencyConflictError } from "../../../domain/errors/domain-errors";

export interface WalletRepository {
  findById(id: string, lock?: boolean): Promise<Wallet | null>;
  findByPlayerIdAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null>;
  save(wallet: Wallet): Promise<void>;
  saveWithOptimisticLock(
    wallet: Wallet,
    expectedVersion: number,
  ): Promise<void>;
}

@Injectable()
export class MikroOrmWalletRepository implements WalletRepository {
  constructor(private readonly em: EntityManager) {}

  async findById(id: string, lock = false): Promise<Wallet | null> {
    const entity = await this.em.findOne(
      WalletEntity,
      { id },
      lock ? { lockMode: LockMode.PESSIMISTIC_WRITE } : undefined,
    );

    if (!entity) return null;

    return this.toDomain(entity);
  }

  async findByPlayerIdAndCurrency(
    playerId: string,
    currency: string,
  ): Promise<Wallet | null> {
    const entity = await this.em.findOne(WalletEntity, {
      playerId,
      currency: currency.toUpperCase(),
    });

    if (!entity) return null;

    return this.toDomain(entity);
  }

  async save(wallet: Wallet): Promise<void> {
    const state = wallet.toState();
    let entity = await this.em.findOne(WalletEntity, { id: wallet.id });

    if (entity) {
      entity.balanceAmount = state.balance.getAmount();
      entity.version = state.version;
      entity.updatedAt = state.updatedAt;
    } else {
      entity = this.em.create(WalletEntity, {
        id: state.id,
        playerId: state.playerId,
        currency: state.currency,
        balanceAmount: state.balance.getAmount(),
        version: state.version,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
      });
      this.em.persist(entity);
    }
  }

  async saveWithOptimisticLock(
    wallet: Wallet,
    expectedVersion: number,
  ): Promise<void> {
    const state = wallet.toState();

    // Use nativeUpdate for atomic conditional update with optimistic locking
    const affectedRows = await this.em.nativeUpdate(
      WalletEntity,
      { id: wallet.id, version: expectedVersion },
      {
        balanceAmount: state.balance.getAmount(),
        version: state.version,
        updatedAt: state.updatedAt,
      },
    );

    if (affectedRows === 0) {
      throw new ConcurrencyConflictError("Wallet", wallet.id);
    }
  }

  private toDomain(entity: WalletEntity): Wallet {
    const state: WalletState = {
      id: entity.id,
      playerId: entity.playerId,
      currency: entity.currency,
      balance: Money.rehydrate(entity.balanceAmount, entity.currency),
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };

    return Wallet.rehydrate(state);
  }
}
