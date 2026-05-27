export function parseNicoLengthToSeconds(
  length: string | undefined
): number | undefined {
  if (!length) return undefined;

  const parts = length.split(":").map((v) => Number(v));
  if (parts.some((v) => Number.isNaN(v))) return undefined;

  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }

  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }

  return undefined;
}

export function textOf(
  root: ParentNode,
  selector: string
): string | undefined {
  const value = root.querySelector(selector)?.textContent?.trim();
  return value && value.length > 0 ? value : undefined;
}

export function intOf(
  root: ParentNode,
  selector: string
): number | undefined {
  const text = textOf(root, selector);
  if (!text) return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function bool01Of(
  root: ParentNode,
  selector: string
): boolean | undefined {
  const text = textOf(root, selector);
  if (text === "1") return true;
  if (text === "0") return false;
  return undefined;
}
