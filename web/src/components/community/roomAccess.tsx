"use client";

/**
 * Shared access vocabulary for every community room (listener cohorts, artist
 * public/holder rooms, campaign supporter/city rooms).
 *
 * Before this, each surface invented its own gating words — "Community matching
 * is off", "Holder access required", "Support required". They map onto the same
 * four access models, so this is the single source of truth for the badge and
 * the calm, privacy-forward locked reason shown to a viewer who cannot yet join.
 */

export type RoomAccessModel = "open" | "consent" | "holder" | "support";

const MODEL_LABEL: Record<RoomAccessModel, string> = {
  open: "Open",
  consent: "Consent",
  holder: "Holder",
  support: "Support",
};

const LOCKED_REASON: Record<RoomAccessModel, string> = {
  open: "Open to everyone — jump in.",
  consent: "Turn on community matching in Settings to receive and join these rooms.",
  holder: "Reserved for eligible holders. Your holdings stay private.",
  support: "Confirm a campaign pledge to unlock. Your pledge and wallet stay private.",
};

export function roomAccessModelLabel(model: RoomAccessModel) {
  return MODEL_LABEL[model];
}

export function roomAccessLockedReason(model: RoomAccessModel) {
  return LOCKED_REASON[model];
}

/** Classify an artist room (`artist_public` | `artist_holder`) into an access model. */
export function artistRoomAccessModel(roomType: string): RoomAccessModel {
  return roomType === "artist_holder" ? "holder" : "open";
}

/** Classify a campaign room (`show_campaign_supporter` | `show_city_demand`) into an access model. */
export function campaignRoomAccessModel(roomType: string): RoomAccessModel {
  return roomType === "show_campaign_supporter" ? "support" : "open";
}

export function RoomAccessBadge({ model, locked = false }: { model: RoomAccessModel; locked?: boolean }) {
  return (
    <span
      className={`room-access-badge room-access-badge--${model}${locked ? " is-locked" : ""}`}
      title={roomAccessLockedReason(model)}
    >
      {roomAccessModelLabel(model)}
    </span>
  );
}
