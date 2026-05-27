// ニコ生コメント受信プロバイダ。
//
// v0.2.1-alpha:
//   - 正式 protobuf decode (NDGR ChunkedEntry / ChunkedMessage) を実装。
//   - 視聴者コメント (message.chat) のみリクエスト対象として emit する。
//   - 運営/生主コメント (state.marquee.display.operatorComment) は emit するが
//     isOperatorComment=true を立てて useCommentToRequest 側でスキップ可能にする。
//   - 正式 decode に失敗したチャンクは「best-effort 正規表現抽出」へフォールバック。
//
// 流れ:
//   1. embedded-data の site.relive.webSocketUrl に WebSocket 接続
//   2. {"type":"startWatching",...} を送信
//   3. 受信した {type:"messageServer"|"room"} のペイロードから viewUri を取得
//   4. viewUri を long-poll しながら ChunkedEntry を decode
//   5. segment URI に並列で接続して ChunkedMessage を decode
//   6. ChunkedMessage の chat / operatorComment を NicoLiveComment に正規化

import { extractVideoIdsFromComment } from "../../shared/commentParsing";
import type {
  CommentConnectionStatus,
  NicoLiveComment,
  NicoPongDebugEvent,
} from "../../shared/types";
import {
  decodeChunkedEntries,
  decodeChunkedMessages,
  isProtoReady,
  type DecodedChunkedMessage,
} from "./ndgrCodec";

export type CommentProviderEvents = {
  onStatusChange?: (status: CommentConnectionStatus, message?: string) => void;
  onComment?: (comment: NicoLiveComment) => void;
  onError?: (errorMessage: string) => void;
  onRecvCountChange?: (count: number) => void;
  // === デバッグ用: 各ライフサイクル段階を時系列イベントとして emit ===
  onDebug?: (event: NicoPongDebugEvent) => void;
};

type StartParams = {
  webSocketUrl: string;
  lvId: string;
};

const KOTEHAN_RE = /[@＠]([^0-9０-９\s@＠][^\s@＠]{0,31})/g;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// バイト列を hex 表示用 ("ab cd 01 ...") に変換。最大 max バイト。
function bytesToHex(bytes: Uint8Array, max: number = 64): string {
  const slice = bytes.subarray(0, Math.min(max, bytes.length));
  const hex = Array.from(slice)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
  return bytes.length > max ? `${hex} ... (+${bytes.length - max}B)` : hex;
}

// fetch URL から ?at= の値を取り出す (デバッグ用)
function extractAtParam(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.searchParams.get("at") ?? undefined;
  } catch {
    return undefined;
  }
}

// messageServer / room の data から viewUri を正規化して返す。
// 既知のパス候補を順番に試し、最初に見つかった値とパス名を返す。
function normalizeMessageServerViewUri(data: unknown): {
  viewUri: string | undefined;
  path: string | undefined;
} {
  if (!data || typeof data !== "object") return { viewUri: undefined, path: undefined };
  const d = data as Record<string, unknown>;
  // 候補パスを優先順に試す
  const tryString = (v: unknown): string | undefined =>
    typeof v === "string" && v.length > 0 ? v : undefined;
  const ms = d.messageServer as Record<string, unknown> | undefined;
  const room = d.room as Record<string, unknown> | undefined;
  const roomMs = room?.messageServer as Record<string, unknown> | undefined;
  const candidates: Array<[string, unknown]> = [
    ["data.viewUri", d.viewUri],
    ["data.messageServer.viewUri", ms?.viewUri],
    ["data.messageServer.uri", ms?.uri],
    ["data.room.viewUri", room?.viewUri],
    ["data.room.messageServer.viewUri", roomMs?.viewUri],
    ["data.room.messageServer.uri", roomMs?.uri],
  ];
  for (const [path, val] of candidates) {
    const uri = tryString(val);
    if (uri) return { viewUri: uri, path };
  }
  return { viewUri: undefined, path: undefined };
}

export class NicoLiveCommentProvider {
  private ws: WebSocket | null = null;
  private keepSeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private status: CommentConnectionStatus = "disconnected";
  private events: CommentProviderEvents;
  private aborts: AbortController[] = [];
  private seenChunkedMessageIds = new Set<string>(); // 重複排除 (meta.id)
  private seenCommentKeys = new Set<string>(); // 重複排除 (no:userId:text)
  private seenSegmentUris = new Set<string>(); // segment URL 重複排除
  private backlogSegmentCount = 0; // 接続後に取得した backward/previous の数
  private static readonly MAX_BACKLOG_SEGMENTS = 3; // backward/previous 最大取得数
  private decoder = new TextDecoder("utf-8", { fatal: false });
  private bestEffortBuffer = "";
  private bestEffortSeenIds = new Map<string, number>();
  // 自動再接続用
  private lastParams: StartParams | null = null;
  private userDisconnected = false;
  // 受信数カウンタ (UI の 受信中 表示用)
  private recvCount = 0;

  constructor(events: CommentProviderEvents = {}) {
    this.events = events;
  }

  getRecvCount(): number {
    return this.recvCount;
  }

  getStatus(): CommentConnectionStatus {
    return this.status;
  }

  async connect(params: StartParams): Promise<void> {
    if (this.status === "connecting" || this.status === "connected") return;
    if (!params.webSocketUrl) {
      this.setStatus("error", "webSocketUrl が空です");
      return;
    }
    // protoが parse できるか軽くチェック (失敗してもbest-effortへ降格して継続)
    if (!isProtoReady()) {
      this.events.onError?.("NDGR proto の初期化に失敗しました (best-effort fallback)");
    }
    this.lastParams = params;
    this.userDisconnected = false;
    this.recvCount = 0;
    this.events.onRecvCountChange?.(0);
    this.seenSegmentUris.clear();
    this.backlogSegmentCount = 0;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus("connecting");
    console.info("[nico-pong] comment watcher connecting", params.lvId);
    try {
      this.ws = new WebSocket(params.webSocketUrl);
    } catch (e) {
      this.setStatus(
        "error",
        e instanceof Error ? `WebSocket生成失敗: ${e.message}` : "WebSocket生成失敗"
      );
      this.scheduleReconnect();
      return;
    }

    this.ws.addEventListener("open", () => {
      this.emitDebug("watch_ws_connect", true, "watch WebSocket open", {
        url: params.webSocketUrl,
      });
      try {
        this.ws?.send(
          JSON.stringify({
            type: "startWatching",
            data: {
              stream: { quality: "abr", protocol: "hls", latency: "low" },
              room: { protocol: "webSocket", commentable: true },
              reconnect: false,
            },
          })
        );
        this.emitDebug("start_watching", true, "startWatching送信");
      } catch (e) {
        this.setStatus(
          "error",
          e instanceof Error
            ? `startWatching送信失敗: ${e.message}`
            : "startWatching送信失敗"
        );
        this.emitDebug(
          "start_watching",
          false,
          e instanceof Error
            ? `startWatching送信失敗: ${e.message}`
            : "startWatching送信失敗"
        );
      }
    });

    this.ws.addEventListener("message", (ev) => {
      const data = typeof ev.data === "string" ? ev.data : "";
      if (!data) return;
      try {
        const msg = JSON.parse(data);
        this.handleWebSocketMessage(msg);
      } catch {
        // 非JSONは無視
      }
    });

    this.ws.addEventListener("error", () => {
      this.setStatus("error", "WebSocketエラー");
      this.emitDebug("watch_ws_error", false, "WebSocket error event");
    });

    this.ws.addEventListener("close", (ev) => {
      this.cancelAllAborts();
      if (this.keepSeatTimer !== null) {
        clearInterval(this.keepSeatTimer);
        this.keepSeatTimer = null;
      }
      console.warn("[nico-pong] watch websocket closed", ev.code, ev.reason);
      this.emitDebug(
        "watch_ws_close",
        false,
        `WebSocket closed code=${ev.code} reason=${ev.reason || "-"}`,
        { code: ev.code, reason: ev.reason, wasClean: ev.wasClean }
      );
      if (this.status !== "error") this.setStatus("disconnected");
      // ユーザー指示でない切断なら自動再接続
      if (!this.userDisconnected) {
        this.scheduleReconnect();
      }
    });
  }

  // 3秒後に最後の params で再接続を試みる。
  // 多重再接続は防止。userDisconnected フラグが立っていれば再接続しない。
  private scheduleReconnect(): void {
    if (this.userDisconnected) return;
    if (!this.lastParams) return;
    if (this.reconnectTimer !== null) return;
    console.warn("[nico-pong] comment watcher reconnect scheduled in 3s");
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.userDisconnected || !this.lastParams) return;
      void this.connect(this.lastParams);
    }, 3000);
  }

  disconnect(): void {
    this.userDisconnected = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cancelAllAborts();
    if (this.keepSeatTimer !== null) {
      clearInterval(this.keepSeatTimer);
      this.keepSeatTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setStatus("disconnected");
    console.info("[nico-pong] comment watcher disconnected by user");
  }

  private cancelAllAborts(): void {
    for (const a of this.aborts) {
      try {
        a.abort();
      } catch {
        // ignore
      }
    }
    this.aborts = [];
  }

  private setStatus(status: CommentConnectionStatus, message?: string): void {
    this.status = status;
    this.events.onStatusChange?.(status, message);
  }

  // === デバッグ用: 段階イベントを emit ===
  private emitDebug(
    stage: NicoPongDebugEvent["stage"],
    ok: boolean,
    message: string,
    detail?: unknown
  ): void {
    this.events.onDebug?.({
      stage,
      ok,
      message,
      detail,
      timestamp: Date.now(),
    });
  }

  private handleWebSocketMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const type = (msg as { type?: string }).type;
    if (type === "ping") {
      this.emitDebug("ping", true, "ping受信");
      try {
        this.ws?.send(JSON.stringify({ type: "pong" }));
        this.emitDebug("pong", true, "pong送信");
        this.ws?.send(JSON.stringify({ type: "keepSeat" }));
        this.emitDebug("keep_seat", true, "keepSeat送信 (ping応答)");
      } catch {
        this.emitDebug("pong", false, "pong/keepSeat送信失敗");
      }
      return;
    }
    if (type === "seat") {
      const data = (msg as { data?: { keepIntervalSec?: number } }).data;
      const intervalSec = data?.keepIntervalSec ?? 30;
      this.emitDebug("seat", true, `seat受信 keepIntervalSec=${intervalSec}`);
      if (this.keepSeatTimer !== null) clearInterval(this.keepSeatTimer);
      this.keepSeatTimer = window.setInterval(() => {
        try {
          this.ws?.send(JSON.stringify({ type: "keepSeat" }));
          this.emitDebug("keep_seat", true, "keepSeat送信 (定期)");
        } catch {
          this.emitDebug("keep_seat", false, "keepSeat定期送信失敗");
        }
      }, intervalSec * 1000);
      return;
    }
    if (type === "messageServer" || type === "room") {
      const data = (msg as { data?: unknown }).data;
      const { viewUri, path } = normalizeMessageServerViewUri(data);
      this.emitDebug(
        "message_server",
        true,
        `${type}受信 viewUri=${viewUri ? "あり" : "なし"} path=${path ?? "none"}`,
        { type, resolvedPath: path, keys: data && typeof data === "object" ? Object.keys(data as object) : [] }
      );
      if (viewUri) {
        this.emitDebug("view_uri", true, `viewUri取得: ${viewUri}`, { uri: viewUri, path });
        this.setStatus("connected");
        void this.startEntryLoop(viewUri);
      } else {
        this.emitDebug(
          "view_uri",
          false,
          `viewUri取得失敗 (${type} の data に viewUri なし) keys=${data && typeof data === "object" ? Object.keys(data as object).join(",") : "?"}`
        );
      }
      return;
    }
    if (type === "error") {
      const data = (msg as { data?: { code?: string; message?: string } })
        .data;
      this.setStatus(
        "error",
        `relive エラー: ${data?.message ?? data?.code ?? "unknown"}`
      );
      return;
    }
  }

  // viewUri に `at` クエリパラメータを付与する。
  // 既に他のクエリが付いている場合は & で結合する。
  // atValue は文字列 ("now" / unix epoch / RFC3339 等のサーバが返した値) を想定。
  private buildEntryUrl(viewUri: string, atValue: string): string {
    const sep = viewUri.includes("?") ? "&" : "?";
    return `${viewUri}${sep}at=${encodeURIComponent(atValue)}`;
  }

  // === NDGR: ChunkedEntry ループ ===
  //
  // 仕様: 現行 NDGR (mpn.live.nicovideo.jp /api/view/v4/) は以下の流れ:
  //   1. 初回は ?at=now で取得 (直近からのストリーム開始)
  //   2. ChunkedEntry を読み、entry.segment.uri があれば並列で pullMessages
  //   3. entry.next.at が返ってきたら、その文字列をそのまま次回の ?at= に渡す
  //   4. next.at が無くストリームが終了した場合は、再度 ?at=now で再接続
  //   5. user による disconnect() まで永続ループ
  private async startEntryLoop(viewUri: string): Promise<void> {
    console.info("[nico-pong] comment watcher connected", viewUri);
    let atValue: string = "now";
    let consecutiveFailures = 0;

    while (this.status !== "disconnected" && this.status !== "error") {
      const ac = new AbortController();
      this.aborts.push(ac);
      try {
        const url = this.buildEntryUrl(viewUri, atValue);
        const nextAt = await this.streamChunkedEntry(url, ac.signal);
        consecutiveFailures = 0;
        if (nextAt !== null && nextAt.length > 0) {
          // サーバから渡された at をそのまま次回に使う (RFC3339/数値文字列のどちらでも)
          atValue = nextAt;
          continue;
        }
        // next.at が無い → "now" で再接続
        await wait(1000);
        atValue = "now";
      } catch (e) {
        if (ac.signal.aborted) return;
        consecutiveFailures += 1;
        this.events.onError?.(
          e instanceof Error
            ? `ChunkedEntry stream失敗: ${e.message}`
            : "ChunkedEntry stream失敗"
        );
        if (consecutiveFailures >= 5) {
          this.setStatus("error", "ChunkedEntry 連続失敗で停止");
          return;
        }
        // 3秒固定で再接続
        await wait(3000);
        atValue = "now";
      }
    }
  }

  // 戻り値: next.at の文字列値 (Ready.next.at)。受信しなければ null。
  // ※ URI ではなく timestamp 値 (string形式) を返す。
  private async streamChunkedEntry(
    uri: string,
    signal: AbortSignal
  ): Promise<string | null> {
    const atParam = extractAtParam(uri);
    const startedAt = Date.now();
    this.emitDebug(
      "message_stream",
      true,
      `ChunkedEntry fetch開始 at=${atParam ?? "-"}`,
      { url: uri, atParam, label: "entry" }
    );
    const res = await fetch(uri, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/x-protobuf, application/protobuf, */*" },
      signal,
    });
    const contentType = res.headers.get("content-type") ?? "(none)";
    this.emitDebug(
      "stream_response_meta",
      res.ok,
      `entry HTTP ${res.status} content-type=${contentType}`,
      {
        label: "entry",
        url: uri,
        atParam,
        status: res.status,
        contentType,
      }
    );
    if (!res.ok || !res.body) {
      this.emitDebug(
        "message_stream",
        false,
        `ChunkedEntry fetch失敗: HTTP ${res.status}`
      );
      throw new Error(`HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    let buffer = new Uint8Array(0);
    let nextAtValue: string | null = null;
    let totalBytes = 0;
    let firstChunkDumped = false;

    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      totalBytes += value.length;
      if (!firstChunkDumped) {
        firstChunkDumped = true;
        this.emitDebug(
          "stream_hexdump",
          true,
          `entry first bytes (${value.length}B): ${bytesToHex(value)}`,
          { label: "entry", bytes: value.length }
        );
      }

      // バッファ拡張
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;

      // ChunkedEntry を可能な限りデコード
      let decoded;
      try {
        decoded = decodeChunkedEntries(buffer);
      } catch (e) {
        // proto がロードできない等。best-effort へ
        this.consumeBestEffort(buffer);
        buffer = new Uint8Array(0);
        this.emitDebug(
          "decode_fail",
          false,
          e instanceof Error
            ? `ChunkedEntry decode失敗: ${e.message}`
            : "ChunkedEntry decode失敗"
        );
        this.events.onError?.(
          e instanceof Error
            ? `NDGR entry decode 失敗: ${e.message}`
            : "NDGR entry decode 失敗"
        );
        continue;
      }
      if (decoded.messages.length > 0) {
        this.emitDebug(
          "decode_ok",
          true,
          `ChunkedEntry decode ${decoded.messages.length}件`
        );
      }
      if (decoded.decodeErrors > 0) {
        this.emitDebug(
          "decode_fail",
          false,
          `ChunkedEntry decode失敗 ${decoded.decodeErrors}件: ${decoded.lastDecodeError ?? "?"}`
        );
      }

      if (decoded.consumed > 0) {
        buffer = buffer.slice(decoded.consumed);
      }

      for (const entry of decoded.messages) {
        if (entry.segmentUri) {
          this.pullSegmentOnce(entry.segmentUri, "live");
        }
        if (entry.backwardUri && this.backlogSegmentCount < NicoLiveCommentProvider.MAX_BACKLOG_SEGMENTS) {
          this.backlogSegmentCount++;
          this.pullSegmentOnce(entry.backwardUri, "backward");
        }
        if (entry.previousUri && this.backlogSegmentCount < NicoLiveCommentProvider.MAX_BACKLOG_SEGMENTS) {
          this.backlogSegmentCount++;
          this.pullSegmentOnce(entry.previousUri, "previous");
        }
        if (entry.nextAt) {
          nextAtValue = entry.nextAt;
        }
      }
    }

    const durationMs = Date.now() - startedAt;
    this.emitDebug(
      "stream_response_end",
      true,
      `entry 受信完了 ${totalBytes}B / ${durationMs}ms nextAt=${nextAtValue ?? "(なし)"}`,
      {
        label: "entry",
        totalBytes,
        durationMs,
        nextAt: nextAtValue,
      }
    );

    return nextAtValue;
  }

  // segment URI を一度だけ取得する。重複URIはスキップ。
  // reason: "live" | "backward" | "previous" (デバッグ表示用)
  private pullSegmentOnce(uri: string, reason: "live" | "backward" | "previous"): void {
    if (this.seenSegmentUris.has(uri)) return;
    this.seenSegmentUris.add(uri);
    const ac = new AbortController();
    this.aborts.push(ac);
    void this.streamChunkedMessages(uri, ac.signal, reason).catch((err) => {
      if (ac.signal.aborted) return;
      this.events.onError?.(
        err instanceof Error
          ? `segment(${reason}) ${uri} 取得失敗: ${err.message}`
          : `segment(${reason}) 取得失敗`
      );
    });
  }

  // === NDGR: ChunkedMessage (segment) ループ ===
  private async streamChunkedMessages(
    uri: string,
    signal: AbortSignal,
    reason: "live" | "backward" | "previous" = "live"
  ): Promise<void> {
    const startedAt = Date.now();
    this.emitDebug("message_stream", true, `segment(${reason}) fetch開始`, {
      label: "segment",
      reason,
      url: uri,
    });
    const res = await fetch(uri, {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/x-protobuf, application/protobuf, */*" },
      signal,
    });
    const contentType = res.headers.get("content-type") ?? "(none)";
    this.emitDebug(
      "stream_response_meta",
      res.ok,
      `segment HTTP ${res.status} content-type=${contentType}`,
      {
        label: "segment",
        url: uri,
        status: res.status,
        contentType,
      }
    );
    if (!res.ok || !res.body) {
      this.emitDebug(
        "message_stream",
        false,
        `segment fetch失敗: HTTP ${res.status}`
      );
      throw new Error(`HTTP ${res.status}`);
    }
    const reader = res.body.getReader();
    let buffer = new Uint8Array(0);
    let totalBytes = 0;
    let firstChunkDumped = false;
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.length === 0) continue;

      totalBytes += value.length;
      if (!firstChunkDumped) {
        firstChunkDumped = true;
        this.emitDebug(
          "stream_hexdump",
          true,
          `segment first bytes (${value.length}B): ${bytesToHex(value)}`,
          { label: "segment", bytes: value.length }
        );
      }

      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;

      let decoded;
      try {
        decoded = decodeChunkedMessages(buffer);
      } catch (e) {
        this.consumeBestEffort(buffer);
        buffer = new Uint8Array(0);
        this.emitDebug(
          "decode_fail",
          false,
          e instanceof Error
            ? `ChunkedMessage decode失敗: ${e.message}`
            : "ChunkedMessage decode失敗"
        );
        this.events.onError?.(
          e instanceof Error
            ? `NDGR message decode 失敗: ${e.message}`
            : "NDGR message decode 失敗"
        );
        continue;
      }
      if (decoded.messages.length > 0) {
        this.emitDebug(
          "decode_ok",
          true,
          `ChunkedMessage decode ${decoded.messages.length}件`
        );
      }
      if (decoded.decodeErrors > 0) {
        this.emitDebug(
          "decode_fail",
          false,
          `ChunkedMessage decode失敗 ${decoded.decodeErrors}件`
        );
      }

      if (decoded.consumed > 0) {
        buffer = buffer.slice(decoded.consumed);
      }

      for (const msg of decoded.messages) {
        this.handleDecodedMessage(msg);
      }
    }

    const durationMs = Date.now() - startedAt;
    this.emitDebug(
      "stream_response_end",
      true,
      `segment 受信完了 ${totalBytes}B / ${durationMs}ms`,
      { label: "segment", totalBytes, durationMs }
    );
  }

  private handleDecodedMessage(msg: DecodedChunkedMessage): void {
    // 重複排除 (meta.id でユニーク化)
    const id = msg.meta?.id;
    if (id) {
      if (this.seenChunkedMessageIds.has(id)) return;
      this.seenChunkedMessageIds.add(id);
      // 過大化抑制
      if (this.seenChunkedMessageIds.size > 5000) {
        // ざっくり古い順に消す (Set順序保証あり)
        const arr = [...this.seenChunkedMessageIds];
        for (const old of arr.slice(0, 2500)) {
          this.seenChunkedMessageIds.delete(old);
        }
      }
    }

    const dateSec = msg.meta?.atSeconds ?? nowSec();

    if (msg.chat) {
      const userId =
        msg.chat.hashedUserId ||
        msg.chat.rawUserId ||
        msg.meta?.id ||
        "";
      const content = msg.chat.content ?? "";
      // (no:userId:text) ベースの重複排除 (spec §12)
      const commentKey = `${msg.chat.no ?? 0}:${userId}:${content}`;
      if (this.seenCommentKeys.has(commentKey)) return;
      this.seenCommentKeys.add(commentKey);
      if (this.seenCommentKeys.size > 1000) {
        const first = this.seenCommentKeys.values().next().value;
        if (first !== undefined) this.seenCommentKeys.delete(first);
      }

      this.recvCount += 1;
      this.events.onRecvCountChange?.(this.recvCount);
      console.info(
        "[nico-pong] comment received",
        `no=${msg.chat.no ?? 0}`,
        `user=${userId}`,
        `text=${content}`
      );
      // Chat フィールドデバッグ: 動画IDを含まない場合、未知フィールド構造を debug event に出す
      if (!extractVideoIdsFromComment(content).length && msg.chat.debugStringFields) {
        this.emitDebug("comment", true, `chat field info no=${msg.chat.no ?? 0}`, {
          contentPreview: content.slice(0, 40),
          debugStringFields: msg.chat.debugStringFields,
        });
      }

      const comment: NicoLiveComment = {
        id: id ?? `${userId}-${msg.chat.no ?? 0}`,
        no: msg.chat.no ?? 0,
        userId,
        name: msg.chat.name && msg.chat.name.length > 0 ? msg.chat.name : undefined,
        text: content,
        textNotag: content,
        premium: msg.chat.accountStatus,
        date: dateSec,
        isOperatorComment: false,
      };
      this.events.onComment?.(comment);
      return;
    }

    if (msg.operatorComment) {
      const content = msg.operatorComment.content ?? "";
      const comment: NicoLiveComment = {
        id: id ?? `op-${dateSec}`,
        no: 0,
        userId: "",
        name: msg.operatorComment.name,
        text: content,
        textNotag: content,
        premium: 2,
        date: dateSec,
        isOperatorComment: true,
        isOwnPost: true,
      };
      this.events.onComment?.(comment);
      return;
    }
  }

  // === best-effort フォールバック ===
  // 正式 decode が壊れた/失敗した場合に限り、UTF-8 best-effort 抽出を行う。
  // 視聴者か運営かを区別できないので isOperatorComment=false で emit するが、
  // userId 不明のため useCommentToRequest 側の重複/上限制御で漏れ受けが起こり得る。
  private consumeBestEffort(bytes: Uint8Array): void {
    const text = this.decoder.decode(bytes, { stream: true });
    this.bestEffortBuffer += text;
    if (this.bestEffortBuffer.length > 20000) {
      this.bestEffortBuffer = this.bestEffortBuffer.slice(-10000);
    }
    const ids = extractVideoIdsFromComment(this.bestEffortBuffer);
    if (ids.length === 0) return;
    const now = Date.now();
    for (const id of ids) {
      const last = this.bestEffortSeenIds.get(id) ?? 0;
      if (now - last < 30_000) continue;
      const idx = this.bestEffortBuffer.toLowerCase().indexOf(id);
      if (idx < 0) continue;
      this.bestEffortSeenIds.set(id, now);
      const start = Math.max(0, idx - 80);
      const end = Math.min(this.bestEffortBuffer.length, idx + 80);
      const windowText = this.bestEffortBuffer.slice(start, end);
      KOTEHAN_RE.lastIndex = 0;
      let kotehan: string | undefined;
      let km: RegExpExecArray | null;
      while ((km = KOTEHAN_RE.exec(windowText)) !== null) {
        const name = km[1].trim();
        if (name) {
          kotehan = name;
          break;
        }
      }
      const comment: NicoLiveComment = {
        id: `besteffort-${id}-${now}`,
        no: 0,
        userId: "",
        name: kotehan,
        text: windowText.includes(id) ? windowText : `${windowText} ${id}`,
        textNotag: windowText,
        date: Math.floor(now / 1000),
        isOperatorComment: false,
      };
      this.events.onComment?.(comment);
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
