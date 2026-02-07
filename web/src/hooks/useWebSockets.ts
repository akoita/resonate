import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

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

export function useWebSockets(
    onStatusUpdate?: (data: ReleaseStatusUpdate) => void,
    onProgressUpdate?: (data: ReleaseProgressUpdate) => void,
    onTrackStatusUpdate?: (data: TrackStatusUpdate) => void
) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const statusHandlerRef = useRef(onStatusUpdate);
    const progressHandlerRef = useRef(onProgressUpdate);
    const trackStatusHandlerRef = useRef(onTrackStatusUpdate);

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
