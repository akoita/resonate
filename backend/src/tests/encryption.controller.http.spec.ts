import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { EncryptionController } from '../modules/encryption/encryption.controller';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { AuthService } from '../modules/auth/auth.service';
import { authToken, createControllerTestApp } from './e2e-helpers';

const mockEncryptionService = {
    providerName: 'aes',
    decrypt: jest.fn(),
    loadSourceBuffer: jest.fn(),
};
const mockAuthService = {
    isAddressForUser: jest.fn(),
};

describe('EncryptionController (HTTP contract)', () => {
    let app: INestApplication;

    beforeAll(async () => {
        app = await createControllerTestApp(EncryptionController, [
            { provide: EncryptionService, useValue: mockEncryptionService },
            { provide: AuthService, useValue: mockAuthService },
        ]);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthService.isAddressForUser.mockResolvedValue(false);
        mockEncryptionService.decrypt.mockResolvedValue(Buffer.from('decrypted'));
        mockEncryptionService.loadSourceBuffer.mockResolvedValue(Buffer.from('audio'));
    });

    it('POST /encryption/decrypt returns 401 without JWT', async () => {
        await request(app.getHttpServer())
            .post('/encryption/decrypt')
            .send({
                uri: 'https://storage.googleapis.com/resonate-stems-dev/originals/stem.mp3',
                authSig: { address: 'user-1', sig: 'sig', signedMessage: 'message' },
            })
            .expect(401);
        expect(mockEncryptionService.decrypt).not.toHaveBeenCalled();
    });

    it('POST /encryption/download returns 401 without JWT', async () => {
        await request(app.getHttpServer())
            .post('/encryption/download')
            .send({ stemId: 'stem-1', walletAddress: 'user-1' })
            .expect(401);
        expect(mockEncryptionService.decrypt).not.toHaveBeenCalled();
        expect(mockEncryptionService.loadSourceBuffer).not.toHaveBeenCalled();
    });

    it('rejects decrypt authSig identity mismatch before the service boundary', async () => {
        await request(app.getHttpServer())
            .post('/encryption/decrypt')
            .set('Authorization', `Bearer ${authToken('user-1')}`)
            .send({
                uri: 'https://storage.googleapis.com/resonate-stems-dev/originals/stem.mp3',
                authSig: { address: 'attacker', sig: 'sig', signedMessage: 'message' },
            })
            .expect(403);

        expect(mockEncryptionService.decrypt).not.toHaveBeenCalled();
        expect(mockEncryptionService.loadSourceBuffer).not.toHaveBeenCalled();
    });

    it('rejects download wallet identity mismatch before Prisma or storage access', async () => {
        await request(app.getHttpServer())
            .post('/encryption/download')
            .set('Authorization', `Bearer ${authToken('user-1')}`)
            .send({ stemId: 'stem-1', walletAddress: 'attacker' })
            .expect(403);

        expect(mockEncryptionService.decrypt).not.toHaveBeenCalled();
        expect(mockEncryptionService.loadSourceBuffer).not.toHaveBeenCalled();
    });

    it('allows a persisted linked wallet claim and preserves it for decryption', async () => {
        mockAuthService.isAddressForUser.mockResolvedValue(true);
        const authSig = {
            address: '0xLinkedSmartAccount',
            sig: 'sig',
            signedMessage: 'message',
        };

        await request(app.getHttpServer())
            .post('/encryption/decrypt')
            .set('Authorization', `Bearer ${authToken('owner-user')}`)
            .send({
                uri: 'https://storage.googleapis.com/resonate-stems-dev/originals/stem.mp3',
                authSig,
            })
            .expect(201);

        expect(mockAuthService.isAddressForUser).toHaveBeenCalledWith(
            'owner-user',
            authSig.address,
        );
        expect(mockEncryptionService.decrypt).toHaveBeenCalledWith(
            expect.any(String),
            '',
            [],
            authSig,
        );
    });
});
