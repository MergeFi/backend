import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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

export class CreateTeamDto {
  @ApiProperty()
  @IsString()
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
