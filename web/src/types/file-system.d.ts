/**
 * Type declarations for File System Access API
 * These APIs are not yet in TypeScript's standard lib
 */

interface FileSystemHandle {
    kind: "file" | "directory";
    name: string;
}

interface FileSystemFileHandle extends FileSystemHandle {
    kind: "file";
    getFile(): Promise<File>;
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
    kind: "directory";
    values(): AsyncIterableIterator<FileSystemFileHandle | FileSystemDirectoryHandle>;
    getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>;
    getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>;
    requestPermission(descriptor?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
}

interface Window {
    showDirectoryPicker(options?: {
        id?: string;
        mode?: "read" | "readwrite";
        startIn?: FileSystemHandle | "desktop" | "documents" | "downloads" | "music" | "pictures" | "videos";
    }): Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker(options?: {
        multiple?: boolean;
        excludeAcceptAllOption?: boolean;
        types?: Array<{
            description?: string;
            accept: Record<string, string[]>;
        }>;
    }): Promise<FileSystemFileHandle[]>;
}
