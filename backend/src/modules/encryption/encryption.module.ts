import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';
import { EncryptionController } from './encryption.controller';
import { AesEncryptionProvider, NoopEncryptionProvider } from './providers';

/**
 * Encryption Module
 * 
 * Provides encryption services with configurable providers.
 * 
 * Environment variables:
 * - ENCRYPTION_ENABLED: 'true' | 'false' (default: 'true')
 * - ENCRYPTION_PROVIDER: 'aes' | 'lit' | 'none' (default: 'aes')
 * - ENCRYPTION_SECRET: Secret for AES key derivation (falls back to JWT_SECRET)
 */
@Global()
@Module({
    imports: [ConfigModule],
    controllers: [EncryptionController],
    providers: [
        {
            provide: 'ENCRYPTION_PROVIDER',
            useFactory: (configService: ConfigService) => {
                const enabled = configService.get<string>('ENCRYPTION_ENABLED', 'true') === 'true';
                const providerType = configService.get<string>('ENCRYPTION_PROVIDER', 'aes');

                if (!enabled || providerType === 'none') {
                    return new NoopEncryptionProvider();
                }

                switch (providerType) {
                    case 'aes':
                        return new AesEncryptionProvider(configService);
                    // Future providers:
                    // case 'lit':
                    //     return new LitEncryptionProvider(configService);
                    // case 'threshold':
                    //     return new ThresholdEncryptionProvider(configService);
                    default:
                        console.warn(`Unknown encryption provider '${providerType}', falling back to AES`);
                        return new AesEncryptionProvider(configService);
                }
            },
            inject: [ConfigService],
        },
        EncryptionService,
    ],
    exports: [EncryptionService, 'ENCRYPTION_PROVIDER'],
})
export class EncryptionModule { }
