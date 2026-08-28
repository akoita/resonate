import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { SynthIdController } from '../modules/generation/synthid.controller';
import { SynthIdService } from '../modules/generation/synthid.service';
import { authToken, createControllerTestApp } from './e2e-helpers';

const mockSynthIdService = {
  isAvailable: jest.fn(),
  verify: jest.fn(),
  verifyStemById: jest.fn(),
};

describe('SynthIdController (HTTP contract)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(SynthIdController, [
      { provide: SynthIdService, useValue: mockSynthIdService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSynthIdService.isAvailable.mockReturnValue(true);
    mockSynthIdService.verify.mockResolvedValue({
      isAiGenerated: false,
      confidence: 0,
    });
    mockSynthIdService.verifyStemById.mockResolvedValue({
      isAiGenerated: true,
      confidence: 0.91,
      provider: 'google-lyria',
    });
  });

  it('rejects persisted-stem verification without JWT before invoking the service', async () => {
    await request(app.getHttpServer())
      .post('/generation/synthid/verify/stem-unauthenticated')
      .expect(401);

    expect(mockSynthIdService.isAvailable).not.toHaveBeenCalled();
    expect(mockSynthIdService.verifyStemById).not.toHaveBeenCalled();
  });

  it('allows authenticated persisted-stem verification and delegates the stem ID', async () => {
    await request(app.getHttpServer())
      .post('/generation/synthid/verify/stem-authenticated')
      .set('Authorization', `Bearer ${authToken('user-1')}`)
      .expect(201);

    expect(mockSynthIdService.verifyStemById).toHaveBeenCalledWith('stem-authenticated');
  });

  it('keeps uploaded-buffer verification available without the persisted-stem guard', async () => {
    const audio = Buffer.from('uploaded-audio');

    await request(app.getHttpServer())
      .post('/generation/synthid/verify')
      .attach('audio', audio, {
        filename: 'uploaded.mp3',
        contentType: 'audio/mpeg',
      })
      .expect(201);

    expect(mockSynthIdService.verify).toHaveBeenCalledWith(audio);
    expect(mockSynthIdService.verifyStemById).not.toHaveBeenCalled();
  });
});
