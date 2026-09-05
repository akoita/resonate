import request from 'supertest';
import { INestApplication, Logger } from '@nestjs/common';
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
    let loggerErrorSpy: jest.SpyInstance;

    beforeAll(async () => {
        app = await createControllerTestApp(EncryptionController, [
            { provide: EncryptionService, useValue: mockEncryptionService },
            { provide: AuthService, useValue: mockAuthService },
        ]);
        loggerErrorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    });

    afterAll(async () => {
        await app.close();
        loggerErrorSpy.mockRestore();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        loggerErrorSpy.mockClear();
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
        const decryptedAudio = Buffer.from('decrypted');
        mockEncryptionService.decrypt.mockResolvedValueOnce(decryptedAudio);

        const res = await request(app.getHttpServer())
            .post('/encryption/decrypt')
            .set('Authorization', `Bearer ${authToken('owner-user')}`)
            .send({
                uri: 'https://storage.googleapis.com/resonate-stems-dev/originals/stem.mp3',
                authSig,
            })
            .buffer(true)
            .parse((response, callback) => {
                const chunks: Buffer[] = [];
                response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
                response.on('end', () => callback(null, Buffer.concat(chunks)));
            })
            .expect(201);

        expect(res.headers['content-type']).toContain('audio/mpeg');
        expect(res.body).toEqual(decryptedAudio);
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

    it('returns an opaque JSON error when decryption fails', async () => {
        mockAuthService.isAddressForUser.mockResolvedValue(true);
        const marker = '<script>alert("decrypt")</script>';
        mockEncryptionService.decrypt.mockRejectedValueOnce(new Error(marker));

        const res = await request(app.getHttpServer())
            .post('/encryption/decrypt')
            .set('Authorization', `Bearer ${authToken('owner-user')}`)
            .send({
                uri: 'https://storage.googleapis.com/resonate-stems-dev/originals/stem.mp3',
                authSig: {
                    address: '0xLinkedSmartAccount',
                    sig: 'sig',
                    signedMessage: 'message',
                },
            })
            .expect(500)
            .expect('Content-Type', /json/);

        expect(res.body).toEqual({
            error: 'decryption_failed',
            message: 'Decryption failed.',
        });
        expect(res.text).not.toContain(marker);
        expect(loggerErrorSpy).toHaveBeenCalledWith(
            'Encryption decrypt operation failed (provider: aes)',
            expect.stringContaining(marker),
        );
    });

    it('returns an opaque JSON error when decryption throws a non-Error value', async () => {
        mockAuthService.isAddressForUser.mockResolvedValue(true);
        const marker = '<img src=x onerror=alert("decrypt")>';
        mockEncryptionService.decrypt.mockRejectedValueOnce(marker);

        const res = await request(app.getHttpServer())
            .post('/encryption/decrypt')
            .set('Authorization', `Bearer ${authToken('owner-user')}`)
            .send({
                uri: 'https://storage.googleapis.com/resonate-stems-dev/originals/stem.mp3',
                authSig: {
                    address: '0xLinkedSmartAccount',
                    sig: 'sig',
                    signedMessage: 'message',
                },
            })
            .expect(500)
            .expect('Content-Type', /json/);

        expect(res.body).toEqual({
            error: 'decryption_failed',
            message: 'Decryption failed.',
        });
        expect(res.text).not.toContain(marker);
        expect(loggerErrorSpy).toHaveBeenCalledWith(
            'Encryption decrypt operation failed (provider: aes)',
            undefined,
        );
    });
});
