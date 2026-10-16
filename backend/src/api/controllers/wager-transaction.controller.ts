import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Headers,
  HttpStatus,
  HttpCode,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiHeader,
} from "@nestjs/swagger";
import { WagerTransactionService } from "../../application/services/wager-transaction.service";
import { MikroOrmWagerTransactionRepository } from "../../infrastructure/database/repositories/wager-transaction.repository";
import { Money } from "../../domain/value-objects/money";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";
import {
  IdempotencyConflictError,
  WalletNotFoundError,
  ContextMismatchError,
  FailureCode,
} from "../../domain/errors/domain-errors";
import {
  CreateWagerTransactionDto,
  WagerTransactionResponseDto,
  TransactionDetailResponseDto,
} from "../dto/wager-transaction.dto";

@ApiTags("wagering")
@Controller()
export class WagerTransactionController {
  private readonly logger = new Logger(WagerTransactionController.name);

  constructor(
    private readonly wagerService: WagerTransactionService,
    private readonly transactionRepo: MikroOrmWagerTransactionRepository,
  ) {}

  @Post("wagering/transactions")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Submit a wager transaction",
    description:
      "Process a BET, WIN, LOSS, REFUND or ROLLBACK transaction. Requires Idempotency-Key header.",
  })
  @ApiHeader({
    name: "Idempotency-Key",
    description:
      "Unique key for idempotent request (recommended: providerId:externalTransactionId)",
    required: true,
    example: "provider-a:transaction-123",
  })
  @ApiResponse({
    status: 200,
    description: "Transaction processed",
    type: WagerTransactionResponseDto,
  })
  @ApiResponse({ status: 400, description: "Invalid request" })
  @ApiResponse({ status: 404, description: "Wallet not found" })
  @ApiResponse({
    status: 409,
    description: "Idempotency conflict (same key, different payload)",
  })
  @ApiResponse({ status: 422, description: "Business rule violation" })
  async submitTransaction(
    @Headers("Idempotency-Key") idempotencyKey: string,
    @Body() dto: CreateWagerTransactionDto,
  ): Promise<WagerTransactionResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException("Idempotency-Key header is required");
    }

    // Validate that OPENING cannot be submitted externally
    if (dto.kind === WagerTransactionKind.Opening) {
      throw new BadRequestException(
        "OPENING transactions cannot be submitted externally",
      );
    }

    try {
      const result = await this.wagerService.processTransaction({
        providerId: dto.providerId,
        externalTransactionId: dto.externalTransactionId,
        idempotencyKey,
        playerId: dto.playerId,
        walletId: dto.walletId,
        roundId: dto.roundId,
        gameId: dto.gameId,
        kind: dto.kind,
        money: Money.from(dto.money),
        referenceExternalTransactionId: dto.referenceExternalTransactionId,
      });

      // Map status to appropriate HTTP response
      if (result.status === WagerTransactionStatus.Rejected) {
        return this.createRejectedResponse(result);
      }

      return {
        transactionId: result.transactionId,
        status: result.status,
        balance: result.balance.toJSON(),
        idempotentReplay: result.idempotentReplay,
        failureCode: result.failureCode,
      };
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        throw new ConflictException({
          statusCode: HttpStatus.CONFLICT,
          error: "Conflict",
          message: error.message,
          code: error.code,
        });
      }
      if (error instanceof WalletNotFoundError) {
        throw new NotFoundException({
          statusCode: HttpStatus.NOT_FOUND,
          error: "Not Found",
          message: error.message,
          code: error.code,
        });
      }
      if (error instanceof ContextMismatchError) {
        throw new UnprocessableEntityException({
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: "Unprocessable Entity",
          message: error.message,
          code: error.code,
        });
      }
      this.logger.error("Unexpected error processing transaction", error);
      throw error;
    }
  }

  @Get("wagering/transactions/:transactionId")
  @ApiOperation({ summary: "Get transaction by internal ID" })
  @ApiParam({ name: "transactionId", description: "Internal transaction UUID" })
  @ApiResponse({
    status: 200,
    description: "Transaction found",
    type: TransactionDetailResponseDto,
  })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getTransactionById(
    @Param("transactionId") transactionId: string,
  ): Promise<TransactionDetailResponseDto> {
    const tx = await this.transactionRepo.findById(transactionId);
    if (!tx) {
      throw new NotFoundException(`Transaction not found: ${transactionId}`);
    }

    return this.mapToDetailResponse(tx);
  }

  @Get("providers/:providerId/wagering/transactions/:externalTransactionId")
  @ApiOperation({ summary: "Get transaction by provider and external ID" })
  @ApiParam({ name: "providerId", description: "Game provider identifier" })
  @ApiParam({
    name: "externalTransactionId",
    description: "Transaction ID from provider",
  })
  @ApiResponse({
    status: 200,
    description: "Transaction found",
    type: TransactionDetailResponseDto,
  })
  @ApiResponse({ status: 404, description: "Transaction not found" })
  async getTransactionByExternalId(
    @Param("providerId") providerId: string,
    @Param("externalTransactionId") externalTransactionId: string,
  ): Promise<TransactionDetailResponseDto> {
    const tx = await this.transactionRepo.findByProviderAndExternalId(
      providerId,
      externalTransactionId,
    );
    if (!tx) {
      throw new NotFoundException(
        `Transaction not found: provider=${providerId}, externalId=${externalTransactionId}`,
      );
    }

    return this.mapToDetailResponse(tx);
  }

  private createRejectedResponse(result: {
    transactionId: string;
    status: WagerTransactionStatus;
    balance: Money;
    idempotentReplay: boolean;
    failureCode?: FailureCode;
  }): WagerTransactionResponseDto {
    return {
      transactionId: result.transactionId,
      status: result.status,
      balance: result.balance.toJSON(),
      idempotentReplay: result.idempotentReplay,
      failureCode: result.failureCode,
    };
  }

  private mapToDetailResponse(tx: {
    id: string;
    providerId: string;
    externalTransactionId: string;
    walletId: string;
    playerId: string;
    roundId: string;
    gameId: string;
    kind: WagerTransactionKind;
    money: Money;
    status: WagerTransactionStatus;
    referenceTransactionId?: string;
    failureCode?: FailureCode;
    createdAt: Date;
    processedAt?: Date;
  }): TransactionDetailResponseDto {
    return {
      id: tx.id,
      providerId: tx.providerId,
      externalTransactionId: tx.externalTransactionId,
      walletId: tx.walletId,
      playerId: tx.playerId,
      roundId: tx.roundId,
      gameId: tx.gameId,
      kind: tx.kind,
      money: tx.money.toJSON(),
      status: tx.status,
      referenceTransactionId: tx.referenceTransactionId,
      failureCode: tx.failureCode,
      createdAt: tx.createdAt.toISOString(),
      processedAt: tx.processedAt?.toISOString(),
    };
  }
}
