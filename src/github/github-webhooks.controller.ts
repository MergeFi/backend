import {
  Controller,
  Headers,
  HttpCode,
  InternalServerErrorException,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhookEventStatus } from '../common/enums';
import { GithubWebhooksService } from './github-webhooks.service';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

@ApiExcludeController()
@Controller('github/webhooks')
export class GithubWebhooksController {
  constructor(private readonly webhooksService: GithubWebhooksService) {}

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

    const event = await this.webhooksService.handleEvent(
      eventType,
      deliveryId,
      req.body as Record<string, unknown>,
      signatureValid,
    );

    if (event.status === WebhookEventStatus.FAILED) {
      throw new InternalServerErrorException(
        event.error ?? 'Webhook event processing failed',
      );
    }

    return { received: true, eventId: event.id, status: event.status };
  }
}
