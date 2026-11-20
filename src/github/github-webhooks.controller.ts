import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { GithubWebhooksService } from './github-webhooks.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@ApiExcludeController()
@Controller('github/webhooks')
export class GithubWebhooksController {
  private readonly logger = new Logger(GithubWebhooksController.name);

  constructor(private readonly webhooksService: GithubWebhooksService) {}

  @SkipThrottle()
  @Post()
  @HttpCode(202)
  async handle(
    @Req() req: RawBodyRequest,
    @Headers('x-github-event') eventType: string,
    @Headers('x-github-delivery') deliveryId: string,
    @Headers('x-hub-signature-256') signature: string,
  ) {
    // The signature is an HMAC over the exact bytes GitHub sent. A body
    // re-serialized from the already-parsed `req.body` can essentially never
    // byte-match those, so if the raw capture didn't happen (e.g. a
    // form-encoded delivery, or a proxy re-encoding the body) the delivery is
    // unverifiable: fail closed rather than HMAC a reconstructed buffer (#338).
    const signatureValid = req.rawBody
      ? this.webhooksService.verifySignature(req.rawBody, signature)
      : false;

    // This is the only unauthenticated write endpoint, so the signature is a
    // gate, not an audit flag: an unverified delivery is refused before
    // anything reaches webhook_events (#735, #845). Otherwise anyone who can
    // reach the endpoint could store arbitrary JSON at the throttler's rate.
    if (!signatureValid) {
      this.logger.warn(
        `Rejected webhook delivery ${deliveryId} — invalid signature`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const event = await this.webhooksService.handleEvent(
      eventType,
      deliveryId,
      req.body as Record<string, unknown>,
      signatureValid,
    );

    return { received: true, eventId: event.id, status: event.status };
  }
}
