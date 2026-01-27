"use client";

import { useCallback, useRef, useState } from "react";

type FileDropZoneProps = {
    onFileSelect: (file: File) => void;
    onFilesSelect?: (files: File[]) => void;
    accept?: string;
    disabled?: boolean;
    multiple?: boolean;
    directory?: boolean;
};

export function FileDropZone({
    onFileSelect,
    onFilesSelect,
    accept = "audio/*",
    disabled = false,
    multiple = false,
    directory = false,
}: FileDropZoneProps) {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (!disabled) {
                setIsDragging(true);
            }
        },
        [disabled]
    );

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    }, []);

    const traverseFileTree = useCallback(async (entry: FileSystemEntry): Promise<File[]> => {
        const results: File[] = [];

        async function recursiveTraverse(item: FileSystemEntry) {
            if (item.isFile) {
                const fileEntry = item as FileSystemFileEntry;
                return new Promise<void>((resolve) => {
                    fileEntry.file((file: File) => {
                        const audioTypes = ["audio/mpeg", "audio/wav", "audio/flac", "audio/aiff", "audio/x-aiff", "audio/m4a", "audio/ogg"];
                        if (audioTypes.some(type => file.type.includes(type.split("/")[1] ?? "")) ||
                            file.name.match(/\.(mp3|wav|flac|aiff|m4a|ogg)$/i)) {
                            results.push(file);
                        }
                        resolve();
                    });
                });
            } else if (item.isDirectory) {
                const dirEntry = item as FileSystemDirectoryEntry;
                const dirReader = dirEntry.createReader();
                const entries = await new Promise<FileSystemEntry[]>((resolve) => dirReader.readEntries(resolve));
                for (const entryItem of entries) {
                    await recursiveTraverse(entryItem);
                }
            }
        }

        await recursiveTraverse(entry);
        return results;
    }, []);

    const handleDrop = useCallback(
        async (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            setIsDragging(false);

            if (disabled) return;

            const items = e.dataTransfer.items;
            if (items && items.length > 0) {
                const entryPromises = Array.from(items).map(item => {
                    const entry = item.webkitGetAsEntry();
                    if (entry) {
                        return traverseFileTree(entry);
                    }
                    return Promise.resolve([]);
                });

                const fileArrays = await Promise.all(entryPromises);
                const allFiles = fileArrays.flat();

                if (allFiles.length > 0) {
                    if (multiple && onFilesSelect) {
                        onFilesSelect(allFiles);
                    } else {
                        onFileSelect(allFiles[0]);
                    }
                }
            } else {
                // Fallback for browsers that don't support items
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    if (multiple && onFilesSelect) {
                        onFilesSelect(Array.from(files));
                    } else {
                        onFileSelect(files[0]);
                    }
                }
            }
        },
        [disabled, onFileSelect, multiple, onFilesSelect, traverseFileTree]
    );

    const handleClick = useCallback(() => {
        if (!disabled && inputRef.current) {
            inputRef.current.click();
        }
    }, [disabled]);

    const handleInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                if (multiple && onFilesSelect) {
                    const fileArray = Array.from(files).filter(f =>
                        f.type.startsWith("audio/") || f.name.match(/\.(mp3|wav|flac|aiff|m4a|ogg)$/i)
                    );
                    if (fileArray.length > 0) {
                        onFilesSelect(fileArray);
                    }
                } else {
                    const file = files[0];
                    if (file) {
                        onFileSelect(file);
                    }
                }
            }
            // Reset input so the same file can be selected again
            e.target.value = "";
        },
        [multiple, onFileSelect, onFilesSelect]
    );

    return (
        <div
            className={`file-drop-zone ${isDragging ? "file-drop-zone-active" : ""} ${disabled ? "file-drop-zone-disabled" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            role="button"
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    handleClick();
                }
            }}
        >
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={handleInputChange}
                style={{ display: "none" }}
                disabled={disabled}
                multiple={multiple}
                {...(directory ? { webkitdirectory: "" } : {})}
            />
            <div className="file-drop-zone-icon">
                <svg
                    width="32"
                    height="32"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
            </div>
            <span className="file-drop-zone-primary">
                {multiple
                    ? <>Drop audio files here or <span className="file-drop-zone-link">browse</span></>
                    : <>Drop audio file here or <span className="file-drop-zone-link">browse</span></>
                }
            </span>
            <span className="file-drop-zone-secondary">
                {directory ? "Select a folder to import all audio files" : "Supports MP3, WAV, FLAC, AIFF"}
            </span>
        </div>
    );
}
