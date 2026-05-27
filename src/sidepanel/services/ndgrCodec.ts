// NDGR ChunkedEntry / ChunkedMessage の protobuf decoder。
//
// 設計:
//   - protobufjs の Reader プリミティブを直接使用し、Type.decode() / codegen を
//     一切呼び出さない。Chrome 拡張 MV3 の strict CSP (unsafe-eval 禁止) に対応するため。
//   - 長さ前置き (varint length-delimited) のストリームバッファから
//     1メッセージずつ取り出して decode する。
//   - バイト不足時は再試行できるよう、消費しなかった末尾バイトを返す。

import protobuf from "protobufjs";

// ===== 公開型 =====

export type DecodedChat = {
  content?: string;      // field 1: コメント本文
  name?: string;         // field 2: 名札 (任意)
  accountStatus?: number; // field 4: 0=STANDARD, 1=PREMIUM
  rawUserId?: string;    // field 5: int64 varint → string
  hashedUserId?: string; // field 6: 匿名コメ用ハッシュID
  no?: number;           // field 8: コメント番号
  // 未知 string field のプレビュー (フィールド番号 → 先頭80文字)
  debugStringFields?: Record<number, string>;
};

export type DecodedOperatorComment = {
  content?: string;
  name?: string;
};

export type DecodedMeta = {
  id?: string;
  atSeconds?: number;
  origin?: string;
};

export type DecodedChunkedMessage = {
  meta?: DecodedMeta;
  chat?: DecodedChat;
  operatorComment?: DecodedOperatorComment;
};

export type DecodedChunkedEntry = {
  backwardUri?: string;
  previousUri?: string;
  segmentUri?: string;
  nextAt?: string;
};

export type DecodeResult<T> = {
  messages: T[];
  consumed: number;
  decodeErrors: number;
  lastDecodeError?: string;
};

// ===== 内部: int64 varint → string (Long / number / string を吸収) =====

function int64Str(r: protobuf.Reader): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v: unknown = (r as any).int64();
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (v && typeof (v as { toNumber?: () => number }).toNumber === "function") {
    return String((v as { toNumber: () => number }).toNumber());
  }
  return "0";
}

// ===== 内部: 各メッセージデコーダ =====

function decodePackedSegmentUri(r: protobuf.Reader, end: number): string | undefined {
  let uri: string | undefined;
  while (r.pos < end) {
    const tag = r.uint32();
    if ((tag >>> 3) === 1 && (tag & 7) === 2) uri = r.string();
    else r.skipType(tag & 7);
  }
  return uri;
}

function decodeMessageSegmentUri(r: protobuf.Reader, end: number): string | undefined {
  let uri: string | undefined;
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 3 && w === 2) uri = r.string();
    else r.skipType(w);
  }
  return uri;
}

function decodeReadyForNextAt(r: protobuf.Reader, end: number): string | undefined {
  let at: string | undefined;
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 1 && w === 0) at = int64Str(r);
    else r.skipType(w);
  }
  return at;
}

function decodeChunkedEntryMsg(r: protobuf.Reader, end: number): DecodedChunkedEntry {
  const result: DecodedChunkedEntry = {};
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (w === 2) {
      const len = r.uint32();
      const msgEnd = r.pos + len;
      if (f === 1) result.backwardUri = decodePackedSegmentUri(r, msgEnd);
      else if (f === 2) result.previousUri = decodePackedSegmentUri(r, msgEnd);
      else if (f === 3) result.segmentUri = decodeMessageSegmentUri(r, msgEnd);
      else if (f === 4) result.nextAt = decodeReadyForNextAt(r, msgEnd);
      r.pos = msgEnd;
    } else {
      r.skipType(w);
    }
  }
  return result;
}

function decodeTimestampSeconds(r: protobuf.Reader, end: number): number | undefined {
  let sec: number | undefined;
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 1 && w === 0) sec = Number(int64Str(r));
    else r.skipType(w);
  }
  return sec;
}

function decodeMeta(r: protobuf.Reader, end: number): DecodedMeta {
  const result: DecodedMeta = {};
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 1 && w === 2) result.id = r.string();
    else if (f === 2 && w === 2) {
      const len = r.uint32();
      const e = r.pos + len;
      result.atSeconds = decodeTimestampSeconds(r, e);
      r.pos = e;
    } else if (f === 3 && w === 2) result.origin = r.string();
    else r.skipType(w);
  }
  return result;
}

function decodeChat(r: protobuf.Reader, end: number): DecodedChat {
  const result: DecodedChat = {};
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 1 && w === 2) result.content = r.string();         // 本文
    else if (f === 2 && w === 2) result.name = r.string();       // 名札
    else if (f === 3 && w === 0) r.int32();                      // vpos: skip
    else if (f === 4 && w === 0) result.accountStatus = r.int32(); // アカウント種別
    else if (f === 5 && w === 0) result.rawUserId = int64Str(r); // rawUserId (int64)
    else if (f === 6 && w === 2) result.hashedUserId = r.string(); // ハッシュID
    else if (f === 7 && w === 2) {                               // modifier: nested message skip
      const len = r.uint32();
      r.pos += len;
    }
    else if (f === 8 && w === 0) result.no = r.int32();          // コメント番号
    else if (w === 2) {
      // 未知 string/bytes フィールド → preview のみ保持
      const v = r.string();
      if (!result.debugStringFields) result.debugStringFields = {};
      result.debugStringFields[f] = v.slice(0, 80);
    } else {
      r.skipType(w);
    }
  }
  return result;
}

function decodeOperatorCommentMsg(r: protobuf.Reader, end: number): DecodedOperatorComment {
  const result: DecodedOperatorComment = {};
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 1 && w === 2) result.content = r.string();
    else if (f === 2 && w === 2) result.name = r.string();
    else r.skipType(w);
  }
  return result;
}

function decodeChunkedMessageMsg(r: protobuf.Reader, end: number): DecodedChunkedMessage {
  const result: DecodedChunkedMessage = {};
  while (r.pos < end) {
    const tag = r.uint32();
    const f = tag >>> 3;
    const w = tag & 7;
    if (f === 1 && w === 2) {
      // Meta
      const len = r.uint32();
      const e = r.pos + len;
      result.meta = decodeMeta(r, e);
      r.pos = e;
    } else if (f === 2 && w === 2) {
      // NicoliveMessage { oneof data { Chat chat = 1; } }
      const len = r.uint32();
      const msgEnd = r.pos + len;
      while (r.pos < msgEnd) {
        const t2 = r.uint32();
        const f2 = t2 >>> 3;
        const w2 = t2 & 7;
        if (f2 === 1 && w2 === 2) {
          const len2 = r.uint32();
          const e2 = r.pos + len2;
          result.chat = decodeChat(r, e2);
          r.pos = e2;
        } else {
          r.skipType(w2);
        }
      }
      r.pos = msgEnd;
    } else if (f === 3 && w === 2) {
      // NicoliveState { Marquee marquee = 2; }
      const len = r.uint32();
      const stateEnd = r.pos + len;
      while (r.pos < stateEnd) {
        const t2 = r.uint32();
        const f2 = t2 >>> 3;
        const w2 = t2 & 7;
        if (f2 === 2 && w2 === 2) {
          // Marquee { MarqueeDisplay display = 1; }
          const len2 = r.uint32();
          const marqueeEnd = r.pos + len2;
          while (r.pos < marqueeEnd) {
            const t3 = r.uint32();
            const f3 = t3 >>> 3;
            const w3 = t3 & 7;
            if (f3 === 1 && w3 === 2) {
              // MarqueeDisplay { OperatorComment operatorComment = 1; }
              const len3 = r.uint32();
              const dispEnd = r.pos + len3;
              while (r.pos < dispEnd) {
                const t4 = r.uint32();
                const f4 = t4 >>> 3;
                const w4 = t4 & 7;
                if (f4 === 1 && w4 === 2) {
                  const len4 = r.uint32();
                  const opEnd = r.pos + len4;
                  const op = decodeOperatorCommentMsg(r, opEnd);
                  r.pos = opEnd;
                  if (op.content || op.name) result.operatorComment = op;
                } else {
                  r.skipType(w4);
                }
              }
              r.pos = dispEnd;
            } else {
              r.skipType(w3);
            }
          }
          r.pos = marqueeEnd;
        } else {
          r.skipType(w2);
        }
      }
      r.pos = stateEnd;
    } else {
      r.skipType(w);
    }
  }
  return result;
}

// ===== 共通: length-delimited ストリームデコーダ =====

function decodeDelimitedStream<T>(
  buffer: Uint8Array,
  decode: (r: protobuf.Reader, end: number) => T
): DecodeResult<T> {
  const messages: T[] = [];
  let consumed = 0;
  let decodeErrors = 0;
  let lastDecodeError: string | undefined;
  const reader = protobuf.Reader.create(buffer);
  while (reader.pos < reader.len) {
    const start = reader.pos;
    try {
      const len = reader.uint32();
      const msgEnd = reader.pos + len;
      if (msgEnd > reader.len) {
        // バイト不足: 先頭に戻して待機
        reader.pos = start;
        break;
      }
      messages.push(decode(reader, msgEnd));
      reader.pos = msgEnd;
      consumed = reader.pos;
    } catch (e) {
      reader.pos = start;
      if (!(e instanceof RangeError)) {
        decodeErrors++;
        lastDecodeError = e instanceof Error ? e.message : String(e);
      }
      break;
    }
  }
  return { messages, consumed, decodeErrors, lastDecodeError };
}

// ===== 公開 API =====

export function decodeChunkedEntries(
  buffer: Uint8Array
): DecodeResult<DecodedChunkedEntry> {
  return decodeDelimitedStream(buffer, decodeChunkedEntryMsg);
}

export function decodeChunkedMessages(
  buffer: Uint8Array
): DecodeResult<DecodedChunkedMessage> {
  return decodeDelimitedStream(buffer, decodeChunkedMessageMsg);
}

export function isProtoReady(): boolean {
  return true;
}
