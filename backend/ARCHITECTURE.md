# Documentação de Arquitetura

## Visão geral

Este é um processador distribuído de apostas construído com NestJS, MikroORM, PostgreSQL e AWS SQS (via LocalStack). O sistema processa transações de apostas de múltiplos provedores de jogos, mantendo correção financeira, idempotência e consistência entre múltiplas instâncias.

## Decisões de projeto

### 1. Representação monetária

**Decisão**: Usar `Decimal.js` com serialização em string, nunca `number` ou `float`.

**Justificativa**:

- O tipo `number` do JavaScript usa ponto flutuante IEEE 754, que não representa precisamente todos os valores decimais
- `0.1 + 0.2 !== 0.3` em JavaScript, o que é inaceitável para cálculos financeiros
- `Decimal.js` fornece aritmética de precisão arbitrária
- Os valores são armazenados como `NUMERIC(20,2)` no PostgreSQL para garantir armazenamento decimal exato
- Todos os contratos externos usam o formato string (`"25.00"`) para evitar problemas de ponto flutuante no JSON

**Trade-offs**:

- Código um pouco mais verboso
- Exige conversão explícita nas fronteiras
- O custo é justificável pela correção

### 2. Escolha do ORM: MikroORM

**Decisão**: Usar MikroORM em vez de TypeORM.

**Justificativa**:

- Padrão Unit of Work explícito: alterações são rastreadas e persistidas juntas
- Identity Map evita instâncias duplicadas de entidades
- `EntityManager.transactional()` define fronteiras transacionais claras
- `LockMode.PESSIMISTIC_WRITE` permite bloqueio em nível de linha
- Melhor suporte ao TypeScript em modo estrito

**Trade-offs**:

- Menor adoção pela comunidade que o TypeORM
- Curva de aprendizado do padrão Unit of Work
- Exige gerenciamento mais explícito das entidades

### 3. Estratégia de concorrência

**Decisão**: Abordagem híbrida com bloqueio pessimista nas operações críticas.

**Implementação**:

- **Atualizações da wallet**: `SELECT ... FOR UPDATE` bloqueia a linha da wallet durante alterações de saldo
- **Bloqueio otimista**: a coluna `version` nas wallets detecta modificações concorrentes
- **Retry com backoff**: até 5 tentativas com backoff exponencial em caso de conflito
- **Claim da outbox**: `SELECT ... FOR UPDATE SKIP LOCKED` garante segurança entre publishers concorrentes

**Por que não usar apenas bloqueio otimista?**

- Wallets muito disputadas causariam retries excessivos
- A duração do bloqueio pessimista é curta (uma única transação)
- Comportamento previsível sob carga

**Por que não usar apenas bloqueio pessimista?**

- O campo de versão fornece uma camada adicional de segurança
- Permite detectar bugs da aplicação que ignorem o bloqueio

### 4. Implementação da idempotência

**Decisão**: Idempotência baseada no banco de dados, com verificação do hash do payload.

**Componentes**:

- `idempotency_key`: constraint de unicidade em `wager_transactions`
- `payload_hash`: SHA-256 do payload JSON canônico
- `inbox_messages`: deduplicação das mensagens SQS

**Fluxo**:

1. Verificar se `idempotency_key` existe
2. Se existir, comparar `payload_hash`
   - Igual: retornar o resultado armazenado (`idempotentReplay: true`)
   - Diferente: retornar conflito 409
3. Se não existir, processar e persistir atomicamente

**Por que não usar Redis ou cache para idempotência?**

- O cache pode ser perdido, causando processamento duplicado
- O banco fornece garantia de durabilidade
- O banco é a única fonte de verdade

### 5. Padrão Transactional Outbox

**Decisão**: Os eventos são persistidos na mesma transação dos dados de negócio.

**Fluxo**:

1. A operação de negócio altera a wallet e o ledger
2. O evento é inserido na tabela `outbox_messages`
3. A transação confirma atomicamente
4. Um worker em background consulta e publica no SQS
5. O worker marca o evento como publicado após a entrega bem-sucedida

**Benefícios**:

- Elimina o problema de dual-write (banco + broker de mensagens)
- Eventos não são perdidos mesmo quando o broker está indisponível
- Semântica exactly-once com `MessageDeduplicationId`

**Concorrência entre publishers**:

- Usa `SELECT ... FOR UPDATE SKIP LOCKED`
- Múltiplas instâncias podem publicar com segurança sem duplicações

### 6. Resolução de referências (fora de ordem)

**Decisão**: Status `PENDING_REFERENCE` com worker de retry em background.

**Cenário**: O REFUND chega antes do BET referenciado.

**Solução**:

1. A transação é salva com status `PENDING_REFERENCE`
2. O worker em background consulta a cada 5 segundos
3. Backoff exponencial entre as tentativas
4. No máximo 10 tentativas ou TTL de 60 minutos
5. Após os limites: marcada como `REJECTED` com `REFERENCE_TIMEOUT`

**Por que não usar uma fila em memória?**

- O estado seria perdido após um reinício
- Múltiplas instâncias precisam de uma visão coordenada
- A persistência garante a resolução eventual

### 7. Autenticação

**Decisão**: Não implementada, conforme orientação do desafio.

**Ponto de extensão**: Um `AuthGuard` pode ser adicionado para proteger os endpoints.

**Recomendação para produção**:

- Integrar Keycloak ou Zitadel como Identity Provider
- Usar OIDC/JWT para autenticação da API
- Verificar a identidade do provedor nas claims do JWT
- Manter os endpoints de health sem autenticação

### 8. Projeto do ledger

**Decisão**: Ledger append-only com lançamentos imutáveis.

**Propriedades**:

- Nenhuma atualização ou exclusão em `wallet_ledger_entries`
- Toda alteração de saldo possui um lançamento correspondente
- `balanceBefore` + direção + valor = `balanceAfter` (validado na criação)
- A reconciliação pode verificar se `wallet.balance` corresponde à soma do ledger

**Não implementado (diferencial opcional)**:

- Partidas dobradas (contrapartida na conta da casa)

## Projeto do schema

### Constraints no banco de dados

```sql
-- Wallet
CONSTRAINT wallets_balance_non_negative CHECK (balance_amount >= 0)
CONSTRAINT wallets_player_currency_unique UNIQUE (player_id, currency)

-- Wager Transaction
CONSTRAINT wager_transactions_idempotency_key_unique UNIQUE (idempotency_key)
CONSTRAINT wager_transactions_provider_external_unique UNIQUE (provider_id, external_transaction_id)
CONSTRAINT wager_transactions_amount_non_negative CHECK (amount >= 0)

-- Ledger Entry
CONSTRAINT ledger_entries_amount_non_negative CHECK (amount >= 0)
CONSTRAINT ledger_entries_balance_before_non_negative CHECK (balance_before_amount >= 0)
CONSTRAINT ledger_entries_balance_after_non_negative CHECK (balance_after_amount >= 0)

-- Trigger: Prevent double reversal
TRIGGER trg_check_reversal_uniqueness BEFORE INSERT OR UPDATE
```

## Taxonomia de códigos de falha

| Código                          | Descrição                                      | Ação do provedor |
| ------------------------------- | ---------------------------------------------- | ---------------- |
| `INSUFFICIENT_BALANCE`          | Saldo insuficiente para o débito               | Não repetir      |
| `NEGATIVE_BALANCE_WOULD_RESULT` | A reversão causaria saldo negativo             | Não repetir      |
| `REFERENCE_NOT_FOUND`           | Transação referenciada não encontrada          | Tentar depois    |
| `REFERENCE_TIMEOUT`             | Referência não encontrada após os retries      | Investigar       |
| `REFERENCE_ALREADY_REVERSED`    | Já revertida pelo mesmo tipo de operação       | Não repetir      |
| `INVALID_REFERENCE_KIND`        | Tipo de referência incorreto (ex.: REFUND→WIN) | Corrigir payload |
| `AMOUNT_MISMATCH`               | Valor da reversão difere da referência         | Corrigir payload |
| `CURRENCY_MISMATCH`             | Moeda não corresponde à wallet                 | Corrigir payload |
| `IDEMPOTENCY_CONFLICT`          | Mesma chave, payload diferente                 | Investigar       |
| `WALLET_NOT_FOUND`              | ID da wallet não existe                        | Corrigir payload |
| `PLAYER_MISMATCH`               | ID do player não corresponde à wallet          | Corrigir payload |
| `CONCURRENCY_CONFLICT`          | Falha no bloqueio otimista (interno)           | Retry automático |

## Observabilidade

### Logs estruturados

Todos os logs são formatados como JSON e contêm:

- `correlationId`: correlação da requisição/mensagem
- `walletId`, `transactionId`, `providerId`: contexto de negócio
- Nenhum dado sensível (payloads completos são excluídos)

### Métricas (Prometheus)

- `wager_transactions_total{kind,status}`: quantidade de transações
- `wager_transaction_duration_seconds{kind}`: latência de processamento
- `wager_duplicates_detected_total`: replays idempotentes
- `wager_retries_total{reason}`: quantidade de retries
- `wager_lock_conflicts_total`: conflitos de concorrência
- `wager_outbox_lag_seconds`: idade do evento não publicado mais antigo

### Health checks

- `GET /health/live`: processo vivo (sem dependências)
- `GET /health/ready`: conectividade com o PostgreSQL

## Limitações e trabalho futuro

1. **Premissa de moeda única**: embora o modelo suporte múltiplas moedas, os testes focam em BRL
2. **Sem tracing distribuído**: OpenTelemetry poderia ser adicionado
3. **Sem rate limiting**: deveria ser adicionado em produção
4. **Sem autenticação**: existe um ponto de extensão, mas não foi implementado
5. **Processamento HTTP síncrono**: uma fila assíncrona poderia ser adicionada para todas as requisições
6. **Sem circuit breaker**: para chamadas ao SQS ou a serviços externos

## Executando o sistema

```bash
# Iniciar a infraestrutura
docker-compose up -d postgres localstack

# Executar as migrations
bun run migration:up

# Iniciar a aplicação
bun run start:dev

# Executar os testes
bun test

# Múltiplas instâncias (para testes de concorrência)
docker-compose --profile multi-instance up -d
```
