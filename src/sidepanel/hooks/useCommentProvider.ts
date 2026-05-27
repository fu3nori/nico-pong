import { useCallback, useEffect, useRef, useState } from "react";
import {
  MSG_GET_NICOLIVE_CONTEXT,
} from "../../shared/messaging";
import type {
  CommentConnectionStatus,
  NicoliveContext,
  NicoLiveComment,
  NicoPongDebugEvent,
  WebSocketUrlCandidate,
} from "../../shared/types";
import { NicoLiveCommentProvider } from "../services/nicoLiveCommentProvider";

const NICOLIVE_URL_RE = /^https:\/\/live\.nicovideo\.jp\/watch\/lv\d+/;

async function findNicoliveTabId(): Promise<number | null> {
  try {
    const active = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const a = active[0];
    if (a?.id && a.url && NICOLIVE_URL_RE.test(a.url)) return a.id;
  } catch {
    // ignore
  }
  try {
    const all = await chrome.tabs.query({
      url: "https://live.nicovideo.jp/watch/lv*",
    });
    const t = all.find((x) => typeof x.id === "number");
    return t?.id ?? null;
  } catch {
    return null;
  }
}

async function fetchNicoliveContext(): Promise<NicoliveContext> {
  const tabId = await findNicoliveTabId();
  if (tabId === null) {
    return {
      ok: false,
      errorMessage: "ニコ生番組ページのタブが見つかりません。",
    };
  }
  try {
    const res = await chrome.tabs.sendMessage(tabId, {
      type: MSG_GET_NICOLIVE_CONTEXT,
    });
    if (
      res &&
      typeof res === "object" &&
      (res as { type?: string }).type === "NICOLIVE_CONTEXT_RESULT"
    ) {
      return (res as { payload: NicoliveContext }).payload;
    }
    return {
      ok: false,
      errorMessage: "Content Scriptから情報を取得できませんでした。",
    };
  } catch (e) {
    return {
      ok: false,
      errorMessage:
        e instanceof Error
          ? `Content Script通信失敗: ${e.message}`
          : "Content Script通信失敗",
    };
  }
}

type OnComment = (comment: NicoLiveComment) => void;

// デバッグフック側へ introspection / candidates / lifecycle event を流すための
// 任意の sink。useCommentDebug.actions の一部を渡せばよい。
export type CommentProviderDebugSink = {
  recordEmbeddedIntrospection?: (intro: {
    programIdFromUrl?: string;
    embeddedDataFound?: boolean;
    dataPropsFound?: boolean;
    dataPropsParsed?: boolean;
    rootKeys: string[];
    parseError?: string;
  }) => void;
  recordWebSocketCandidates?: (
    candidates: WebSocketUrlCandidate[]
  ) => void;
  setSelectedWebSocketUrl?: (url: string | undefined) => void;
  recordEvent?: (event: NicoPongDebugEvent) => void;
  // stale error 解消用: connect 成功後に古いエラーをクリアする
  clearError?: () => void;
};

export function useCommentProvider(
  onCommentCallback?: OnComment,
  debugSink?: CommentProviderDebugSink
) {
  const [status, setStatus] = useState<CommentConnectionStatus>("disconnected");
  const [error, setError] = useState<string | null>(null);
  const [recvCount, setRecvCount] = useState(0);
  const providerRef = useRef<NicoLiveCommentProvider | null>(null);
  const onCommentRef = useRef<OnComment | undefined>(onCommentCallback);
  const debugRef = useRef<CommentProviderDebugSink | undefined>(debugSink);

  useEffect(() => {
    onCommentRef.current = onCommentCallback;
  }, [onCommentCallback]);
  useEffect(() => {
    debugRef.current = debugSink;
  }, [debugSink]);

  const connect = useCallback(async () => {
    if (providerRef.current) {
      providerRef.current.disconnect();
      providerRef.current = null;
    }
    setError(null);
    setRecvCount(0);
    setStatus("connecting");
    // 再接続開始時に stale error をクリアして誤認を防ぐ
    debugRef.current?.clearError?.();

    const ctx = await fetchNicoliveContext();

    // === デバッグ: 取得失敗でも introspection と candidates は記録する ===
    debugRef.current?.recordEmbeddedIntrospection?.({
      programIdFromUrl: ctx.lvId,
      embeddedDataFound: ctx.embeddedDataFound,
      dataPropsFound: ctx.dataPropsFound,
      dataPropsParsed: ctx.dataPropsParsed,
      rootKeys: ctx.rootKeys ?? [],
      parseError: ctx.dataPropsParseError,
    });
    debugRef.current?.recordWebSocketCandidates?.(
      ctx.webSocketUrlCandidates ?? []
    );

    if (!ctx.ok || !ctx.lvId) {
      setStatus("error");
      const msg =
        ctx.errorMessage ??
        "番組情報を取得できません。番組ページを再読み込みしてください。";
      setError(msg);
      debugRef.current?.recordEvent?.({
        stage: "error",
        ok: false,
        message: msg,
        timestamp: Date.now(),
      });
      return;
    }
    if (!ctx.webSocketUrl) {
      setStatus("error");
      const msg =
        "webSocketUrl が空です。embedded-data の構造を確認してください (デバッグパネル参照)";
      setError(msg);
      debugRef.current?.recordEvent?.({
        stage: "websocket_url",
        ok: false,
        message: `webSocketUrl 取得失敗 (候補${(ctx.webSocketUrlCandidates ?? []).length}件)`,
        timestamp: Date.now(),
      });
      return;
    }

    debugRef.current?.setSelectedWebSocketUrl?.(ctx.webSocketUrl);

    const provider = new NicoLiveCommentProvider({
      onStatusChange: (s, msg) => {
        setStatus(s);
        if (msg) setError(msg);
      },
      onComment: (c) => {
        onCommentRef.current?.(c);
      },
      onError: (msg) => {
        setError(msg);
      },
      onRecvCountChange: (n) => {
        setRecvCount(n);
      },
      onDebug: (ev) => {
        debugRef.current?.recordEvent?.(ev);
      },
    });
    providerRef.current = provider;
    await provider.connect({ webSocketUrl: ctx.webSocketUrl, lvId: ctx.lvId });
  }, []);

  const disconnect = useCallback(() => {
    if (providerRef.current) {
      providerRef.current.disconnect();
      providerRef.current = null;
    }
    setStatus("disconnected");
    setRecvCount(0);
  }, []);

  useEffect(() => {
    return () => {
      providerRef.current?.disconnect();
    };
  }, []);

  return { status, error, recvCount, connect, disconnect };
}
