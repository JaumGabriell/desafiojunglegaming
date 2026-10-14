import { Migration } from "@mikro-orm/migrations";

export class Migration20240101000000_initial extends Migration {
  async up(): Promise<void> {
    // Create enum types
    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE ledger_direction AS ENUM ('DEBIT', 'CREDIT');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE wager_transaction_kind AS ENUM ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    this.addSql(`
      DO $$ BEGIN
        CREATE TYPE wager_transaction_status AS ENUM ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Create wallets table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallets (
        id UUID PRIMARY KEY,
        player_id UUID NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance_amount NUMERIC(20, 2) NOT NULL DEFAULT 0.00,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT wallets_player_currency_unique UNIQUE (player_id, currency),
        CONSTRAINT wallets_balance_non_negative CHECK (balance_amount >= 0)
      );
    `);

    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wallets_player_id ON wallets (player_id);`,
    );

    // Create wager_transactions table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wager_transactions (
        id UUID PRIMARY KEY,
        provider_id VARCHAR(100) NOT NULL,
        external_transaction_id VARCHAR(255) NOT NULL,
        idempotency_key VARCHAR(500) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        player_id UUID NOT NULL,
        round_id VARCHAR(255) NOT NULL,
        game_id VARCHAR(255) NOT NULL,
        kind wager_transaction_kind NOT NULL,
        amount NUMERIC(20, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        reference_external_transaction_id VARCHAR(255),
        status wager_transaction_status NOT NULL DEFAULT 'PENDING',
        reference_transaction_id UUID,
        failure_code VARCHAR(100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_retry_at TIMESTAMPTZ,
        CONSTRAINT wager_transactions_idempotency_key_unique UNIQUE (idempotency_key),
        CONSTRAINT wager_transactions_provider_external_unique UNIQUE (provider_id, external_transaction_id),
        CONSTRAINT wager_transactions_amount_non_negative CHECK (amount >= 0)
      );
    `);

    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wager_transactions_wallet_id ON wager_transactions (wallet_id);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wager_transactions_provider_id ON wager_transactions (provider_id);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wager_transactions_player_id ON wager_transactions (player_id);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wager_transactions_status ON wager_transactions (status);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wager_transactions_round_id ON wager_transactions (round_id);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wager_transactions_created_at ON wager_transactions (wallet_id, created_at);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_wager_transactions_pending_reference ON wager_transactions (status, last_retry_at) WHERE status = 'PENDING_REFERENCE';`,
    );

    // Create wallet_ledger_entries table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS wallet_ledger_entries (
        id UUID PRIMARY KEY,
        wallet_id UUID NOT NULL REFERENCES wallets(id),
        transaction_id UUID NOT NULL REFERENCES wager_transactions(id),
        direction ledger_direction NOT NULL,
        amount NUMERIC(20, 2) NOT NULL,
        currency VARCHAR(3) NOT NULL,
        balance_before_amount NUMERIC(20, 2) NOT NULL,
        balance_after_amount NUMERIC(20, 2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT ledger_entries_amount_non_negative CHECK (amount >= 0),
        CONSTRAINT ledger_entries_balance_before_non_negative CHECK (balance_before_amount >= 0),
        CONSTRAINT ledger_entries_balance_after_non_negative CHECK (balance_after_amount >= 0)
      );
    `);

    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_id ON wallet_ledger_entries (wallet_id);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_ledger_entries_transaction_id ON wallet_ledger_entries (transaction_id);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_ledger_entries_wallet_created ON wallet_ledger_entries (wallet_id, created_at);`,
    );

    // Create inbox_messages table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        message_id VARCHAR(255) NOT NULL,
        consumer_name VARCHAR(100) NOT NULL,
        payload_hash VARCHAR(64) NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at TIMESTAMPTZ,
        PRIMARY KEY (consumer_name, message_id)
      );
    `);

    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_processed_at ON inbox_messages (processed_at);`,
    );

    // Create outbox_messages table
    this.addSql(`
      CREATE TABLE IF NOT EXISTS outbox_messages (
        id UUID PRIMARY KEY,
        aggregate_id UUID NOT NULL,
        event_type VARCHAR(100) NOT NULL,
        payload JSONB NOT NULL,
        occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TIMESTAMPTZ,
        published_at TIMESTAMPTZ
      );
    `);

    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_outbox_messages_aggregate_id ON outbox_messages (aggregate_id);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_outbox_messages_published_at ON outbox_messages (published_at);`,
    );
    this.addSql(
      `CREATE INDEX IF NOT EXISTS idx_outbox_messages_pending ON outbox_messages (next_attempt_at) WHERE published_at IS NULL;`,
    );

    // Create function for tracking reversal uniqueness
    this.addSql(`
      CREATE OR REPLACE FUNCTION check_reversal_uniqueness()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.kind IN ('REFUND', 'ROLLBACK') AND NEW.status = 'PROCESSED' THEN
          IF EXISTS (
            SELECT 1 FROM wager_transactions
            WHERE reference_transaction_id = NEW.reference_transaction_id
            AND id != NEW.id
            AND kind = NEW.kind
            AND status = 'PROCESSED'
          ) THEN
            RAISE EXCEPTION 'Reference transaction already reversed by %', NEW.kind;
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    this.addSql(`
      DROP TRIGGER IF EXISTS trg_check_reversal_uniqueness ON wager_transactions;
      CREATE TRIGGER trg_check_reversal_uniqueness
      BEFORE INSERT OR UPDATE ON wager_transactions
      FOR EACH ROW
      EXECUTE FUNCTION check_reversal_uniqueness();
    `);
  }

  async down(): Promise<void> {
    this.addSql(
      `DROP TRIGGER IF EXISTS trg_check_reversal_uniqueness ON wager_transactions;`,
    );
    this.addSql(`DROP FUNCTION IF EXISTS check_reversal_uniqueness;`);
    this.addSql(`DROP TABLE IF EXISTS outbox_messages;`);
    this.addSql(`DROP TABLE IF EXISTS inbox_messages;`);
    this.addSql(`DROP TABLE IF EXISTS wallet_ledger_entries;`);
    this.addSql(`DROP TABLE IF EXISTS wager_transactions;`);
    this.addSql(`DROP TABLE IF EXISTS wallets;`);
    this.addSql(`DROP TYPE IF EXISTS wager_transaction_status;`);
    this.addSql(`DROP TYPE IF EXISTS wager_transaction_kind;`);
    this.addSql(`DROP TYPE IF EXISTS ledger_direction;`);
  }
}
