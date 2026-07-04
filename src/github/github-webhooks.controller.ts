import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
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
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const signatureValid = this.webhooksService.verifySignature(
      rawBody,
      signature,
    );

    const event = await this.webhooksService.handleEvent(
      eventType,
      deliveryId,
      req.body as Record<string, unknown>,
      signatureValid,
    );

    return { received: true, eventId: event.id, status: event.status };
  }
}
