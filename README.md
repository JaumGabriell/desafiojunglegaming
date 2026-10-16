# Processador de Apostas Distribuído

Implementação do desafio técnico da Jungle Gaming: um serviço financeiro para processar apostas recebidas de múltiplos provedores, com foco em correção monetária, idempotência, concorrência e recuperação após falhas.

## Funcionalidades

- Valores monetários exatos com `Decimal.js` e strings decimais.
- Wallet com saldo não negativo e ledger append-only.
- Idempotência persistente por `Idempotency-Key` e hash do payload.
- Lock pessimista por wallet para operações concorrentes.
- Transactional outbox para publicação assíncrona de eventos.
- Inbox persistente para deduplicação de mensagens SQS.
- Tratamento de referências fora de ordem com `PENDING_REFERENCE`.
- Reconciliação do saldo materializado contra o ledger.
- Health checks de liveness e readiness.

## Stack

- Bun 1.x
- NestJS e TypeScript em modo estrito
- PostgreSQL 16
- MikroORM
- AWS SQS em LocalStack
- Docker Compose

## Pré-requisitos

- Bun 1.x
- Docker e Docker Compose

## Setup local

Os comandos da aplicação devem ser executados dentro de `backend/`:

```bash
cd backend
bun install --frozen-lockfile
cp .env.example .env
docker compose up -d postgres localstack
bun run migration:up
```

Para iniciar a API em modo de desenvolvimento:

```bash
bun run start:dev
```

A API fica disponível em `http://localhost:3000`. A infraestrutura cria as filas SQS FIFO durante a inicialização do LocalStack.

Para parar os containers:

```bash
docker compose down
```

## Endpoints principais

| Método | Endpoint | Descrição |
| --- | --- | --- |
| `GET` | `/health/live` | Verifica se o processo está vivo |
| `GET` | `/health/ready` | Verifica a conexão com o PostgreSQL |
| `POST` | `/wallets` | Cria uma wallet |
| `GET` | `/wallets/:walletId` | Consulta uma wallet |
| `GET` | `/wallets/:walletId/ledger` | Consulta o ledger paginado |
| `POST` | `/wallets/:walletId/reconciliation` | Reconcilia wallet e ledger |
| `POST` | `/wagering/transactions` | Processa uma transação de aposta |
| `GET` | `/wagering/transactions/:transactionId` | Consulta uma transação |
| `GET` | `/providers/:providerId/wagering/transactions/:externalTransactionId` | Consulta por identificador externo |

O endpoint `POST /wagering/transactions` exige o header `Idempotency-Key`. `OPENING` é uma transação interna e não pode ser enviada pela API.

Exemplo de criação de wallet:

```bash
curl -X POST http://localhost:3000/wallets \
    -H 'Content-Type: application/json' \
    -d '{
        "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
        "initialBalance": { "amount": "1000.00", "currency": "BRL" }
    }'
```

## Testes e validações

Com PostgreSQL e LocalStack disponíveis, execute:

```bash
# Compilação TypeScript/NestJS
bun run build

# Todas as suítes
bun run test

# Suítes individuais
bun run test:unit
bun run test:integration
bun run test:concurrency
```

Os testes de integração e concorrência usam PostgreSQL real. O cenário de concorrência cobre duas apostas disputando o mesmo saldo, 50 reenvios idênticos, wallets distintas e a reconciliação do saldo pelo ledger.

## Estrutura

```text
backend/
├── src/domain/           # Entidades, value objects e regras de negócio
├── src/application/      # Serviços e casos de uso
├── src/api/              # Controllers e DTOs HTTP
├── src/infrastructure/   # Persistência, SQS e observabilidade
├── test/integration/      # Testes com PostgreSQL
├── test/concurrency/      # Testes de concorrência real
└── ARCHITECTURE.md       # Decisões, trade-offs e limitações
```

## Decisões arquiteturais

As decisões sobre dinheiro, locks, idempotência, inbox/outbox, ledger, autenticação e códigos de falha estão documentadas em [backend/ARCHITECTURE.md](backend/ARCHITECTURE.md).

Autenticação não foi implementada, conforme permitido pelo desafio. Os endpoints de health permanecem públicos e o ponto de extensão para um `AuthGuard` está documentado na arquitetura.

## Scripts úteis

| Comando | Finalidade |
| --- | --- |
| `bun run build` | Compila a aplicação |
| `bun run start:dev` | Inicia com hot reload |
| `bun run migration:up` | Aplica migrations pendentes |
| `bun run migration:down` | Reverte a última migration |
| `bun run docker:up` | Sobe a infraestrutura via Compose |
| `bun run docker:down` | Para a infraestrutura |