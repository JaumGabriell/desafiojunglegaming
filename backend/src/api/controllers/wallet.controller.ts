import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpStatus,
  HttpCode,
  NotFoundException,
  ConflictException,
  Logger,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { WalletService } from "../../application/services/wallet.service";
import { MikroOrmLedgerRepository } from "../../infrastructure/database/repositories/ledger.repository";
import { Money } from "../../domain/value-objects/money";
import {
  CreateWalletDto,
  WalletResponseDto,
  LedgerQueryDto,
  LedgerResponseDto,
  ReconciliationResponseDto,
} from "../dto/wallet.dto";

@ApiTags("wallets")
@Controller("wallets")
export class WalletController {
  private readonly logger = new Logger(WalletController.name);

  constructor(
    private readonly walletService: WalletService,
    private readonly ledgerRepo: MikroOrmLedgerRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Create a new wallet",
    description:
      "Creates a wallet for a player with optional initial balance. Creates an OPENING transaction if initial balance > 0.",
  })
  @ApiResponse({
    status: 201,
    description: "Wallet created successfully",
    type: WalletResponseDto,
  })
  @ApiResponse({
    status: 409,
    description: "Wallet already exists for this player+currency",
  })
  async createWallet(@Body() dto: CreateWalletDto): Promise<WalletResponseDto> {
    try {
      const result = await this.walletService.createWallet({
        playerId: dto.playerId,
        initialBalance: Money.from(dto.initialBalance),
      });

      return {
        id: result.id,
        playerId: result.playerId,
        balance: result.balance.toJSON(),
        version: result.version,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("already exists")) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
  }

  @Get(":walletId")
  @ApiOperation({ summary: "Get wallet by ID" })
  @ApiParam({ name: "walletId", description: "Wallet UUID" })
  @ApiResponse({
    status: 200,
    description: "Wallet found",
    type: WalletResponseDto,
  })
  @ApiResponse({ status: 404, description: "Wallet not found" })
  async getWallet(
    @Param("walletId") walletId: string,
  ): Promise<WalletResponseDto> {
    const wallet = await this.walletService.getWallet(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet not found: ${walletId}`);
    }

    return {
      id: wallet.id,
      playerId: wallet.playerId,
      balance: wallet.balance.toJSON(),
      version: wallet.version,
    };
  }

  @Get(":walletId/ledger")
  @ApiOperation({
    summary: "Get wallet ledger entries",
    description:
      "Returns paginated ledger entries with cursor-based pagination",
  })
  @ApiParam({ name: "walletId", description: "Wallet UUID" })
  @ApiResponse({
    status: 200,
    description: "Ledger entries",
    type: LedgerResponseDto,
  })
  @ApiResponse({ status: 404, description: "Wallet not found" })
  async getLedger(
    @Param("walletId") walletId: string,
    @Query() query: LedgerQueryDto,
  ): Promise<LedgerResponseDto> {
    const wallet = await this.walletService.getWallet(walletId);
    if (!wallet) {
      throw new NotFoundException(`Wallet not found: ${walletId}`);
    }

    const limit = query.limit ?? 50;
    const entries = await this.ledgerRepo.findByWalletId(
      walletId,
      query.cursor,
      limit + 1,
    );

    const hasMore = entries.length > limit;
    const resultEntries = hasMore ? entries.slice(0, limit) : entries;
    const nextCursor = hasMore
      ? resultEntries[resultEntries.length - 1].id
      : undefined;

    return {
      entries: resultEntries.map((entry) => ({
        id: entry.id,
        walletId: entry.walletId,
        transactionId: entry.transactionId,
        direction: entry.direction,
        money: entry.money.toJSON(),
        balanceBefore: entry.balanceBefore.toJSON(),
        balanceAfter: entry.balanceAfter.toJSON(),
        createdAt: entry.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  @Post(":walletId/reconciliation")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Reconcile wallet balance",
    description:
      "Compares stored balance with calculated balance from ledger entries",
  })
  @ApiParam({ name: "walletId", description: "Wallet UUID" })
  @ApiResponse({
    status: 200,
    description: "Reconciliation result",
    type: ReconciliationResponseDto,
  })
  @ApiResponse({ status: 404, description: "Wallet not found" })
  async reconcile(
    @Param("walletId") walletId: string,
  ): Promise<ReconciliationResponseDto> {
    try {
      const result = await this.walletService.reconcileWallet(walletId);

      return {
        walletId: result.walletId,
        storedBalance: result.storedBalance.toJSON(),
        calculatedBalance: result.calculatedBalance.toJSON(),
        difference: result.difference.toJSON(),
        consistent: result.consistent,
        checkedEntries: result.checkedEntries,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("not found")) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }
  }
}
