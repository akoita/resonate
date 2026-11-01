/**
 * What a listener's own audio file is called when its tags say nothing.
 *
 * Many files carry no tags at all, only a name such as
 * `15-you-carried-me-home-(a-cappella-version).mp3`, and many folders keep
 * their cover as a sidecar image (`Folder.jpg`, `cover.jpg`,
 * `AlbumArtSmall.jpg`) instead of embedding it. The scanner falls back to the
 * file name and the folders around it, the way desktop players do.
 */

const AUDIO_EXTENSION = /\.[^/.]+$/;

/** Folder names that say nothing about an album or an artist. */
const GENERIC_FOLDER = new RegExp(
    "^(music|my music|musique|musik|música|audio|mp3s?|flac|songs?|tracks?|downloads?|" +
        "téléchargements|desktop|bureau|documents?|my documents|users?|home|media|" +
        "itunes|itunes media|library|bibliothèque|new folder|nouveau dossier|unknown|various|" +
        "various artists|discs?|albums?|[a-z]:)$",
    "i",
);

/** "CD1", "Disc 2", "Disque 1": a disc of the album one level up. */
const DISC_FOLDER = /^(cd|dis[ck]|disque)\s*[-_]?\s*\d+$/i;

/**
 * A readable title from a file name: drop the extension and a leading track
 * number, and turn a slug's hyphens or underscores into spaces.
 */
export function titleFromFileName(fileName: string): string {
    const stem = fileName.replace(AUDIO_EXTENSION, "").trim();
    let title = stem.replace(/^\d{1,3}\s*(?:[-._)]\s*|\s+)(?=\S)/, "");
    if (!/\s/.test(title) && /[-_]/.test(title)) {
        title = title.replace(/[-_]+/g, " ");
    }
    title = title.replace(/\s+/g, " ").trim();
    if (!title) return stem || fileName;
    if (title === title.toLowerCase()) {
        title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    return title;
}

/**
 * Album and artist read from the folders around a file: `…/Artist/Album/01.mp3`.
 * `path` is relative to the folder the listener picked, whose name is
 * `rootName`; the picked folder counts as a level too.
 */
export function folderMetadataFromPath(
    path: string,
    rootName?: string | null,
): { album: string | null; artist: string | null } {
    const folders = [...(rootName ? [rootName] : []), ...path.split("/").slice(0, -1)]
        .map((name) => name.trim())
        .filter(Boolean);
    // A disc folder belongs to the album above it.
    if (folders.length > 1 && DISC_FOLDER.test(folders[folders.length - 1]!)) folders.pop();
    const album = folders[folders.length - 1];
    if (!album || GENERIC_FOLDER.test(album)) return { album: null, artist: null };
    const artist = folders[folders.length - 2];
    return {
        album,
        artist: artist && !GENERIC_FOLDER.test(artist) ? artist : null,
    };
}

/** Sidecar cover names, best first. */
const FOLDER_ARTWORK_PATTERNS: RegExp[] = [
    /^cover\.(jpe?g|png|webp)$/i,
    /^folder\.(jpe?g|png|webp)$/i,
    /^front\.(jpe?g|png|webp)$/i,
    /^albumart_\{[^}]+\}_large\.jpe?g$/i,
    /^albumart.*large\.jpe?g$/i,
    /^album\.(jpe?g|png|webp)$/i,
    /^albumartsmall\.jpe?g$/i,
    /^albumart.*\.jpe?g$/i,
];

const IMAGE_FILE = /\.(jpe?g|png|webp)$/i;

/**
 * The cover image among a folder's file names, or null. A folder with a
 * single image and no recognised cover name uses that image.
 */
export function pickFolderArtwork(fileNames: string[]): string | null {
    for (const pattern of FOLDER_ARTWORK_PATTERNS) {
        const match = fileNames.find((name) => pattern.test(name));
        if (match) return match;
    }
    const images = fileNames.filter((name) => IMAGE_FILE.test(name));
    return images.length === 1 ? images[0]! : null;
}

/** The file name at the end of a relative path. */
export function fileNameOf(path: string): string {
    const parts = path.split("/");
    return parts[parts.length - 1] ?? path;
}
