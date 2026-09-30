import { InternalServerErrorException } from '@nestjs/common';
import { GithubWebhooksController } from './github-webhooks.controller';
import { GithubWebhooksService } from './github-webhooks.service';
import { WebhookEventStatus } from '../common/enums';

describe('GithubWebhooksController — rawBody handling (#338)', () => {
  let verifySignature: jest.Mock;
  let handleEvent: jest.Mock;
  let controller: GithubWebhooksController;

  beforeEach(() => {
    verifySignature = jest.fn().mockReturnValue(true);
    handleEvent = jest
      .fn()
      .mockResolvedValue({ id: 'event-1', status: 'processed' });
    controller = new GithubWebhooksController({
      verifySignature,
      handleEvent,
    } as unknown as GithubWebhooksService);
  });

  it('verifies the signature against req.rawBody when present', async () => {
    const rawBody = Buffer.from('{"action":"closed"}');
    await controller.handle(
      { rawBody, body: { action: 'closed' } } as never,
      'pull_request',
      'delivery-1',
      'sha256=abc',
    );

    expect(verifySignature).toHaveBeenCalledWith(rawBody, 'sha256=abc');
    expect(handleEvent).toHaveBeenCalledWith(
      'pull_request',
      'delivery-1',
      { action: 'closed' },
      true,
    );
  });

  it('fails closed when req.rawBody is missing, never HMACing a reconstructed body', async () => {
    await controller.handle(
      { body: { action: 'closed' } } as never,
      'pull_request',
      'delivery-2',
      'sha256=abc',
    );

    expect(verifySignature).not.toHaveBeenCalled();
    expect(handleEvent).toHaveBeenCalledWith(
      'pull_request',
      'delivery-2',
      { action: 'closed' },
      false,
    );
  });
});

describe('GithubWebhooksController — header extraction and response shape (#313)', () => {
  let verifySignature: jest.Mock;
  let handleEvent: jest.Mock;
  let controller: GithubWebhooksController;

  beforeEach(() => {
    verifySignature = jest.fn().mockReturnValue(true);
    handleEvent = jest.fn().mockResolvedValue({
      id: 'event-9',
      status: WebhookEventStatus.PROCESSED,
    });
    controller = new GithubWebhooksController({
      verifySignature,
      handleEvent,
    } as unknown as GithubWebhooksService);
  });

  it('passes the x-github-event, x-github-delivery and x-hub-signature-256 headers through', async () => {
    const rawBody = Buffer.from('{"action":"opened"}');

    await controller.handle(
      { rawBody, body: { action: 'opened' } } as never,
      'pull_request',
      'delivery-9',
      'sha256=signature-value',
    );

    expect(handleEvent).toHaveBeenCalledWith(
      'pull_request',
      'delivery-9',
      { action: 'opened' },
      true,
    );
    expect(verifySignature).toHaveBeenCalledWith(
      rawBody,
      'sha256=signature-value',
    );
  });

  it('returns the 202 response shape { received, eventId, status }', async () => {
    const result = await controller.handle(
      { rawBody: Buffer.from('{}'), body: {} } as never,
      'ping',
      'delivery-10',
      'sha256=abc',
    );

    expect(result).toEqual({
      received: true,
      eventId: 'event-9',
      status: WebhookEventStatus.PROCESSED,
    });
  });

  it('still returns the 202 shape with the event status when the signature is invalid', async () => {
    verifySignature.mockReturnValue(false);
    handleEvent.mockResolvedValue({
      id: 'event-11',
      status: WebhookEventStatus.IGNORED,
    });

    const result = await controller.handle(
      { rawBody: Buffer.from('{}'), body: {} } as never,
      'push',
      'delivery-11',
      'sha256=bad',
    );

    expect(handleEvent).toHaveBeenCalledWith('push', 'delivery-11', {}, false);
    expect(result).toEqual({
      received: true,
      eventId: 'event-11',
      status: WebhookEventStatus.IGNORED,
    });
  });

  it('throws InternalServerErrorException when event processing fails (#317)', async () => {
    handleEvent.mockResolvedValue({
      id: 'event-failed-1',
      status: WebhookEventStatus.FAILED,
      error: 'escrow release failed',
    });

    await expect(
      controller.handle(
        { rawBody: Buffer.from('{}'), body: {} } as never,
        'pull_request',
        'delivery-fail-1',
        'sha256=abc',
      ),
    ).rejects.toThrow(InternalServerErrorException);
  });

  it('is declared with a 202 HTTP status for the accepted delivery', () => {
    // @HttpCode(202) tells Nest to answer 202 instead of POST's default 201.
    const handler = (
      GithubWebhooksController.prototype as unknown as Record<string, unknown>
    )['handle'] as object;
    const httpCode = Reflect.getMetadata('__httpCode__', handler);
    expect(httpCode).toBe(202);
  });
});
