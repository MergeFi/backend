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

  @ApiProperty({ example: 40, minimum: 0.01, maximum: 100 })
  @IsNumber()
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

  @ApiProperty()
  @IsUUID()
  createdById: string;

  @ApiProperty({ type: [TeamMemberSplitDto] })
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TeamMemberSplitDto)
  members: TeamMemberSplitDto[];
}
