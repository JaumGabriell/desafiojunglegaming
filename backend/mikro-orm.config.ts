import { defineConfig } from "@mikro-orm/postgresql";
import { TsMorphMetadataProvider } from "@mikro-orm/reflection";

import { WalletEntity } from "./src/infrastructure/database/entities/wallet.entity";
import { WalletLedgerEntryEntity } from "./src/infrastructure/database/entities/wallet-ledger-entry.entity";
import { WagerTransactionEntity } from "./src/infrastructure/database/entities/wager-transaction.entity";
import { InboxMessageEntity } from "./src/infrastructure/database/entities/inbox-message.entity";
import { OutboxMessageEntity } from "./src/infrastructure/database/entities/outbox-message.entity";

export default defineConfig({
  host: process.env.DATABASE_HOST || "localhost",
  port: parseInt(process.env.DATABASE_PORT || "5432"),
  user: process.env.DATABASE_USER || "wager",
  password: process.env.DATABASE_PASSWORD || "wager123",
  dbName: process.env.DATABASE_NAME || "wager_db",
  entities: [
    WalletEntity,
    WalletLedgerEntryEntity,
    WagerTransactionEntity,
    InboxMessageEntity,
    OutboxMessageEntity,
  ],
  metadataProvider: TsMorphMetadataProvider,
  migrations: {
    path: "./src/infrastructure/database/migrations",
    pathTs: "./src/infrastructure/database/migrations",
  },
  debug: process.env.NODE_ENV === "development",
});
