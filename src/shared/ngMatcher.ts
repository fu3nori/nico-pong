import type { NgRuleSet, NicoPongVideo } from "./types";

export type NgCheckResult = { ng: boolean; reason?: string };

function matchAny(value: string | undefined, words: string[]): string | null {
  if (!value || words.length === 0) return null;
  const lower = value.toLowerCase();
  for (const w of words) {
    if (!w) continue;
    if (lower.includes(w.toLowerCase())) return w;
  }
  return null;
}

function matchAnyInArray(values: string[], words: string[]): string | null {
  if (words.length === 0) return null;
  for (const v of values) {
    const hit = matchAny(v, words);
    if (hit) return hit;
  }
  return null;
}

export function checkVideoNg(
  video: NicoPongVideo,
  rules: NgRuleSet
): NgCheckResult {
  if (rules.videoIds.includes(video.videoId)) {
    return { ng: true, reason: "NG動画IDに一致" };
  }
  if (video.ownerId && rules.ownerIds.includes(video.ownerId)) {
    return { ng: true, reason: "NG投稿者IDに一致" };
  }
  const titleHit = matchAny(video.title, rules.titleWords);
  if (titleHit) return { ng: true, reason: `NGタイトル語に一致: ${titleHit}` };
  const tagHit = matchAnyInArray(video.tags ?? [], rules.tagWords);
  if (tagHit) return { ng: true, reason: `NGタグに一致: ${tagHit}` };
  return { ng: false };
}

export function checkRequestUserNg(
  userId: string | undefined,
  rules: NgRuleSet
): NgCheckResult {
  if (!userId) return { ng: false };
  if (rules.userIds.includes(userId)) {
    return { ng: true, reason: "NGリク主IDに一致" };
  }
  return { ng: false };
}
