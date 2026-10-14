import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class TeamMemberSplitDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty({ required: false, example: 'frontend', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  role?: string;

  // maxDecimalPlaces: 2 — the team is persisted with percentage.toFixed(2),
  // so a split accepted at full precision (33.334/33.333/33.333) stores as
  // 33.33×3 = 99.99, silently violating the sums-to-100 invariant the
  // validator just checked and relying on apportionBasisPoints to renormalise
  // (#582). Rejecting >2 decimals at the boundary keeps stored sums correct.
  @ApiProperty({ example: 40, minimum: 0.01, maximum: 100 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(100)
  percentage: number;
}

export class UpdateTeamSplitsDto {
  @ApiProperty({ type: [TeamMemberSplitDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamMemberSplitDto)
  splits: TeamMemberSplitDto[];
}

export class CreateTeamDto {
  @ApiProperty()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  createdById?: string;

  @ApiProperty({ type: [TeamMemberSplitDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamMemberSplitDto)
  members: TeamMemberSplitDto[];
}
