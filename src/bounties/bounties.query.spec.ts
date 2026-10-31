import { ArgumentMetadata, ParseUUIDPipe } from '@nestjs/common';

describe('BountiesController repositoryId query pipe', () => {
  const repositoryIdMetadata: ArgumentMetadata = {
    type: 'query',
    metatype: String,
    data: 'repositoryId',
  };
  const pipe = new ParseUUIDPipe({ version: '4', optional: true });

  it('accepts undefined when repositoryId is omitted', async () => {
    await expect(
      pipe.transform("" as any, repositoryIdMetadata),
    ).resolves.toBeUndefined();
  });

  it('accepts a valid v4 UUID string', async () => {
    const validUuid = 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd';
    await expect(pipe.transform(validUuid, repositoryIdMetadata)).resolves.toBe(
      validUuid,
    );
  });

  it('rejects a non-UUID string with BadRequestException', async () => {
    await expect(
      pipe.transform('not-a-uuid', repositoryIdMetadata),
    ).rejects.toThrow();
  });
});
