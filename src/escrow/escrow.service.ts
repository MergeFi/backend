import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Escrow } from '../common/entities/escrow.entity';
import { User } from '../common/entities/user.entity';
import { FundEscrowDto } from './dto/fund-escrow.dto';
import { ReleaseEscrowDto } from './dto/release-escrow.dto';
import { SplitReleaseDto } from './dto/split-release.dto';
import { SorobanClientService } from './soroban-client.service';
import { Payment } from '../common/entities/payment.entity';
import { EscrowStatus } from '../common/enums';

@Injectable()
export class EscrowService {
  constructor(
    @InjectRepository(Escrow)
    private readonly escrowRepo: Repository<Escrow>,
    @InjectRepository(Payment)
    private readonly paymentRepo: Repository<Payment>,
    private readonly sorobanClient: SorobanClientService,
  ) {}

  async fund(fundEscrowDto: FundEscrowDto, user: User): Promise<Escrow> {
    // Authorization: user must be the funder (sponsor)
    // The funderAddress in the DTO should match the user's wallet address
    // For now, we trust the authenticated user is the funder
    
    const escrow = this.escrowRepo.create({
      ...fundEscrowDto,
      status: EscrowStatus.FUNDED,
      funderId: user.userId,
    });
    
    const savedEscrow = await this.escrowRepo.save(escrow);
    
    // Invoke Soroban contract to fund escrow
    await this.sorobanClient.fundEscrow(savedEscrow);
    
    return savedEscrow;
  }

  async findOne(id: string): Promise<Escrow> {
    const escrow = await this.escrowRepo.findOne({ where: { id } });
    if (!escrow) {
      throw new NotFoundException(`Escrow ${id} not found`);
    }
    return escrow;
  }

  async release(id: string, releaseEscrowDto: ReleaseEscrowDto, user: User): Promise<Escrow> {
    const escrow = await this.findOne(id);

    // Authorization: only the funder (sponsor) or an admin can release
    if (escrow.funderId !== user.userId) {
      throw new ForbiddenException('Only the escrow funder can release funds');
    }

    if (escrow.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Cannot release escrow in status ${escrow.status}`);
    }

    // Invoke Soroban contract to release
    await this.sorobanClient.releaseEscrow(escrow, releaseEscrowDto.recipientAddress);

    escrow.status = EscrowStatus.RELEASED;
    escrow.releasedAt = new Date();
    escrow.recipientAddress = releaseEscrowDto.recipientAddress;
    
    const payment = this.paymentRepo.create({
      escrowId: escrow.id,
      amount: escrow.amount,
      token: escrow.token,
      recipientAddress: releaseEscrowDto.recipientAddress,
      type: 'release',
    });
    await this.paymentRepo.save(payment);

    return this.escrowRepo.save(escrow);
  }

  async splitRelease(id: string, splitReleaseDto: SplitReleaseDto, user: User): Promise<Escrow> {
    const escrow = await this.findOne(id);

    // Authorization: only the funder (sponsor) or an admin can split-release
    if (escrow.funderId !== user.userId) {
      throw new ForbiddenException('Only the escrow funder can split-release funds');
    }

    if (escrow.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Cannot split-release escrow in status ${escrow.status}`);
    }

    // Validate splits sum to 100%
    const totalBps = splitReleaseDto.splits.reduce((sum, s) => sum + s.basisPoints, 0);
    if (totalBps !== 10000) {
      throw new BadRequestException('Splits must sum to 10000 basis points (100%)');
    }

    // Invoke Soroban contract for split release
    await this.sorobanClient.splitReleaseEscrow(escrow, splitReleaseDto.splits);

    escrow.status = EscrowStatus.RELEASED;
    escrow.releasedAt = new Date();
    
    for (const split of splitReleaseDto.splits) {
      const payment = this.paymentRepo.create({
        escrowId: escrow.id,
        amount: Math.floor((escrow.amount * split.basisPoints) / 10000),
        token: escrow.token,
        recipientAddress: split.recipientAddress,
        type: 'split-release',
      });
      await this.paymentRepo.save(payment);
    }

    return this.escrowRepo.save(escrow);
  }

  async refund(id: string, user: User): Promise<Escrow> {
    const escrow = await this.findOne(id);

    // Authorization: only the funder (sponsor) can refund
    if (escrow.funderId !== user.userId) {
      throw new ForbiddenException('Only the escrow funder can refund');
    }

    if (escrow.status !== EscrowStatus.FUNDED) {
      throw new BadRequestException(`Cannot refund escrow in status ${escrow.status}`);
    }

    // Invoke Soroban contract to refund
    await this.sorobanClient.refundEscrow(escrow);

    escrow.status = EscrowStatus.REFUNDED;
    escrow.refundedAt = new Date();

    return this.escrowRepo.save(escrow);
  }
}
