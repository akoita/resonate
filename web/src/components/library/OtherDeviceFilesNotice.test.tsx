/**
 * Local files across devices: the note that says which of your files are not
 * on this device, where they are, and how to make them play here.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("../../lib/otherDeviceFolders", () => ({ addFolderOnThisDevice: vi.fn(), describeLinkResult: vi.fn() }));
vi.mock("../../lib/librarySettings", () => ({ isFileSystemAccessSupported: () => false }));

import { OtherDeviceFilesNotice } from "./OtherDeviceFilesNotice";

describe("OtherDeviceFilesNotice", () => {
    it("names the folder the hidden files are in and offers to show them", () => {
        const html = renderToStaticMarkup(
            <OtherDeviceFilesNotice folders={[{ name: "Caravelle", count: 18 }]} showing={false} onToggleShowing={() => undefined} />,
        );
        expect(html).toContain("18 of your files are not on this device.");
        expect(html).toContain("“Caravelle”");
        expect(html).toContain("Show them greyed out");
    });

    it("lists several folders with their counts", () => {
        const html = renderToStaticMarkup(
            <OtherDeviceFilesNotice folders={[{ name: "Caravelle", count: 2 }, { name: "Demos", count: 1 }, { name: null, count: 4 }]} showing />,
        );
        expect(html).toContain("7 of your files are not on this device.");
        expect(html).toContain("“Caravelle”</span> (2)");
        expect(html).toContain(" and <span");
    });

    it("renders nothing when every file plays here", () => {
        expect(renderToStaticMarkup(<OtherDeviceFilesNotice folders={[]} showing={false} />)).toBe("");
    });
});
