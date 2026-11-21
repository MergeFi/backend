import { ApiProperty } from '@nestjs/swagger';
import { Team } from '../../common/entities';

export class TeamMemberSplitResponseDto {
  @ApiProperty({ nullable: true })
  userId: string | null;

  @ApiProperty({ nullable: true })
  role: string | null;

  @ApiProperty()
  percentage: string;
}

export class TeamResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty({ type: [TeamMemberSplitResponseDto] })
  splits: TeamMemberSplitResponseDto[];
}

export function toTeamResponse(team: Team): TeamResponseDto {
  return {
    id: team.id,
    name: team.name,
    createdAt: team.createdAt,
    splits: (team.splits ?? []).map((split) => ({
      userId: split.userId,
      role: split.role,
      percentage: split.percentage,
    })),
  };
}
