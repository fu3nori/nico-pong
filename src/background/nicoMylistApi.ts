import type { MylistFetchVideoIdsResult } from "../shared/types";

// マイリストから動画ID一覧を取得する。
// 第一候補: RSS (https://www.nicovideo.jp/mylist/{id}?rss=2.0)
// 第二候補: NVAPI (https://nvapi.nicovideo.jp/v1/users/me/mylists/{id}?pageSize=500)
//
// 公式安定保証はないため、必ずこのファイルにのみ隔離する。

const RSS_ENDPOINT = "https://www.nicovideo.jp/mylist";
const NVAPI_ENDPOINT = "https://nvapi.nicovideo.jp/v1/users/me/mylists";

const VIDEO_ID_PATTERN = /\b((?:sm|nm|so)\d+)\b/i;

function extractIdsFromRssText(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  // <item>...<link>https://www.nicovideo.jp/watch/sm12345</link>...</item> の順序を保つために
  // <item>ブロックを切り出してから link/guid を見る。
  const itemRe = /<item[\s\S]*?<\/item>/g;
  const matches = text.match(itemRe) ?? [];
  for (const item of matches) {
    const linkMatch = item.match(
      /<link>\s*(?:<!\[CDATA\[)?\s*([^<\]]+)\s*(?:\]\]>)?\s*<\/link>/
    );
    const guidMatch = item.match(
      /<guid[^>]*>\s*(?:<!\[CDATA\[)?\s*([^<\]]+)\s*(?:\]\]>)?\s*<\/guid>/
    );
    const candidates = [linkMatch?.[1], guidMatch?.[1]].filter(
      (v): v is string => !!v
    );
    for (const c of candidates) {
      const m = c.match(VIDEO_ID_PATTERN);
      if (m) {
        const id = m[1].toLowerCase();
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
        break;
      }
    }
  }
  // フォールバック: <item>がない/壊れたRSSでも本文全体からIDを拾う
  if (ids.length === 0) {
    const globalRe = /\b((?:sm|nm|so)\d+)\b/gi;
    for (const m of text.matchAll(globalRe)) {
      const id = m[1].toLowerCase();
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  return ids;
}

async function fetchMylistByRss(
  mylistId: string
): Promise<MylistFetchVideoIdsResult> {
  const url = `${RSS_ENDPOINT}/${encodeURIComponent(
    mylistId
  )}?rss=2.0&lang=ja-jp&special_chars_decode=1`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml, */*",
        "X-From-NicoPong-Extension": "1",
      },
    });
  } catch (e) {
    return {
      ok: false,
      mylistId,
      errorMessage:
        e instanceof Error
          ? `マイリストRSS取得失敗(ネットワーク): ${e.message}`
          : "マイリストRSS取得失敗(ネットワーク)",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      mylistId,
      errorMessage: `マイリストRSS取得失敗: HTTP ${res.status}`,
    };
  }
  const text = await res.text();
  const ids = extractIdsFromRssText(text);
  if (ids.length === 0) {
    return {
      ok: false,
      mylistId,
      errorMessage: "マイリストRSSから動画IDを取得できませんでした",
    };
  }
  return { ok: true, mylistId, videoIds: ids };
}

async function fetchMylistByNvapi(
  mylistId: string
): Promise<MylistFetchVideoIdsResult> {
  const url = `${NVAPI_ENDPOINT}/${encodeURIComponent(
    mylistId
  )}?pageSize=500&page=1`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-Frontend-Id": "6",
        "X-Frontend-Version": "0",
        "X-Niconico-Language": "ja-jp",
        "X-From-NicoPong-Extension": "1",
      },
    });
  } catch (e) {
    return {
      ok: false,
      mylistId,
      errorMessage:
        e instanceof Error
          ? `マイリストNVAPI取得失敗(ネットワーク): ${e.message}`
          : "マイリストNVAPI取得失敗(ネットワーク)",
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      mylistId,
      errorMessage: `マイリストNVAPI取得失敗: HTTP ${res.status}`,
    };
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      mylistId,
      errorMessage: "マイリストNVAPIのJSON解釈に失敗しました",
    };
  }
  type NvapiItem = {
    watchId?: string;
    video?: { id?: string; watchId?: string };
  };
  const data = json as {
    data?: { mylist?: { items?: NvapiItem[] } };
  };
  const items = data?.data?.mylist?.items ?? [];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const candidate =
      it.video?.id || it.video?.watchId || it.watchId || "";
    const m = candidate.match(VIDEO_ID_PATTERN);
    if (m) {
      const id = m[1].toLowerCase();
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
  }
  if (ids.length === 0) {
    return {
      ok: false,
      mylistId,
      errorMessage: "マイリストNVAPIから動画IDを取得できませんでした",
    };
  }
  return { ok: true, mylistId, videoIds: ids };
}

export async function fetchMylistVideoIds(
  mylistId: string
): Promise<MylistFetchVideoIdsResult> {
  const rss = await fetchMylistByRss(mylistId);
  if (rss.ok) return rss;
  // RSS失敗時はNVAPIへフォールバック
  const nvapi = await fetchMylistByNvapi(mylistId);
  if (nvapi.ok) return nvapi;
  return {
    ok: false,
    mylistId,
    errorMessage: `${rss.errorMessage} / フォールバック: ${nvapi.errorMessage}`,
  };
}
