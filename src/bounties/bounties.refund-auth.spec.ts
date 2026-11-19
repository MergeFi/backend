import { ForbiddenException } from '@nestjs/common';
import { BountiesService } from './bounties.service';
import { BountyStatus } from '../common/enums';

// Built by hand rather than through a TestingModule: refund only needs the
// bounty repository and the escrow service.
describe('BountiesService.refund authorization (#545)', () => {
  const SPONSOR = 'user-sponsor';
  const REPO_MAINTAINER = 'user-repo-maintainer';
  const OTHER_MAINTAINER = 'user-other-maintainer';

  function build() {
    const bounty = {
      id: 'b1',
      sponsorId: SPONSOR,
      status: BountyStatus.FUNDED,
      escrowId: 'escrow-1',
      issue: { repository: { maintainerId: REPO_MAINTAINER } },
    };
    const bountyRepo = {
      findOne: jest.fn().mockResolvedValue(bounty),
      save: jest.fn((b: unknown) => Promise.resolve(b)),
    };
    const escrowService = { refund: jest.fn().mockResolvedValue(undefined) };
    const service = new BountiesService(
      bountyRepo as never,
      {} as never,
      {} as never,
      {} as never,
      escrowService as never,
    );
    return { service, bountyRepo, escrowService };
  }

  it('lets the sponsor refund', async () => {
    const { service, escrowService } = build();
    const result = await service.refund('b1', SPONSOR);
    expect(result.status).toBe(BountyStatus.REFUNDED);
    expect(escrowService.refund).toHaveBeenCalledWith('escrow-1');
  });

  it("lets the bounty repository's maintainer refund", async () => {
    const { service, escrowService } = build();
    const result = await service.refund('b1', REPO_MAINTAINER);
    expect(result.status).toBe(BountyStatus.REFUNDED);
    expect(escrowService.refund).toHaveBeenCalledWith('escrow-1');
  });

  it('rejects a maintainer of a different repository', async () => {
    const { service, escrowService } = build();
    await expect(service.refund('b1', OTHER_MAINTAINER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(escrowService.refund).not.toHaveBeenCalled();
  });
});
