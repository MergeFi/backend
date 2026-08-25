import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IdempotencyKey } from '../../common/entities/idempotency-key.entity';
import { Reflector } from '@nestjs/core';
import { IDEMPOTENCY_KEY_METADATA } from './idempotent.decorator';

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly idempotencyKeyRepo: Repository<IdempotencyKey>,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const request = context.switchToHttp().getRequest();
    const idempotencyKey = request.headers['idempotency-key'] as string;

    if (!idempotencyKey) {
      return next.handle();
    }

    const metadata = this.reflector.get(IDEMPOTENCY_KEY_METADATA, context.getHandler());
    const ttlSeconds = metadata?.ttlSeconds ?? 86400; // 24 hours default

    const callerId = this.resolveCallerId(request);
    const compositeKey = `${callerId}:${idempotencyKey}`;

    const existing = await this.idempotencyKeyRepo.findOne({ where: { key: compositeKey } });
    if (existing) {
      this.logger.debug(`Idempotent replay: ${compositeKey}`);
      return new Observable((subscriber) => {
        subscriber.next(existing.response);
        subscriber.complete();
      });
    }

    return next.handle().pipe(
      tap(async (response) => {
        await this.idempotencyKeyRepo.save(
          this.idempotencyKeyRepo.create({
            key: compositeKey,
            response,
            expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          }),
        );
      }),
    );
  }

  /**
   * Resolves the caller identity for idempotency key scoping.
   *
   * Now that all mutating routes on bounties, escrow, teams, milestones,
   * and maintenance-pool controllers are protected by JwtAuthGuard,
   * we can use the authenticated user's ID as the caller scope.
   *
   * Falls back to 'anonymous' for any routes that remain unguarded
   * (e.g., public GET endpoints or webhook handlers).
   */
  private resolveCallerId(request: any): string {
    const user = request.user;
    if (user?.userId) {
      return `user:${user.userId}`;
    }
    if (user?.sub) {
      return `user:${user.sub}`;
    }
    // Fallback for any remaining unguarded routes
    const ip = request.ip ?? request.connection?.remoteAddress ?? 'unknown';
    return `anon:${ip}`;
  }
}
