import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { EncryptionModule } from '../modules/encryption/encryption.module';
import { EncryptionService } from '../modules/encryption/encryption.service';
import { StorageProvider } from '../modules/storage/storage_provider';

describe('EncryptionModule wiring', () => {
  it('injects StorageProvider into EncryptionService', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              ENCRYPTION_PROVIDER: 'none',
              STORAGE_PROVIDER: 'local',
            }),
          ],
        }),
        EncryptionModule,
      ],
    }).compile();

    const encryptionService = moduleRef.get(EncryptionService);
    const storageProvider = moduleRef.get(StorageProvider);

    expect(encryptionService).toBeDefined();
    expect(storageProvider).toBeDefined();
    expect((encryptionService as any).storageProvider).toBe(storageProvider);

    await moduleRef.close();
  });
});
