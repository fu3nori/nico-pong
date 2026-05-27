import type { AuthorNameSource } from "./types";

export type InferAuthorNameParams = {
  ownerName?: string;
  tags?: string[];
  lockedTags?: string[];
  manualAuthorName?: string;
};

export type InferAuthorNameResult = {
  name?: string;
  source: AuthorNameSource;
};

// 「○○P」っぽいが作者名でないことが多いタグの除外リスト。
// 必要に応じて拡張する。
const FALSE_POSITIVE_P_TAGS = new Set<string>([
  "MMD",
  "MAD",
  "HD",
  "3DP",
  "2DP",
  "VOCALOID-PV",
  "VOCALOIDPV",
  "PV",
  "MV",
  "RIP",
  "VIP",
  "TOP",
  "JPOP",
  "JPOP",
  "POP",
  "RAP",
  "EP",
]);

function isFalsePositivePTag(tag: string): boolean {
  const upper = tag.toUpperCase();
  if (FALSE_POSITIVE_P_TAGS.has(upper)) return true;
  // 全部大文字 (略語っぽい) は基本的に P名ではない可能性が高い
  // ただし「DECO*27P」のように混合のものは残す
  return false;
}

// 入力タグ配列を string[] に正規化する (object/null/undefined許容)
export function normalizeTagList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((v) => (typeof v === "string" ? v : ""))
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  if (raw && typeof raw === "object") {
    const all: string[] = [];
    for (const value of Object.values(raw as Record<string, unknown>)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") {
            const trimmed = item.trim();
            if (trimmed) all.push(trimmed);
          }
        }
      }
    }
    return all;
  }
  return [];
}

function findAuthorLikeTag(
  tags: string[],
  kind: "tag_p" | "tag_work" | "tag_person"
): { name: string; source: AuthorNameSource } | null {
  for (const tag of tags) {
    const normalized = tag.trim();
    if (!normalized) continue;
    if (kind === "tag_p" && /^.{1,32}P$/.test(normalized)) {
      if (isFalsePositivePTag(normalized)) continue;
      return { name: normalized, source: "tag_p" };
    }
    if (kind === "tag_work" && /^.{1,32}作品$/.test(normalized)) {
      return { name: normalized, source: "tag_work" };
    }
    if (kind === "tag_person" && /^.{1,32}の人$/.test(normalized)) {
      return { name: normalized, source: "tag_person" };
    }
  }
  return null;
}

export function inferDisplayAuthorName(
  params: InferAuthorNameParams
): InferAuthorNameResult {
  const manual = params.manualAuthorName?.trim();
  if (manual) return { name: manual, source: "manual" };

  const lockedTags = normalizeTagList(params.lockedTags);
  const tags = normalizeTagList(params.tags);

  // ロック済み優先、その後通常タグ。各タグ集合で tag_p → tag_work → tag_person の順。
  const kinds: Array<"tag_p" | "tag_work" | "tag_person"> = [
    "tag_p",
    "tag_work",
    "tag_person",
  ];
  for (const tagList of [lockedTags, tags]) {
    for (const kind of kinds) {
      const hit = findAuthorLikeTag(tagList, kind);
      if (hit) return hit;
    }
  }

  const owner = params.ownerName?.trim();
  if (owner) return { name: owner, source: "owner" };

  return { name: "不明", source: "unknown" };
}
