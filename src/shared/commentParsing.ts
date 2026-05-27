// コメントから動画ID / @コテハン を抽出するヘルパ。
//
// 設計 (v0.3.2 で 10桁ベタ数字対応を撤回):
//   - ニコニコ動画IDは必ず `sm` / `nm` / `so` プレフィックス + 数字の連続。
//     数字の桁数は不定 (sm9 から sm99999999+ まで)。決め打ち禁止。
//   - 10桁数字ID パターン (`\d{10}`) は電話番号・タイムスタンプ等の
//     false positive を量産するため対象外とする。
//     ニコ動の動画 watch ID は実運用上ほぼすべて sm/nm/so プレフィックス付き。
//   - 同一videoIdはURL/ベタ表記/ニコ短縮URLのいずれであっても 1件に正規化する。
//   - 例 (すべて拾える):
//       sm9
//       sm12345678
//       nm12345
//       so12345
//       https://www.nicovideo.jp/watch/sm12345678
//       http://www.nicovideo.jp/watch/sm12345678
//       https://nico.ms/sm12345678
//       「sm9」「（sm9）」「リク sm9」「(sm9)」などの括弧/前後語にも追従
//   - 例 (拾わない):
//       8888888888  (拍手スパム / 元から対象外)
//       1234567890  (任意の10桁数字 / 元から対象外)
//       asm9bk      (前後が単語境界違反)

const VIDEO_ID_PATTERNS: RegExp[] = [
  // ベタ書きの sm/nm/so + 数字 (1桁以上)。境界は \b で十分。
  /\b((?:sm|nm|so)\d+)\b/gi,
  // ニコ動 watch URL
  /(?:https?:\/\/)?(?:www\.)?nicovideo\.jp\/watch\/((?:sm|nm|so)\d+)/gi,
  // ニコ短縮 nico.ms
  /(?:https?:\/\/)?nico\.ms\/((?:sm|nm|so)\d+)/gi,
];

export function extractVideoIdsFromComment(text: string): string[] {
  if (!text) return [];
  const ids = new Set<string>();
  for (const pattern of VIDEO_ID_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const id = match[1]?.toLowerCase();
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

const KOTEHAN_BLOCK_WORDS = new Set([
  "初見",
  "確認",
  "アンケート",
  "削除",
  "代理",
  "○",
  "×",
  "△",
  "□",
  "◎",
  "/",
  "//",
]);

export function extractKotehan(text: string): string | null {
  if (!text) return null;
  // 末尾の @名前 / ＠名前 を抽出。数字始まりや空白を含むものは弾く。
  const match = text.match(/[@＠]([^0-9０-９\s@＠][^\s@＠]{0,31})\s*$/);
  if (!match) return null;
  const name = match[1].trim();
  if (!name) return null;
  if (KOTEHAN_BLOCK_WORDS.has(name)) return null;
  return name;
}
