"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  followArtist,
  getArtistFollowStatus,
  unfollowArtist,
  type ArtistFollowContext,
} from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../ui/Button";

export type FollowButtonState = "signed_out" | "loading" | "ready";

/** Label shown on the button for a state; the follow state wins once it is known. */
export function followButtonLabel(state: FollowButtonState, following: boolean, pending = false): string {
  if (state === "signed_out") return "Follow";
  if (state === "loading") return "Follow";
  if (pending) return following ? "Following…" : "Updating…";
  return following ? "Following" : "Follow";
}

export function FollowArtistButtonView({
  state,
  following,
  pending = false,
  error,
  onClick,
}: {
  state: FollowButtonState;
  following: boolean;
  pending?: boolean;
  error?: string | null;
  onClick?: () => void;
}) {
  const label = followButtonLabel(state, following, pending);
  return (
    <span className="follow-artist">
      <Button
        variant={following && state === "ready" ? "ghost" : "primary"}
        className="follow-artist__button"
        aria-pressed={state === "ready" ? following : undefined}
        disabled={state === "loading" || pending}
        title={
          state === "signed_out"
            ? "Connect to follow this artist"
            : following
              ? "Stop following this artist"
              : "Follow this artist"
        }
        onClick={onClick}
      >
        {label}
      </Button>
      {error ? (
        <span className="follow-artist__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/**
 * Follow / Following toggle for an artist (#1968). Follows are private: there
 * is no follower count or feed, and the artist only ever sees consent-governed
 * aggregates. Optimistic, with rollback when the request fails. Signed-out
 * listeners get a connect action instead. Pass `hidden` on the artist's own
 * profile, where following is not allowed.
 */
export function FollowArtistButton({
  artistId,
  releaseId,
  trackId,
  source,
  hidden = false,
}: {
  artistId: string | null | undefined;
  releaseId?: string;
  trackId?: string;
  source: string;
  hidden?: boolean;
}) {
  const { token, connect } = useAuth();
  const [following, setFollowing] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current += 1;
    const current = requestId.current;
    setError(null);
    if (!artistId || !token || hidden) {
      setFollowing(null);
      return;
    }
    getArtistFollowStatus(artistId, token)
      .then((status) => {
        if (requestId.current === current) setFollowing(status.following);
      })
      .catch(() => {
        if (requestId.current === current) setFollowing(false);
      });
  }, [artistId, token, hidden]);

  const toggle = useCallback(async () => {
    if (!artistId) return;
    if (!token) {
      await connect();
      return;
    }
    const previous = following === true;
    setError(null);
    setFollowing(!previous);
    setPending(true);
    try {
      const context: ArtistFollowContext = { source, ...(releaseId ? { releaseId } : {}), ...(trackId ? { trackId } : {}) };
      const status = previous
        ? await unfollowArtist(artistId, token)
        : await followArtist(artistId, token, context);
      setFollowing(status.following);
    } catch {
      setFollowing(previous);
      setError(previous ? "Could not unfollow. Try again." : "Could not follow. Try again.");
    } finally {
      setPending(false);
    }
  }, [artistId, connect, following, releaseId, source, token, trackId]);

  if (!artistId || hidden) return null;
  const state: FollowButtonState = !token ? "signed_out" : following === null ? "loading" : "ready";
  return (
    <FollowArtistButtonView
      state={state}
      following={following === true}
      pending={pending}
      error={error}
      onClick={() => void toggle()}
    />
  );
}
