import { RedisIoAdapter } from '../modules/shared/redis.adapter';

// Mock redis — createClient returns a mock that can connect/disconnect
jest.mock('redis', () => {
    const mockClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        duplicate: jest.fn(),
        on: jest.fn(),
    };
    // duplicate returns a clone with the same interface
    mockClient.duplicate.mockReturnValue({
        connect: jest.fn().mockResolvedValue(undefined),
        on: jest.fn(),
    });
    return {
        createClient: jest.fn().mockReturnValue(mockClient),
    };
});

// Mock @socket.io/redis-adapter
jest.mock('@socket.io/redis-adapter', () => ({
    createAdapter: jest.fn().mockReturnValue('redis-adapter-instance'),
}));

describe('RedisIoAdapter', () => {
    let adapter: RedisIoAdapter;

    beforeEach(() => {
        // Pass a minimal app-like object
        adapter = new RedisIoAdapter({ getHttpServer: () => ({}) } as any);
    });

    it('connects pub/sub clients to Redis', async () => {
        const { createClient } = require('redis');
        await adapter.connectToRedis();

        expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
        const mockClient = createClient.mock.results[0].value;
        expect(mockClient.connect).toHaveBeenCalled();
        expect(mockClient.duplicate).toHaveBeenCalled();
    });

    it('uses REDIS_HOST and REDIS_PORT env vars', async () => {
        process.env.REDIS_HOST = '10.0.0.5';
        process.env.REDIS_PORT = '6380';

        const { createClient } = require('redis');
        createClient.mockClear();

        adapter = new RedisIoAdapter({ getHttpServer: () => ({}) } as any);
        await adapter.connectToRedis();

        expect(createClient).toHaveBeenCalledWith({ url: 'redis://10.0.0.5:6380' });

        delete process.env.REDIS_HOST;
        delete process.env.REDIS_PORT;
    });

    it('creates the Socket.IO Redis adapter', async () => {
        const { createAdapter } = require('@socket.io/redis-adapter');
        await adapter.connectToRedis();

        expect(createAdapter).toHaveBeenCalled();
    });
});
