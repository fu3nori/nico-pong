import type { NicoPongVideo } from "./types";

export function findNextPlayableRequest(
  videos: NicoPongVideo[],
  options: { allowNoLivePlay?: boolean } = {}
): NicoPongVideo | null {
  const allowNoLivePlay = options.allowNoLivePlay ?? false;
  return (
    [...videos]
      .filter((v) => v.addedTo === "request")
      .sort((a, b) => a.order - b.order)
      .find((video) => {
        if (video.status === "played") return false;
        if (video.status === "skipped") return false;
        if (video.status === "error") return false;
        if (video.status === "ng") return false;
        if (video.status === "no_live_play") return false;
        if (video.status === "interrupted") return false;
        if (video.status === "playing") return false;
        if (!allowNoLivePlay && video.noLivePlay) return false;
        if (video.quotable === false) return false;
        return true;
      }) ?? null
  );
}
