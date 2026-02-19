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
import { CatalogReleaseReadyEvent, CatalogTrackStatusEvent, StemsUploadedEvent, GenerationStartedEvent, GenerationProgressEvent, GenerationCompletedEvent, GenerationFailedEvent } from '../../events/event_types';

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

        // ---- Agent events → broadcast as 'agent.event' ----

        this.eventBus.subscribe('session.started', (event: any) => {
            console.log(`[EventsGateway] Agent session started: ${event.sessionId}`);
            if (this.server) {
                this.server.emit('agent.event', {
                    id: `${event.sessionId}-started`,
                    type: 'session.started',
                    sessionId: event.sessionId,
                    message: 'Agent session started',
                    timestamp: event.occurredAt,
                });
            }
        });

        this.eventBus.subscribe('session.ended', (event: any) => {
            console.log(`[EventsGateway] Agent session ended: ${event.sessionId}`);
            if (this.server) {
                this.server.emit('agent.event', {
                    id: `${event.sessionId}-ended`,
                    type: 'session.ended',
                    sessionId: event.sessionId,
                    message: 'Agent session ended',
                    timestamp: event.occurredAt,
                });
            }
        });

        this.eventBus.subscribe('agent.selection', (event: any) => {
            if (this.server) {
                const count = event.count ?? 1;
                const total = event.candidates?.length ?? 0;
                this.server.emit('agent.event', {
                    id: `${event.sessionId}-sel-${event.trackId}`,
                    type: 'agent.selection',
                    sessionId: event.sessionId,
                    message: `Found ${total} tracks, selected ${count} for curation`,
                    timestamp: event.occurredAt,
                    detail: `Selected ${count} from ${total} candidates`,
                });
            }
        });

        this.eventBus.subscribe('agent.mix_planned', (event: any) => {
            if (this.server) {
                const title = event.trackTitle ?? event.trackId;
                this.server.emit('agent.event', {
                    id: `${event.sessionId}-mix-${event.trackId}`,
                    type: 'agent.mix_planned',
                    sessionId: event.sessionId,
                    message: `Planning mix for "${title}" — ${event.transition}`,
                    timestamp: event.occurredAt,
                });
            }
        });

        this.eventBus.subscribe('agent.negotiated', (event: any) => {
            if (this.server) {
                const title = event.trackTitle ?? event.trackId;
                this.server.emit('agent.event', {
                    id: `${event.sessionId}-neg-${event.trackId}`,
                    type: 'agent.negotiated',
                    sessionId: event.sessionId,
                    message: `Negotiated "${title}": $${event.priceUsd} (${event.licenseType})`,
                    timestamp: event.occurredAt,
                });
            }
        });

        this.eventBus.subscribe('agent.decision_made', (event: any) => {
            if (this.server) {
                let msg: string;
                if (event.reason === 'no_tracks') {
                    msg = 'No matching tracks found in catalog';
                } else if (event.reason === 'error') {
                    msg = 'Curation encountered an error';
                } else if (event.reasoning || event.latencyMs != null) {
                    // LLM adapter result — single track with reasoning
                    const latency = event.latencyMs != null ? ` (${(event.latencyMs / 1000).toFixed(1)}s)` : '';
                    const price = event.priceUsd != null ? ` — $${Number(event.priceUsd).toFixed(2)}` : '';
                    msg = event.trackId
                        ? `AI selected track${price}${latency}`
                        : `AI could not find a suitable track${latency}`;
                    if (event.reasoning) {
                        msg += `: ${event.reasoning}`;
                    }
                } else {
                    // Orchestrator pipeline result — batch of tracks
                    const count = event.trackCount ?? 0;
                    const spend = event.totalSpend != null ? `$${event.totalSpend.toFixed(2)}` : '';
                    msg = `Curation complete: ${count} track${count !== 1 ? 's' : ''} selected${spend ? `, ${spend} total` : ''}`;
                }
                this.server.emit('agent.event', {
                    id: `${event.sessionId}-dec-${Date.now()}`,
                    type: 'agent.decision_made',
                    sessionId: event.sessionId,
                    message: msg,
                    timestamp: event.occurredAt,
                });
            }
        });

        // ---- Marketplace events → broadcast for real-time UI updates ----

        this.eventBus.subscribe('contract.stem_listed', (event: any) => {
            console.log(`[EventsGateway] Stem listed: listingId=${event.listingId}, broadcasting...`);
            if (this.server) {
                this.server.emit('marketplace.listing_created', {
                    listingId: event.listingId,
                    tokenId: event.tokenId,
                    seller: event.sellerAddress,
                    price: event.pricePerUnit,
                    amount: event.amount,
                });
            }
        });

        this.eventBus.subscribe('contract.stem_sold', (event: any) => {
            console.log(`[EventsGateway] Stem sold: listingId=${event.listingId}, broadcasting...`);
            if (this.server) {
                this.server.emit('marketplace.listing_sold', {
                    listingId: event.listingId,
                    buyer: event.buyerAddress,
                    amount: event.amount,
                });
            }
        });

        this.eventBus.subscribe('contract.listing_cancelled', (event: any) => {
            console.log(`[EventsGateway] Listing cancelled: listingId=${event.listingId}, broadcasting...`);
            if (this.server) {
                this.server.emit('marketplace.listing_cancelled', {
                    listingId: event.listingId,
                });
            }
        });

        // ---- Generation events → broadcast real-time generation status ----

        this.eventBus.subscribe('generation.started', (event: GenerationStartedEvent) => {
            console.log(`[EventsGateway] Generation started: jobId=${event.jobId}`);
            if (this.server) {
                this.server.emit('generation.status', {
                    jobId: event.jobId,
                    status: 'generating',
                    prompt: event.prompt,
                });
            }
        });

        this.eventBus.subscribe('generation.progress', (event: GenerationProgressEvent) => {
            if (this.server) {
                this.server.emit('generation.progress', {
                    jobId: event.jobId,
                    phase: event.phase,
                });
            }
        });

        this.eventBus.subscribe('generation.completed', (event: GenerationCompletedEvent) => {
            console.log(`[EventsGateway] Generation completed: jobId=${event.jobId}, trackId=${event.trackId}`);
            if (this.server) {
                this.server.emit('generation.status', {
                    jobId: event.jobId,
                    status: 'completed',
                    trackId: event.trackId,
                    releaseId: event.releaseId,
                });
            }
        });

        this.eventBus.subscribe('generation.failed', (event: GenerationFailedEvent) => {
            console.log(`[EventsGateway] Generation failed: jobId=${event.jobId}: ${event.error}`);
            if (this.server) {
                this.server.emit('generation.error', {
                    jobId: event.jobId,
                    error: event.error,
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
