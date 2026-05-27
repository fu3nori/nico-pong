// マイリストID / 動画ID の抽出ヘルパ。
// nicoVideoId.ts と並ぶ補助モジュール。

export function extractNicoMylistId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // mylist/12345
  const direct = trimmed.match(/^mylist\/(\d+)$/i);
  if (direct) return direct[1];

  // URL: https://www.nicovideo.jp/(user/9999/)?mylist/12345
  const url = trimmed.match(
    /nicovideo\.jp\/(?:user\/\d+\/)?mylist\/(\d+)/i
  );
  if (url) return url[1];

  return null;
}

// 「マイリストとして読み込む」モード時、数字のみ許容
export function extractNicoMylistIdAllowBareNumber(
  input: string
): string | null {
  const direct = extractNicoMylistId(input);
  if (direct) return direct;
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;
  return null;
}
