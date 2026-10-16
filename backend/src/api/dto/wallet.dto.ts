import {
  IsString,
  IsNotEmpty,
  IsUUID,
  ValidateNested,
  IsOptional,
  IsInt,
  Min,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MoneyDto } from "./money.dto";

export class CreateWalletDto {
  @ApiProperty({
    description: "Player unique identifier",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  @IsUUID()
  @IsNotEmpty()
  playerId!: string;

  @ApiProperty({
    description: "Initial balance for the wallet",
    type: MoneyDto,
  })
  @ValidateNested()
  @Type(() => MoneyDto)
  initialBalance!: MoneyDto;
}

export class WalletResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440001" })
  id!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440000" })
  playerId!: string;

  @ApiProperty({ type: MoneyDto })
  balance!: MoneyDto;

  @ApiProperty({ description: "Optimistic locking version", example: 1 })
  version!: number;
}

export class LedgerQueryDto {
  @ApiPropertyOptional({
    description: "Cursor for pagination (opaque string)",
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: "Number of entries to return",
    default: 50,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}

export class LedgerEntryResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440002" })
  id!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440001" })
  walletId!: string;

  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440003" })
  transactionId!: string;

  @ApiProperty({ enum: ["DEBIT", "CREDIT"], example: "DEBIT" })
  direction!: string;

  @ApiProperty({ type: MoneyDto })
  money!: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  balanceBefore!: MoneyDto;

  @ApiProperty({ type: MoneyDto })
  balanceAfter!: MoneyDto;

  @ApiProperty({ example: "2026-10-14T12:00:00.000Z" })
  createdAt!: string;
}

export class LedgerResponseDto {
  @ApiProperty({ type: [LedgerEntryResponseDto] })
  entries!: LedgerEntryResponseDto[];

  @ApiPropertyOptional({ description: "Cursor for next page" })
  nextCursor?: string;
}

export class ReconciliationResponseDto {
  @ApiProperty({ example: "550e8400-e29b-41d4-a716-446655440001" })
  walletId!: string;

  @ApiProperty({ description: "Balance stored in wallet", type: MoneyDto })
  storedBalance!: MoneyDto;

  @ApiProperty({
    description: "Balance calculated from ledger",
    type: MoneyDto,
  })
  calculatedBalance!: MoneyDto;

  @ApiProperty({
    description: "Difference between stored and calculated",
    type: MoneyDto,
  })
  difference!: MoneyDto;

  @ApiProperty({ description: "True if balances match", example: true })
  consistent!: boolean;

  @ApiProperty({ description: "Number of ledger entries checked", example: 42 })
  checkedEntries!: number;
}
