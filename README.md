Processador de Apostas (Wager Processor)

Processador de Apostas Distribuído - Desafio de Backend
Visão Geral

Serviço financeiro que processa transações de apostas de múltiplos provedores de jogos com:

    Correção financeira: Sem saldos negativos, sem débitos/créditos duplicados

    Idempotência: Seguro para reexecutar (retry) qualquer requisição

    Controle de concorrência: Lida com operações paralelas na mesma carteira

    Trilha de auditoria: Registro (ledger) imutável para todas as alterações de saldo

Stack Tecnológica

    Runtime: Bun 1.x

    Framework: NestJS

    Linguagem: TypeScript (modo estrito)

    Banco de Dados: PostgreSQL

    ORM: MikroORM

    Mensageria: AWS SQS (LocalStack para desenvolvimento local)

    Containerização: Docker Compose

Primeiros Passos
Bash

# Instalar dependências
bun install

# Iniciar a infraestrutura
docker-compose up -d

# Executar as migrações do banco de dados
bun run migration:up

# Iniciar o servidor de desenvolvimento
bun run start:dev

Estrutura do Projeto
Plaintext

src/
├── domain/           # Lógica de negócio (entidades, objetos de valor)
├── application/      # Casos de uso e serviços
├── api/              # Controladores HTTP e DTOs
└── infrastructure/   # Banco de dados, mensageria, observabilidade

Licença

Privado - Desafio de Backend da Jungle Gaming