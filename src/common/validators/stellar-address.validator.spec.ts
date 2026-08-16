import {
  Controller,
  Post,
  Body,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  IsStellarAddress,
  isValidStellarAddress,
} from './stellar-address.validator';
import { FundEscrowDto } from '../../escrow/dto/fund-escrow.dto';
import { ReleaseEscrowDto } from '../../escrow/dto/release-escrow.dto';
import { SplitReleaseDto } from '../../escrow/dto/split-release.dto';
import { AssetType } from '../enums';

class TestAddressDto {
  @IsStellarAddress()
  address: string;
}

@Controller('test-stellar-address')
class TestAddressController {
  @Post('validate')
  validate(@Body() dto: TestAddressDto) {
    return { ok: true, address: dto.address };
  }

  @Post('fund')
  fund(@Body() dto: FundEscrowDto) {
    return { ok: true, dto };
  }

  @Post('release')
  release(@Body() dto: ReleaseEscrowDto) {
    return { ok: true, dto };
  }

  @Post('split-release')
  splitRelease(@Body() dto: SplitReleaseDto) {
    return { ok: true, dto };
  }
}

const VALID_STELLAR_ADDRESS =
  'GAZRVG3HD4DYUK22IPELHZLMKLBUDUNILCL2OCDQPSVLRJSCCDD7OS5C';
const VALID_STELLAR_ADDRESS_2 =
  'GAR2PDKGEZXQP5X2EFMOSLJXI26HATS6VZVZATOMCWKXU26UASMJTCH5';

describe('Stellar Address Validation (#60)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [TestAddressController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('isValidStellarAddress unit check', () => {
    it('accepts a valid Ed25519 public key', () => {
      expect(isValidStellarAddress(VALID_STELLAR_ADDRESS)).toBe(true);
      expect(isValidStellarAddress(VALID_STELLAR_ADDRESS_2)).toBe(true);
    });

    it.each([
      ['empty string', ''],
      ['non-string', 12345],
      ['null', null],
      ['undefined', undefined],
      ['short string', 'GABC123'],
      [
        'not starting with G',
        'SBCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ23',
      ],
      [
        'invalid base32 characters',
        'G18901890189018901890189018901890189018901890189018901890',
      ],
      [
        '56-char checksum failure',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ],
    ])('rejects invalid address format: %s', (_, val) => {
      expect(isValidStellarAddress(val)).toBe(false);
    });
  });

  describe('HTTP boundary validation via ValidationPipe', () => {
    it('accepts valid Stellar address in payload', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-stellar-address/validate')
        .send({ address: VALID_STELLAR_ADDRESS });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ ok: true, address: VALID_STELLAR_ADDRESS });
    });

    it.each([
      ['empty string', ''],
      ['garbage string', 'not-an-address'],
      ['wrong length', 'GABC123456'],
      [
        'checksum-invalid 56-char',
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      ],
    ])(
      'rejects bad address (%s) with 400 Bad Request',
      async (_, badAddress) => {
        const res = await request(app.getHttpServer())
          .post('/test-stellar-address/validate')
          .send({ address: badAddress });

        expect(res.status).toBe(400);
        const body = res.body as { message: string[] };
        expect(body.message).toEqual(
          expect.arrayContaining([
            expect.stringContaining('must be a valid Stellar public key'),
          ]),
        );
      },
    );

    it('rejects FundEscrowDto with malformed funderAddress at HTTP boundary', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-stellar-address/fund')
        .send({
          amount: '100.0000000',
          asset: AssetType.USDC,
          funderAddress: 'invalid-funder-address',
          bountyId: 'b0000000-0000-4000-8000-000000000001',
        });

      expect(res.status).toBe(400);
      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'funderAddress must be a valid Stellar public key',
          ),
        ]),
      );
    });

    it('accepts FundEscrowDto with valid funderAddress', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-stellar-address/fund')
        .send({
          amount: '100.0000000',
          asset: AssetType.USDC,
          funderAddress: VALID_STELLAR_ADDRESS,
          bountyId: 'b0000000-0000-4000-8000-000000000001',
        });

      expect(res.status).toBe(201);
      const body = res.body as { ok: boolean };
      expect(body.ok).toBe(true);
    });

    it('rejects ReleaseEscrowDto with malformed recipientAddress at HTTP boundary', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-stellar-address/release')
        .send({
          recipientAddress:
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        });

      expect(res.status).toBe(400);
      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'recipientAddress must be a valid Stellar public key',
          ),
        ]),
      );
    });

    it('rejects SplitReleaseDto with malformed recipientAddress in nested array', async () => {
      const res = await request(app.getHttpServer())
        .post('/test-stellar-address/split-release')
        .send({
          recipients: [
            { recipientAddress: VALID_STELLAR_ADDRESS, percentage: 50 },
            { recipientAddress: 'bad-address', percentage: 50 },
          ],
        });

      expect(res.status).toBe(400);
      const body = res.body as { message: string[] };
      expect(body.message).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            'recipients.1.recipientAddress must be a valid Stellar public key',
          ),
        ]),
      );
    });
  });
});
