export function extractNicoVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const direct = trimmed.match(/^(sm|nm|so)\d+$/i);
  if (direct) return direct[0].toLowerCase();

  const fromUrl = trimmed.match(/(?:watch\/|nico\.ms\/)((?:sm|nm|so)\d+)/i);
  if (fromUrl) return fromUrl[1].toLowerCase();

  const anywhere = trimmed.match(/\b((?:sm|nm|so)\d+)\b/i);
  if (anywhere) return anywhere[1].toLowerCase();

  return null;
}

export function buildNicoVideoUrl(videoId: string): string {
  return `https://www.nicovideo.jp/watch/${videoId}`;
}
