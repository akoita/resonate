import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FileDropZone } from "./FileDropZone";
import { PromptModal } from "./PromptModal";
import { Tabs } from "./Tabs";
import { ToastItem } from "./Toast";

describe("shared UI accessibility contracts", () => {
    it("renders a labelled tablist with selected state, roving tab stops, and panel controls", () => {
        const html = renderToStaticMarkup(
            <Tabs
                ariaLabel="Artist sections"
                activeId="community"
                items={[
                    { id: "discography", label: "Discography", panelId: "discography-panel" },
                    { id: "community", label: "Community", panelId: "community-panel" },
                ]}
            />,
        );

        expect(html).toContain('role="tablist"');
        expect(html).toContain('aria-label="Artist sections"');
        expect(html).toContain('id="discography-tab"');
        expect(html).toContain('aria-controls="discography-panel"');
        expect(html).toContain('aria-selected="false"');
        expect(html).toContain('id="community-tab"');
        expect(html).toContain('aria-selected="true"');
        expect(html).toContain('tabindex="0"');
        expect(html).toContain('tabindex="-1"');
    });

    it("gives prompt dialogs visible-title labelling and a named input", () => {
        const html = renderToStaticMarkup(
            <PromptModal
                isOpen
                title="Rename playlist"
                description="Choose a new name."
                onConfirm={vi.fn()}
                onCancel={vi.fn()}
            />,
        );

        expect(html).toContain('role="dialog"');
        expect(html).toContain('aria-modal="true"');
        expect(html).toMatch(/aria-labelledby="prompt-modal-title-[^"]+"/);
        expect(html).toMatch(/aria-describedby="prompt-modal-description-[^"]+"/);
        expect(html).toContain('aria-label="Rename playlist"');
        expect(html).toContain("Choose a new name.");
    });

    it("keeps the drop target named and removes disabled zones from the tab order", () => {
        const enabled = renderToStaticMarkup(
            <FileDropZone onFileSelect={vi.fn()} ariaLabel="Import audio" />,
        );
        const disabled = renderToStaticMarkup(
            <FileDropZone onFileSelect={vi.fn()} ariaLabel="Import audio" disabled />,
        );

        expect(enabled).toContain('role="button"');
        expect(enabled).toContain('aria-label="Import audio"');
        expect(enabled).toContain('aria-disabled="false"');
        expect(enabled).toContain('tabindex="0"');
        expect(enabled).toContain('type="file"');
        expect(disabled).toContain('aria-disabled="true"');
        expect(disabled).toContain('tabindex="-1"');
        expect(disabled).toContain('disabled=""');
    });

    it("uses polite status announcements and a separate keyboard action for clickable toasts", () => {
        const html = renderToStaticMarkup(
            <ToastItem
                toast={{
                    id: "toast-1",
                    type: "success",
                    title: "Upload complete",
                    message: "Your track is ready.",
                    actionLabel: "Open uploaded track",
                    onClick: vi.fn(),
                }}
                onRemove={vi.fn()}
            />,
        );

        expect(html).toContain('role="status"');
        expect(html).toContain('aria-live="polite"');
        expect(html).toContain('aria-label="Open uploaded track"');
        expect(html).toContain('aria-label="Close Upload complete"');
        expect((html.match(/<button/g) ?? []).length).toBe(2);
        expect(html).not.toContain('role="button"');
    });

    it("uses an assertive alert for error toasts", () => {
        const html = renderToStaticMarkup(
            <ToastItem
                toast={{ id: "toast-2", type: "error", title: "Upload failed" }}
                onRemove={vi.fn()}
            />,
        );

        expect(html).toContain('role="alert"');
        expect(html).toContain('aria-live="assertive"');
    });
});
