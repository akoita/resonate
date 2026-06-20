"use client";

import { useParams } from "next/navigation";
import { PublicPlaylistView } from "../../../components/library/PublicPlaylistView";

export default function PublicPlaylistPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (!id) return null;
  return <PublicPlaylistView playlistId={id} />;
}
