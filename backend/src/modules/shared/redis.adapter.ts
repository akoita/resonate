import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { Logger } from '@nestjs/common';
import { ServerOptions } from 'socket.io';

/**
 * Custom Socket.IO adapter backed by Redis pub/sub.
 *
 * When multiple Cloud Run instances are running, each instance
 * connects to the same Redis and Socket.IO events emitted on one
 * instance are automatically delivered to clients on all instances.
 *
 * @see https://socket.io/docs/v4/redis-adapter/
 */
export class RedisIoAdapter extends IoAdapter {
    private readonly logger = new Logger(RedisIoAdapter.name);
    private adapterConstructor!: ReturnType<typeof createAdapter>;

    async connectToRedis(): Promise<void> {
        const host = process.env.REDIS_HOST || 'localhost';
        const port = process.env.REDIS_PORT || '6379';
        const url = `redis://${host}:${port}`;

        const pubClient = createClient({ url });
        const subClient = pubClient.duplicate();

        pubClient.on('error', (err) => this.logger.error('Redis pub client error:', err));
        subClient.on('error', (err) => this.logger.error('Redis sub client error:', err));

        await Promise.all([pubClient.connect(), subClient.connect()]);

        this.adapterConstructor = createAdapter(pubClient, subClient);
        this.logger.log(`Connected to Redis at ${url} for Socket.IO adapter`);
    }

    createIOServer(port: number, options?: ServerOptions) {
        const server = super.createIOServer(port, options);
        server.adapter(this.adapterConstructor);
        return server;
    }
}
