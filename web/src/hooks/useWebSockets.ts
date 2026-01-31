import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

export interface ReleaseStatusUpdate {
    releaseId: string;
    artistId: string;
    title: string;
    status: string;
}

export function useWebSockets(onStatusUpdate?: (data: ReleaseStatusUpdate) => void) {
    const [socket, setSocket] = useState<Socket | null>(null);
    const handlerRef = useRef(onStatusUpdate);

    // Update ref when handler changes without re-triggering effect
    useEffect(() => {
        handlerRef.current = onStatusUpdate;
    }, [onStatusUpdate]);

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
            if (handlerRef.current) {
                handlerRef.current(data);
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
