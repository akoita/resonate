import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TrackDescriptor, TrackDescriptorVocabulary } from "../../lib/api";
import {
  addSubGenre,
  descriptorDraftChanged,
  draftFromDescriptor,
  MAX_DESCRIPTOR_SUB_GENRES,
  removeSubGenre,
  toggleFamily,
  TrackDescriptorEditForm,
  TrackDescriptorEditor,
} from "./TrackDescriptorEditor";

const vocabulary: TrackDescriptorVocabulary = {
  families: [
    { id: "african", label: "African" },
    { id: "jazz", label: "Jazz" },
    { id: "world", label: "World" },
  ],
  subGenres: ["afrobeats", "bossa nova", "kora", "senegal"],
};

const descriptor: TrackDescriptor = {
  families: ["african", "world"],
  familyLabels: ["African", "World"],
  subGenres: ["senegal"],
  tempoBand: "mid",
  energyBand: "low",
  vocal: null,
  source: "deterministic",
};

const save = async () => undefined;

describe("descriptor draft helpers", () => {
  it("toggles families on and off, sorted", () => {
    expect(toggleFamily(["world"], "african")).toEqual(["african", "world"]);
    expect(toggleFamily(["african", "world"], "african")).toEqual(["world"]);
  });

  it("adds only vocabulary styles, once, up to the limit", () => {
    expect(addSubGenre(["senegal"], "  Kora ", vocabulary.subGenres)).toEqual({ subGenres: ["kora", "senegal"], error: null });
    expect(addSubGenre(["kora"], "kora", vocabulary.subGenres).error).toMatch(/already/);
    expect(addSubGenre([], "my own invented style", vocabulary.subGenres)).toMatchObject({ subGenres: [], error: expect.stringMatching(/suggestions/) });
    expect(addSubGenre([], "   ", vocabulary.subGenres).error).not.toBeNull();
    const full = Array.from({ length: MAX_DESCRIPTOR_SUB_GENRES }, (_, i) => `s${i}`);
    expect(addSubGenre(full, "kora", vocabulary.subGenres).error).toMatch(/at most 8/);
  });

  it("removes a style and detects whether the draft changed", () => {
    expect(removeSubGenre(["kora", "senegal"], "kora")).toEqual(["senegal"]);
    const initial = draftFromDescriptor(descriptor);
    expect(descriptorDraftChanged(initial, { families: ["world", "african"], subGenres: ["senegal"] })).toBe(false);
    expect(descriptorDraftChanged(initial, { families: ["african"], subGenres: ["senegal"] })).toBe(true);
    expect(descriptorDraftChanged(initial, { families: initial.families, subGenres: [] })).toBe(true);
  });
});

describe("TrackDescriptorEditor", () => {
  it("is read-only for people who cannot edit: tags only, no control", () => {
    const html = renderToStaticMarkup(
      <TrackDescriptorEditor trackTitle="Song" descriptor={descriptor} canEdit={false} vocabulary={vocabulary} onSave={save} />,
    );
    expect(html).toContain(">African</li>");
    expect(html).not.toMatch(/<(button|input|select|textarea)[\s>]/);
  });

  it("shows no edit control until the vocabulary is loaded (no dead button)", () => {
    const html = renderToStaticMarkup(
      <TrackDescriptorEditor trackTitle="Song" descriptor={descriptor} canEdit vocabulary={null} onSave={save} />,
    );
    expect(html).not.toMatch(/<button/);
  });

  it("shows the tags and an Edit tags button to an editor", () => {
    const html = renderToStaticMarkup(
      <TrackDescriptorEditor trackTitle="Song" descriptor={descriptor} canEdit vocabulary={vocabulary} onSave={save} />,
    );
    expect(html).toContain(">African</li>");
    expect(html).toContain('aria-label="Edit tags for Song"');
    expect(html).toContain(">Edit tags</button>");
  });

  it("offers to add tags to a track without any", () => {
    const html = renderToStaticMarkup(
      <TrackDescriptorEditor trackTitle="Song" descriptor={null} canEdit vocabulary={vocabulary} onSave={save} />,
    );
    expect(html).toContain('aria-label="Add tags for Song"');
  });

  it("says when the tags were corrected by the release team", () => {
    const html = renderToStaticMarkup(
      <TrackDescriptorEditor trackTitle="Song" descriptor={{ ...descriptor, source: "artist" }} canEdit={false} vocabulary={null} onSave={save} />,
    );
    expect(html).toContain("Corrected by your release team");
    expect(html).not.toContain("Suggested by Resonate");
  });
});

describe("TrackDescriptorEditForm", () => {
  const render = (props: Partial<Parameters<typeof TrackDescriptorEditForm>[0]> = {}) =>
    renderToStaticMarkup(
      <TrackDescriptorEditForm
        trackTitle="Song"
        descriptor={descriptor}
        vocabulary={vocabulary}
        onSave={() => undefined}
        onCancel={() => undefined}
        {...props}
      />,
    );

  it("offers every family as a checkbox, checked for the current ones", () => {
    const html = render();
    expect(html).toMatch(/<input type="checkbox" checked=""[^>]*\/>African/);
    expect(html).toMatch(/<input type="checkbox"[^>]*\/>Jazz/);
    expect(html).not.toMatch(/<input type="checkbox" checked=""[^>]*\/>Jazz/);
  });

  it("lists the current styles with a remove control and suggests vocabulary styles only", () => {
    const html = render();
    expect(html).toContain('aria-label="Remove style senegal"');
    expect(html).toContain('<option value="kora"></option>');
    expect(html).not.toContain('<option value="senegal"></option>'); // already selected
  });

  it("shows the measured bands as plain text, never as a control", () => {
    const html = render();
    expect(html).toContain(">Medium tempo</li>");
    expect(html).toContain(">Low energy</li>");
    expect(html).toContain("measured from the audio and cannot be edited");
    expect(html).not.toMatch(/<input[^>]*aria-label="[^"]*(tempo|energy|vocal)/i);
  });

  it("keeps Save disabled while nothing changed, and Add style disabled while nothing is typed", () => {
    const html = render();
    expect(html).toMatch(/<button type="button" disabled="">Save tags<\/button>/);
    expect(html).toMatch(/<button type="button" disabled="">Add style<\/button>/);
    expect(html).toMatch(/<button type="button">Cancel<\/button>/);
  });

  it("disables everything while saving and shows a save failure", () => {
    const html = render({ saving: true, error: "Could not save" });
    expect(html).toContain("Saving...");
    expect(html).toContain('role="alert"');
    expect(html).toContain("Could not save");
    expect(html).toMatch(/<button type="button" disabled="">Cancel<\/button>/);
    expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  });

  it("disables adding styles at the limit", () => {
    const html = render({
      descriptor: { ...descriptor, subGenres: Array.from({ length: MAX_DESCRIPTOR_SUB_GENRES }, (_, i) => `s${i}`) },
    });
    expect(html).toContain("Up to 8 styles");
  });
});
