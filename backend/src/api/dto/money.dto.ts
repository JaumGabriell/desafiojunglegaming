import { IsString, IsNotEmpty, Matches } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class MoneyDto {
  @ApiProperty({
    description: "Amount as decimal string with up to 2 decimal places",
    example: "100.00",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+(\.\d{1,2})?$/, {
    message: "Amount must be a decimal string with at most 2 decimal places",
  })
  amount!: string;

  @ApiProperty({
    description: "ISO-4217 currency code",
    example: "BRL",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z]{3}$/, {
    message: "Currency must be ISO-4217 format (3 uppercase letters)",
  })
  currency!: string;
}
