import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../src/common/entities/user.entity';
import { Team } from '../src/common/entities/team.entity';
import { TeamMemberSplit } from '../src/common/entities/team-member-split.entity';
import { entities } from '../src/common/entities/typeorm-entities';

describe('TeamSplitIntegrity (Integration)', () => {
  let userRepo: Repository<User>;
  let teamRepo: Repository<Team>;
  let splitRepo: Repository<TeamMemberSplit>;
  let moduleFixture: TestingModule;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          username: 'postgres',
          password: 'postgres',
          database: 'mergefi',
          entities: entities,
          synchronize: true,
        }),
        TypeOrmModule.forFeature([User, Team, TeamMemberSplit]),
      ],
    }).compile();

    userRepo = moduleFixture.get(getRepositoryToken(User));
    teamRepo = moduleFixture.get(getRepositoryToken(Team));
    splitRepo = moduleFixture.get(getRepositoryToken(TeamMemberSplit));
  });

  it('should block deletion of a user that is part of a team split (RESTRICT)', async () => {
    // 1. Create User
    const user = await userRepo.save(userRepo.create({ username: 'u1' }));

    // 2. Create Team and Split
    const team = await teamRepo.save(teamRepo.create({ name: 'test-team' }));
    await splitRepo.save({
      teamId: team.id,
      userId: user.id,
      percentage: '100.00',
    });

    // 3. Attempt to delete user - should throw DB error due to RESTRICT FK
    await expect(userRepo.delete(user.id)).rejects.toThrow();

    // 4. Verify split row still exists
    const split = await splitRepo.findOne({ where: { userId: user.id } });
    expect(split).toBeDefined();
  });

  afterAll(async () => {
    await moduleFixture.close();
  });
});
