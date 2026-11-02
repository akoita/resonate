"use client";

import { useState } from "react";
import { useToast } from "../ui/Toast";
import {
    addFolderOnThisDevice,
    describeLinkResult,
    type OtherDeviceFolder,
} from "../../lib/otherDeviceFolders";
import { isFileSystemAccessSupported } from "../../lib/librarySettings";

/**
 * Files in the account that this device cannot reach. They are hidden by
 * default; this notice says how many there are, lets the listener show them
 * greyed out, and offers to add each folder here so they play on this device
 * too (the scan links them by their path inside the folder and size).
 */
export function OtherDeviceFilesNotice({
    folders,
    showing,
    onToggleShowing,
    onLinked,
    showToggle = true,
}: {
    folders: OtherDeviceFolder[];
    showing: boolean;
    onToggleShowing?: (show: boolean) => void;
    /** Called after a folder was added and scanned, to reload the library. */
    onLinked?: () => void | Promise<void>;
    showToggle?: boolean;
}) {
    const { addToast } = useToast();
    const [linking, setLinking] = useState(false);
    const total = folders.reduce((sum, folder) => sum + folder.count, 0);
    if (total === 0) return null;

    const canAddFolders = typeof window !== "undefined" && isFileSystemAccessSupported();
    const named = folders.filter((folder) => folder.name);

    const handleAdd = async () => {
        setLinking(true);
        try {
            const result = await addFolderOnThisDevice();
            if (result.status === "cancelled") return;
            addToast({
                type: result.linked > 0 ? "success" : "info",
                title: result.linked > 0 ? "Folder linked" : `“${result.folderName}” scanned`,
                message: describeLinkResult(result),
            });
            await onLinked?.();
        } catch {
            addToast({ type: "error", title: "Could not add the folder", message: "Try again, or add it from Settings › Library." });
        } finally {
            setLinking(false);
        }
    };

    return (
        <div className="other-device-files" role="note" data-testid="other-device-files">
            <p className="other-device-files__text">
                <strong>
                    {total} of your file{total === 1 ? " is" : "s are"} not on this device.
                </strong>{" "}
                {named.length > 0 ? (
                    <>
                        {named.length === 1 ? "They are in the folder " : "They are in the folders "}
                        {named.map((folder, index) => (
                            <span key={folder.name}>
                                {index > 0 ? (index === named.length - 1 ? " and " : ", ") : ""}
                                <span className="other-device-files__folder">“{folder.name}”</span>
                                {named.length > 1 ? ` (${folder.count})` : ""}
                            </span>
                        ))}
                        {" "}on another device.
                    </>
                ) : (
                    "They were added on another device."
                )}{" "}
                {canAddFolders
                    ? "If that folder is on this device too, add it here and they will play here as well."
                    : "Open Resonate in Chrome, Edge or the desktop app to add folders on this device."}
            </p>
            <div className="other-device-files__actions">
                {canAddFolders ? (
                    <button
                        type="button"
                        className="other-device-files__add"
                        onClick={() => void handleAdd()}
                        disabled={linking}
                    >
                        {linking ? "Scanning…" : named.length === 1 ? `Add “${named[0]!.name}” here` : "Add a folder here"}
                    </button>
                ) : null}
                {showToggle && onToggleShowing ? (
                    <label className="library-switch">
                        <input
                            type="checkbox"
                            checked={showing}
                            onChange={(event) => onToggleShowing(event.target.checked)}
                            className="library-switch__input"
                        />
                        Show them greyed out
                    </label>
                ) : null}
            </div>
        </div>
    );
}
