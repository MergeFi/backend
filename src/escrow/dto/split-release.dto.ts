import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsStellarAddress } from '../../common/validators/stellar-address.validator';

export class SplitRecipientDto {
  @ApiProperty()
  @IsStellarAddress()
  recipientAddress: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  recipientId?: string;

  @ApiProperty({ minimum: 0.01, maximum: 100 })
  @IsNumber()
  @Min(0.01)
  @Max(100)
  percentage: number;
}

export class SplitReleaseDto {
  // Unbounded recipients: the contract's `release` iterates every recipient
  // (one token transfer each) — a large split exceeds Soroban's
  // per-transaction resource limits and fails on-chain (#581, #15). Cap at a
  // size that stays within the contract's budget.
  @ApiProperty({ type: [SplitRecipientDto] })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SplitRecipientDto)
  recipients: SplitRecipientDto[];
}
