import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageProvider } from './storage_provider';
import { LocalStorageProvider } from './local_storage_provider';
import { LighthouseStorageProvider } from './lighthouse_storage_provider';
import { GcsStorageProvider } from './gcs_storage_provider';

@Global()
@Module({
    imports: [ConfigModule],
    providers: [
        {
            provide: StorageProvider,
            useFactory: (configService: ConfigService) => {
                const provider = configService.get<string>('STORAGE_PROVIDER', 'local');
                if (provider === 'gcs') {
                    return new GcsStorageProvider(configService);
                }
                if (provider === 'ipfs' || provider === 'filecoin') {
                    return new LighthouseStorageProvider(configService);
                }
                return new LocalStorageProvider();
            },
            inject: [ConfigService],
        },
    ],
    exports: [StorageProvider],
})
export class StorageModule { }
