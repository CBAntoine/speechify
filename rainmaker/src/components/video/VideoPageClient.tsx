"use client";

import { VideoAdPlayer, type VideoAdPlayerProps } from "./VideoAdPlayer";

// The player on a business's private video page: counts the first play as a
// view (not when you preview it from Rainmaker).

export function VideoPageClient({ token, preview, ...player }: Omit<VideoAdPlayerProps, "onFirstPlay"> & { token: string; preview: boolean }) {
  return (
    <VideoAdPlayer
      {...player}
      onFirstPlay={() => {
        if (!preview) void fetch(`/api/public/video/${token}/view`, { method: "POST" }).catch(() => undefined);
      }}
    />
  );
}
