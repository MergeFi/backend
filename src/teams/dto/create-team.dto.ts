import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class TeamMemberSplitDto {
  @ApiProperty()
  @IsUUID()
  userId: string;

  @ApiProperty({ required: false, example: 'frontend' })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ example: 40 })
  @IsNumber()
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
