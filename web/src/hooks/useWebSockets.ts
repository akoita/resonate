import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface ReleaseStatusUpdate {
    releaseId: string;
    artistId: string;
    title: string;
    status: string;
}

export interface ReleaseProgressUpdate {
    releaseId: string;
    trackId: string;
    progress: number;
}

export interface TrackStatusUpdate {
    releaseId: string;
    trackId: string;
    status: 'pending' | 'separating' | 'encrypting' | 'storing' | 'complete' | 'failed';
}

export interface MarketplaceListingCreated {
    type: 'created';
    listingId: string;
    tokenId: string;
    seller: string;
    price: string;
    amount: string;
}
export interface MarketplaceListingSold {
    type: 'sold';
    listingId: string;
    buyer: string;
    amount: string;
}
export interface MarketplaceListingCancelled {
    type: 'cancelled';
    listingId: string;
}
export type MarketplaceUpdate =
    | MarketplaceListingCreated
    | MarketplaceListingSold
    | MarketplaceListingCancelled;

export interface GenerationStatusUpdate {
    jobId: string;
    userId: string;
    trackId?: string;
    releaseId?: string;
    error?: string;
}

export interface GenerationProgressUpdate {
    jobId: string;
    phase: 'generating' | 'storing' | 'finalizing';
}

export function useWebSockets(
    onStatusUpdate?: (data: ReleaseStatusUpdate) => void,
    onProgressUpdate?: (data: ReleaseProgressUpdate) => void,
    onTrackStatusUpdate?: (data: TrackStatusUpdate) => void,
    onMarketplaceUpdate?: (data: MarketplaceUpdate) => void,
    onGenerationStatus?: (data: GenerationStatusUpdate) => void,
    onGenerationProgress?: (data: GenerationProgressUpdate) => void
) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const statusHandlerRef = useRef(onStatusUpdate);
    const progressHandlerRef = useRef(onProgressUpdate);
    const trackStatusHandlerRef = useRef(onTrackStatusUpdate);
    const marketplaceHandlerRef = useRef(onMarketplaceUpdate);
    const generationStatusHandlerRef = useRef(onGenerationStatus);
    const generationProgressHandlerRef = useRef(onGenerationProgress);

    // Update refs when handlers change without re-triggering effect
    useEffect(() => {
        statusHandlerRef.current = onStatusUpdate;
    }, [onStatusUpdate]);

    useEffect(() => {
        progressHandlerRef.current = onProgressUpdate;
    }, [onProgressUpdate]);

    useEffect(() => {
        trackStatusHandlerRef.current = onTrackStatusUpdate;
    }, [onTrackStatusUpdate]);

    useEffect(() => {
        marketplaceHandlerRef.current = onMarketplaceUpdate;
    }, [onMarketplaceUpdate]);

    useEffect(() => {
        generationStatusHandlerRef.current = onGenerationStatus;
    }, [onGenerationStatus]);

    useEffect(() => {
        generationProgressHandlerRef.current = onGenerationProgress;
    }, [onGenerationProgress]);

    useEffect(() => {
        // Initialize socket connection
        const newSocket = io(SOCKET_URL, {
            transports: ['websocket', 'polling'], // Allow polling fallback
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
        });

        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSocket(newSocket);

        newSocket.on('connect', () => {
            console.log(`[WebSocket] Connected to backend: ${newSocket.id}`);
        });

        newSocket.on('release.status', (data: ReleaseStatusUpdate) => {
            console.log('[WebSocket] Received release.status update:', data);
            if (statusHandlerRef.current) {
                statusHandlerRef.current(data);
            }
        });

        // Also handle release.error using same status handler with 'failed' status
        newSocket.on('release.error', (data: ReleaseStatusUpdate & { error?: string }) => {
            console.log('[WebSocket] Received release.error:', data);
            if (statusHandlerRef.current) {
                statusHandlerRef.current({ ...data, status: 'failed' });
            }
        });

        newSocket.on('release.progress', (data: ReleaseProgressUpdate) => {
            console.log('[WebSocket] Received release.progress update:', data);
            if (progressHandlerRef.current) {
                progressHandlerRef.current(data);
            }
        });

        newSocket.on('track.status', (data: TrackStatusUpdate) => {
            console.log('[WebSocket] Received track.status update:', data);
            if (trackStatusHandlerRef.current) {
                trackStatusHandlerRef.current(data);
            }
        });

        newSocket.on('marketplace.listing_created', (data: Omit<MarketplaceListingCreated, 'type'>) => {
            console.log('[WebSocket] Marketplace listing created:', data);
            if (marketplaceHandlerRef.current) {
                marketplaceHandlerRef.current({ ...data, type: 'created' });
            }
        });

        newSocket.on('marketplace.listing_sold', (data: Omit<MarketplaceListingSold, 'type'>) => {
            console.log('[WebSocket] Marketplace listing sold:', data);
            if (marketplaceHandlerRef.current) {
                marketplaceHandlerRef.current({ ...data, type: 'sold' });
            }
        });

        newSocket.on('marketplace.listing_cancelled', (data: Omit<MarketplaceListingCancelled, 'type'>) => {
            console.log('[WebSocket] Marketplace listing cancelled:', data);
            if (marketplaceHandlerRef.current) {
                marketplaceHandlerRef.current({ ...data, type: 'cancelled' });
            }
        });

        newSocket.on('generation.status', (data: GenerationStatusUpdate) => {
            console.log('[WebSocket] Generation status:', data);
            if (generationStatusHandlerRef.current) {
                generationStatusHandlerRef.current(data);
            }
        });

        newSocket.on('generation.progress', (data: GenerationProgressUpdate) => {
            console.log('[WebSocket] Generation progress:', data);
            if (generationProgressHandlerRef.current) {
                generationProgressHandlerRef.current(data);
            }
        });

        newSocket.on('generation.error', (data: GenerationStatusUpdate) => {
            console.log('[WebSocket] Generation error:', data);
            if (generationStatusHandlerRef.current) {
                generationStatusHandlerRef.current(data);
            }
        });

        newSocket.on('disconnect', (reason) => {
            console.log(`[WebSocket] Disconnected: ${reason}`);
        });

        newSocket.on('connect_error', (error) => {
            console.error('[WebSocket] Connection error:', error);
        });

        return () => {
            console.log('[WebSocket] Cleaning up connection');
            newSocket.disconnect();
            setSocket(null);
        };
    }, []); // Empty dependency array means this only runs once on mount

    return socket;
}
