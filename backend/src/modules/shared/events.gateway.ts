import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from './event_bus';
import { CatalogReleaseReadyEvent, CatalogTrackStatusEvent, StemsUploadedEvent } from '../../events/event_types';

@WebSocketGateway({
    cors: {
        origin: '*',
    },
    transports: ['websocket', 'polling'],
})
@Injectable()
export class EventsGateway implements OnModuleInit, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
    @WebSocketServer() server!: Server;

    constructor(private readonly eventBus: EventBus) {
        this.subscribeToEvents();
    }

    onModuleInit() { }

    private subscribeToEvents() {
        this.eventBus.subscribe('stems.progress' as any, (event: any) => {
            if (this.server) {
                this.server.emit('release.progress', {
                    releaseId: event.releaseId,
                    trackId: event.trackId,
                    progress: event.progress,
                });
            }
        });

        this.eventBus.subscribe('stems.uploaded', (event: StemsUploadedEvent) => {
            console.log(`[EventsGateway] Received stems.uploaded for ${event.releaseId}, broadcasting...`);
            if (this.server) {
                this.server.emit('release.status', {
                    releaseId: event.releaseId,
                    artistId: event.artistId,
                    title: event.metadata?.title || 'Unknown Release',
                    status: 'processing',
                });
            } else {
                console.warn('[EventsGateway] Server not initialized, cannot broadcast stems.uploaded');
            }
        });

        this.eventBus.subscribe('catalog.release_ready', (event: CatalogReleaseReadyEvent) => {
            console.log(`[EventsGateway] Received catalog.release_ready for ${event.releaseId}, broadcasting...`);
            if (this.server) {
                this.server.emit('release.status', {
                    releaseId: event.releaseId,
                    artistId: event.artistId,
                    title: event.metadata?.title || 'Unknown Release',
                    status: 'ready',
                });
            } else {
                console.warn('[EventsGateway] Server not initialized, cannot broadcast catalog.release_ready');
            }
        });

        this.eventBus.subscribe('stems.failed', (event: any) => {
            console.log(`[EventsGateway] Received stems.failed for ${event.releaseId}, broadcasting...`);
            if (this.server) {
                this.server.emit('release.error', {
                    releaseId: event.releaseId,
                    artistId: event.artistId,
                    error: event.error,
                    status: 'failed',
                });
            }
        });

        this.eventBus.subscribe('catalog.track_status', (event: CatalogTrackStatusEvent) => {
            console.log(`[EventsGateway] Received catalog.track_status for track ${event.trackId}: ${event.status}`);
            if (this.server) {
                this.server.emit('track.status', {
                    releaseId: event.releaseId,
                    trackId: event.trackId,
                    status: event.status,
                });
            }
        });
    }

    afterInit(server: Server) {
        console.log('[EventsGateway] Initialized');
    }

    handleConnection(client: Socket) {
        console.log(`[EventsGateway] Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        console.log(`[EventsGateway] Client disconnected: ${client.id}`);
    }
}
