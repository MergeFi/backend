import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class SplitRecipientDto {
  @ApiProperty()
  @IsString()
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
  @ApiProperty({ type: [SplitRecipientDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitRecipientDto)
  recipients: SplitRecipientDto[];
}
