import { SETTINGS_KEY_NG_RULES } from "../shared/constants";
import {
  EMPTY_NG_RULES,
  type NgRuleSet,
  type NicoPongVideo,
} from "../shared/types";
import { checkRequestUserNg, checkVideoNg } from "../shared/ngMatcher";

function normalizeNgRules(raw: unknown): NgRuleSet {
  if (!raw || typeof raw !== "object") return { ...EMPTY_NG_RULES };
  const r = raw as Partial<NgRuleSet>;
  return {
    videoIds: Array.isArray(r.videoIds) ? r.videoIds.filter(isString) : [],
    ownerIds: Array.isArray(r.ownerIds) ? r.ownerIds.filter(isString) : [],
    userIds: Array.isArray(r.userIds) ? r.userIds.filter(isString) : [],
    titleWords: Array.isArray(r.titleWords)
      ? r.titleWords.filter(isString)
      : [],
    tagWords: Array.isArray(r.tagWords) ? r.tagWords.filter(isString) : [],
    descriptionWords: Array.isArray(r.descriptionWords)
      ? r.descriptionWords.filter(isString)
      : [],
  };
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

export async function getNgRules(): Promise<NgRuleSet> {
  try {
    const res = await chrome.storage.local.get(SETTINGS_KEY_NG_RULES);
    return normalizeNgRules(res[SETTINGS_KEY_NG_RULES]);
  } catch {
    return { ...EMPTY_NG_RULES };
  }
}

export async function setNgRules(rules: NgRuleSet): Promise<void> {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY_NG_RULES]: rules });
  } catch {
    // ignore
  }
}

export async function isNgVideo(
  video: NicoPongVideo
): Promise<{ ng: boolean; reason?: string }> {
  const rules = await getNgRules();
  return checkVideoNg(video, rules);
}

export async function isNgRequestUser(
  userId: string | undefined
): Promise<{ ng: boolean; reason?: string }> {
  const rules = await getNgRules();
  return checkRequestUserNg(userId, rules);
}
