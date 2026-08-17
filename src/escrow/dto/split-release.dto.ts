import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

  /**
   * Cross-checked against `recipientAddress` per entry in `EscrowService`
   * before any chain call — see `ReleaseEscrowDto.recipientId` (#40).
   */
  @ApiProperty({
    required: false,
    description:
      'Attributed recipient. Must match the linked Stellar address of this user; a mismatched pair is rejected.',
  })
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
  @ApiProperty({ type: [SplitRecipientDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitRecipientDto)
  recipients: SplitRecipientDto[];
}
