import {
  IsString,
  IsNotEmpty,
  IsUUID,
  ValidateNested,
  IsOptional,
  IsEnum,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MoneyDto } from "./money.dto";
import {
  WagerTransactionKind,
  WagerTransactionStatus,
} from "../../domain/entities/wager-transaction";

export class CreateWagerTransactionDto {
  @ApiProperty({
    description: "Game provider identifier",
    example: "provider-a",
  })
  @IsString()
  @IsNotEmpty()
  providerId!: string;

  @ApiProperty({
    description: "Transaction ID from the provider",
    example: "transaction-123",
  })
  @IsString()
  @IsNotEmpty()
  externalTransactionId!: string;

  @ApiProperty({
    description: "Player unique identifier",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @IsUUID()
  @IsNotEmpty()
  playerId!: string;

  @ApiProperty({
    description: "Wallet unique identifier",
    example: "550e8400-e29b-41d4-a716-446655440001",
  })
  @IsUUID()
  @IsNotEmpty()
  walletId!: string;

  @ApiProperty({
    description: "Game round identifier",
    example: "round-987",
  })
  @IsString()
  @IsNotEmpty()
  roundId!: string;

  @ApiProperty({
    description: "Game identifier",
    example: "fortune-chimp",
  })
  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @ApiProperty({
    description: "Transaction type",
    enum: WagerTransactionKind,
    example: "BET",
  })
  @IsEnum(WagerTransactionKind)
  kind!: WagerTransactionKind;

  @ApiProperty({
    description: "Transaction amount",
    type: MoneyDto,
  })
  @ValidateNested()
  @Type(() => MoneyDto)
  money!: MoneyDto;

  @ApiPropertyOptional({
    description: "Reference transaction ID for REFUND/ROLLBACK operations",
    example: "transaction-100",
  })
  @IsOptional()
  @IsString()
  referenceExternalTransactionId?: string;
}

export class WagerTransactionResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440002" })
  transactionId!: string;

  @ApiProperty({
    enum: WagerTransactionStatus,
    example: "PROCESSED",
    description: "PENDING | PENDING_REFERENCE | PROCESSED | REJECTED | FAILED",
  })
  status!: WagerTransactionStatus;

  @ApiProperty({ type: MoneyDto, description: "Current wallet balance" })
  balance!: MoneyDto;

  @ApiProperty({
    description:
      "True if this was a replay of an already processed transaction",
    example: false,
  })
  idempotentReplay!: boolean;

  @ApiPropertyOptional({
    description: "Failure code if transaction was rejected",
    example: "INSUFFICIENT_BALANCE",
  })
  failureCode?: string;
}

export class TransactionDetailResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440002" })
  id!: string;

  @ApiProperty({ example: "provider-a" })
  providerId!: string;

  @ApiProperty({ example: "transaction-123" })
  externalTransactionId!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440001" })
  walletId!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  playerId!: string;

  @ApiProperty({ example: "round-987" })
  roundId!: string;

  @ApiProperty({ example: "fortune-chimp" })
  gameId!: string;

  @ApiProperty({ enum: WagerTransactionKind, example: "BET" })
  kind!: string;

  @ApiProperty({ type: MoneyDto })
  money!: MoneyDto;

  @ApiProperty({ enum: WagerTransactionStatus, example: "PROCESSED" })
  status!: string;

  @ApiPropertyOptional({ example: "550e8400-e29b-41d4-a716-446655440003" })
  referenceTransactionId?: string;

  @ApiPropertyOptional({ example: "INSUFFICIENT_BALANCE" })
  failureCode?: string;

  @ApiProperty({ example: "2026-10-14T12:00:00.000Z" })
  createdAt!: string;

  @ApiPropertyOptional({ example: "2026-10-14T12:00:01.000Z" })
  processedAt?: string;
}
