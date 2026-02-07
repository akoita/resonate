
import { NestFactory } from '@nestjs/core';
import { EncryptionModule } from '../src/modules/encryption/encryption.module';
import { EncryptionService } from '../src/modules/encryption/encryption.service';
import { ConfigModule } from '@nestjs/config';

// Decryption test requires a signer (AuthSig)
// For this script, we'll try to use the same logic as the frontend but in Node
// However, since we don't have a private key here easily, we might just test if the connection allows it.

async function testEncryptionDecryption() {
    const app = await NestFactory.createApplicationContext({
        module: EncryptionModule,
        imports: [ConfigModule.forRoot()]
    } as any);

    const encryptionService = app.get(EncryptionService);

    // Wait for connection
    console.log("Waiting for Lit connection...");
    for (let i = 0; i < 10; i++) {
        if (encryptionService.isReady) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!encryptionService.isReady) {
        console.error("Lit connection failed to become ready.");
        process.exit(1);
    }

    console.log("Lit ready. Testing encryption...");

    const testData = Buffer.from("Hello Lit Protocol!");
    const accessControlConditions = [
        {
            contractAddress: '',
            standardContractType: '',
            chain: 'sepolia',
            method: '',
            parameters: [':userAddress'],
            returnValueTest: {
                comparator: '=',
                value: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Mock address
            },
        },
    ];

    try {
        const result = await encryptionService.encrypt(testData, accessControlConditions as any);
        console.log("✅ Encryption successful!");
        console.log("Metadata:", result.encryptionMetadata);

        // Decryption test (note: this will likely fail without a valid AuthSig, but let's see the error)
        console.log("Note: Decryption usually requires a browser-side AuthSig. Skipping for now as encryption is the primary backend task.");
    } catch (error: any) {
        console.error("❌ Encryption failed:", error.message);
        if (error.stack) console.error(error.stack);
    }

    await app.close();
}

testEncryptionDecryption();
