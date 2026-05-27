import {
  SETTINGS_KEY_ACTIVE_TAB,
  SETTINGS_KEY_COMMENT_SETTINGS,
  SETTINGS_KEY_PLAYBACK_MODE,
  SETTINGS_KEY_REQUEST_ACCEPTANCE,
} from "../shared/constants";
import {
  DEFAULT_BROADCASTER_COMMENT_TEMPLATE,
  DEFAULT_COMMENT_SETTINGS,
  DEFAULT_REQUEST_ACCEPTANCE_SETTINGS,
  PRIOR_BROADCASTER_COMMENT_TEMPLATES,
  type CommentSettings,
  type NicoPongTab,
  type PlaybackMode,
  type RequestAcceptanceSettings,
} from "../shared/types";

export async function getActiveTab(): Promise<NicoPongTab> {
  try {
    const res = await chrome.storage.local.get(SETTINGS_KEY_ACTIVE_TAB);
    const v = res[SETTINGS_KEY_ACTIVE_TAB];
    return v === "stock" ? "stock" : "request";
  } catch {
    return "request";
  }
}

export async function setActiveTab(tab: NicoPongTab): Promise<void> {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY_ACTIVE_TAB]: tab });
  } catch {
    // ignore
  }
}

export async function getPlaybackMode(): Promise<PlaybackMode> {
  try {
    const res = await chrome.storage.local.get(SETTINGS_KEY_PLAYBACK_MODE);
    const v = res[SETTINGS_KEY_PLAYBACK_MODE];
    return v === "auto" ? "auto" : "manual";
  } catch {
    return "manual";
  }
}

export async function setPlaybackMode(mode: PlaybackMode): Promise<void> {
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY_PLAYBACK_MODE]: mode });
  } catch {
    // ignore
  }
}

// 保存テンプレが過去デフォルトと完全一致する場合は、新デフォルトへ自動移行する。
// ユーザーが手動編集した値は破壊しない。
function migrateBroadcasterCommentTemplate(template: unknown): string {
  if (typeof template !== "string") return DEFAULT_BROADCASTER_COMMENT_TEMPLATE;
  if (template === DEFAULT_BROADCASTER_COMMENT_TEMPLATE) return template;
  if (PRIOR_BROADCASTER_COMMENT_TEMPLATES.includes(template)) {
    return DEFAULT_BROADCASTER_COMMENT_TEMPLATE;
  }
  return template;
}

export async function getCommentSettings(): Promise<CommentSettings> {
  try {
    const res = await chrome.storage.local.get(SETTINGS_KEY_COMMENT_SETTINGS);
    const raw = res[SETTINGS_KEY_COMMENT_SETTINGS];
    if (raw && typeof raw === "object") {
      const merged: CommentSettings = {
        ...DEFAULT_COMMENT_SETTINGS,
        ...(raw as Partial<CommentSettings>),
      };
      const migrated = migrateBroadcasterCommentTemplate(merged.template);
      if (migrated !== merged.template) {
        merged.template = migrated;
        // 移行後を保存して以後の読み込みコストを抑える
        try {
          await chrome.storage.local.set({
            [SETTINGS_KEY_COMMENT_SETTINGS]: merged,
          });
        } catch {
          // ignore
        }
      }
      return merged;
    }
    return { ...DEFAULT_COMMENT_SETTINGS };
  } catch {
    return { ...DEFAULT_COMMENT_SETTINGS };
  }
}

export async function setCommentSettings(
  settings: CommentSettings
): Promise<void> {
  try {
    await chrome.storage.local.set({
      [SETTINGS_KEY_COMMENT_SETTINGS]: settings,
    });
  } catch {
    // ignore
  }
}

export async function getRequestAcceptanceSettings(): Promise<RequestAcceptanceSettings> {
  try {
    const res = await chrome.storage.local.get(SETTINGS_KEY_REQUEST_ACCEPTANCE);
    const raw = res[SETTINGS_KEY_REQUEST_ACCEPTANCE];
    if (raw && typeof raw === "object") {
      return {
        ...DEFAULT_REQUEST_ACCEPTANCE_SETTINGS,
        ...(raw as Partial<RequestAcceptanceSettings>),
      };
    }
    return { ...DEFAULT_REQUEST_ACCEPTANCE_SETTINGS };
  } catch {
    return { ...DEFAULT_REQUEST_ACCEPTANCE_SETTINGS };
  }
}

export async function setRequestAcceptanceSettings(
  settings: RequestAcceptanceSettings
): Promise<void> {
  try {
    await chrome.storage.local.set({
      [SETTINGS_KEY_REQUEST_ACCEPTANCE]: settings,
    });
  } catch {
    // ignore
  }
}
