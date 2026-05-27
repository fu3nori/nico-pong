import { useCallback } from "react";
import type { CommentNameSource } from "../../shared/types";
import {
  getUserProfile,
  incrementRequestCount,
  setDisplayName,
} from "../../storage/kotehanRepository";

export function useKotehan() {
  const resolveName = useCallback(
    async (
      userId: string | undefined,
      candidates: { nametag?: string; atName?: string }
    ): Promise<{ name?: string; source: CommentNameSource }> => {
      // 優先順位: 手動設定 > nametag > @ > userId
      if (userId) {
        const existing = await getUserProfile(userId);
        if (existing?.nameSource === "manual" && existing.displayName) {
          return { name: existing.displayName, source: "manual" };
        }
      }
      if (candidates.nametag && candidates.nametag.length > 0) {
        if (userId) {
          await setDisplayName(userId, candidates.nametag, "nametag");
        }
        return { name: candidates.nametag, source: "nametag" };
      }
      if (candidates.atName && candidates.atName.length > 0) {
        if (userId) {
          await setDisplayName(userId, candidates.atName, "at_comment");
        }
        return { name: candidates.atName, source: "at_comment" };
      }
      if (userId) {
        const existing = await getUserProfile(userId);
        if (existing?.displayName) {
          return {
            name: existing.displayName,
            source: existing.nameSource ?? "user_id",
          };
        }
      }
      return { name: userId, source: "user_id" };
    },
    []
  );

  const noteRequest = useCallback(
    async (userId: string | undefined, played = false) => {
      if (!userId) return;
      await incrementRequestCount(userId, played);
    },
    []
  );

  return { resolveName, noteRequest };
}
