import { GithubWebhooksController } from './github-webhooks.controller';
import { GithubWebhooksService } from './github-webhooks.service';

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
