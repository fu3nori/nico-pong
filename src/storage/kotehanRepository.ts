import { SETTINGS_KEY_KOTEHAN_MAP } from "../shared/constants";
import type { CommentUserProfile } from "../shared/types";

type Map = Record<string, CommentUserProfile>;

async function readAll(): Promise<Map> {
  try {
    const res = await chrome.storage.local.get(SETTINGS_KEY_KOTEHAN_MAP);
    const raw = res[SETTINGS_KEY_KOTEHAN_MAP];
    if (raw && typeof raw === "object") return raw as Map;
    return {};
  } catch {
    return {};
  }
}

async function writeAll(map: Map): Promise<void> {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY_KOTEHAN_MAP]: map });
  } catch {
    // ignore
  }
}

export async function getUserProfile(
  userId: string
): Promise<CommentUserProfile | null> {
  if (!userId) return null;
  const all = await readAll();
  return all[userId] ?? null;
}

export async function upsertUserProfile(
  profile: CommentUserProfile
): Promise<void> {
  if (!profile.userId) return;
  const all = await readAll();
  const existing = all[profile.userId];
  all[profile.userId] = {
    ...existing,
    ...profile,
    firstSeenAt: existing?.firstSeenAt ?? profile.firstSeenAt,
    lastSeenAt: profile.lastSeenAt,
  };
  await writeAll(all);
}

export async function incrementRequestCount(
  userId: string,
  played: boolean = false
): Promise<void> {
  if (!userId) return;
  const all = await readAll();
  const existing = all[userId];
  const now = new Date().toISOString();
  all[userId] = {
    userId,
    displayName: existing?.displayName,
    nameSource: existing?.nameSource ?? "user_id",
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    requestCount: (existing?.requestCount ?? 0) + 1,
    playedRequestCount:
      (existing?.playedRequestCount ?? 0) + (played ? 1 : 0),
    ng: existing?.ng ?? false,
    memo: existing?.memo,
  };
  await writeAll(all);
}

export async function setDisplayName(
  userId: string,
  name: string | undefined,
  source: CommentUserProfile["nameSource"]
): Promise<void> {
  if (!userId) return;
  const all = await readAll();
  const existing = all[userId];
  const now = new Date().toISOString();
  all[userId] = {
    userId,
    displayName: name,
    nameSource: source,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    requestCount: existing?.requestCount ?? 0,
    playedRequestCount: existing?.playedRequestCount ?? 0,
    ng: existing?.ng ?? false,
    memo: existing?.memo,
  };
  await writeAll(all);
}
