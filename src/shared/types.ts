export type NicoPongTab = "request" | "stock";

export type ProgramConnectionStatus =
  | "not_nicolive_page"
  | "detected"
  | "unknown"
  | "error";

export type ProgramInfo = {
  status: ProgramConnectionStatus;
  lvId?: string;
  title?: string;
  url?: string;
  detectedAt: string;
  errorMessage?: string;
};

export type AuthorNameSource =
  | "owner"
  | "tag_p"
  | "tag_work"
  | "tag_person"
  | "manual"
  | "unknown";

export type VideoItemStatus =
  | "queued"
  | "checking"
  | "ready"
  | "playing"
  | "played"
  | "interrupted"
  | "skipped"
  | "ng"
  | "no_live_play"
  | "error";

export type VideoFetchSource =
  | "getthumbinfo"
  | "watch_page"
  | "watch_v3"
  | "mock";

export type VideoSourceType =
  | "manual"
  | "comment"
  | "mylist"
  | "stock_move"
  | "stock_copy";

export type NicoPongVideo = {
  id: string;
  videoId: string;
  url: string;

  title: string;
  thumbnailUrl?: string;

  ownerName?: string;
  ownerId?: string;

  displayAuthorName?: string;
  authorNameSource: AuthorNameSource;

  viewCount?: number;
  commentCount?: number;
  mylistCount?: number;
  likeCount?: number;
  durationSec?: number;

  tags: string[];
  lockedTags?: string[];

  memo?: string;

  addedTo: NicoPongTab;
  order: number;

  addedAt: string;
  updatedAt: string;
  lastFetchedAt?: string;

  status?: VideoItemStatus;

  // getthumbinfo の no_live_play 相当。1 の場合、生放送プレイヤーで再生不可の可能性あり。
  noLivePlay?: boolean;

  // embeddable が false の場合、外部/埋め込み再生不可の可能性あり。
  embeddable?: boolean;

  // 引用可否API result
  quotable?: boolean;

  // NG/再生不可の理由(UI表示用)
  ngReason?: string;

  fetchSource?: VideoFetchSource;

  // リク主情報 (コメントリクエストの場合)
  requestUserId?: string;
  requestUserName?: string;
  requestCommentNo?: number;

  sourceType?: VideoSourceType;
  sourceMylistId?: string;

  lastPlayedAt?: string;
  playCount?: number;
};

export type NicoPongVideoDraft = Omit<
  NicoPongVideo,
  "id" | "addedTo" | "order" | "addedAt" | "updatedAt"
>;

export type VideoFetchResult =
  | {
      ok: true;
      video: NicoPongVideoDraft;
    }
  | {
      ok: false;
      videoId?: string;
      errorMessage: string;
    };

export type PlaybackMode = "manual" | "auto";

export type PlaybackStatus =
  | "idle"
  | "loading"
  | "playing"
  | "ended"
  | "interrupted"
  | "error";

export type PlaybackSource = "request" | "stock" | "manual_input";

export type PlaybackState = {
  status: PlaybackStatus;
  currentVideoInternalId?: string;
  currentVideoId?: string;
  currentTitle?: string;
  currentThumbnailUrl?: string;
  source?: PlaybackSource;
  startedAt?: string;
  endedAt?: string;
  errorMessage?: string;
};

export type PlayVideoRequest = {
  video: NicoPongVideo;
  source: PlaybackSource;
  force: boolean;
  lvId: string;
};

export type StopVideoRequest = {
  lvId: string;
};

export type WebSocketUrlCandidate = {
  path: string; // 例: "site.relive.webSocketUrl"
  value: string;
};

export type NicoliveContext = {
  ok: boolean;
  lvId?: string;
  isBroadcaster?: boolean;
  programTitle?: string;
  csrfToken?: string;
  webSocketUrl?: string;
  errorMessage?: string;

  // === デバッグ用 introspection (docs/nico-pong_nicolive_comment_debug_plan.md) ===
  // Content Script が #embedded-data の状態を逐次レポートする。
  // パスが見つからない場合でも初期データの構造が分かるようにする。
  embeddedDataFound?: boolean;
  dataPropsFound?: boolean;
  dataPropsParsed?: boolean;
  rootKeys?: string[]; // パースに成功した時の最上位キー一覧
  dataPropsParseError?: string;
  webSocketUrlCandidates?: WebSocketUrlCandidate[]; // ws://wss:// で始まる値の再帰探索結果
};

export type QuotationApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

export type QuotationPlaybackMethod =
  | "quotation_api_post"
  | "quotation_api_patch"
  | "quotation_api_delete";

export type QuotationStatusResult =
  | {
      ok: true;
      exists: true;
      currentContentId?: string;
      raw?: unknown;
    }
  | {
      ok: true;
      exists: false;
      status: 404;
      rawText?: string;
    }
  | {
      ok: false;
      status?: number;
      errorMessage: string;
      rawText?: string;
    };

export type StopVideoResult =
  | {
      ok: true;
      stoppedAt: string;
      method: "quotation_api_delete";
    }
  | {
      ok: false;
      errorMessage: string;
      status?: number;
      rawText?: string;
    };

export type PlayVideoResult =
  | {
      ok: true;
      videoId: string;
      startedAt: string;
      method: "quotation_api_post" | "quotation_api_patch";
      responseStatus: number;
      rawText?: string;
    }
  | {
      ok: false;
      videoId: string;
      errorMessage: string;
      responseStatus?: number;
      errorCode?: string;
      rawText?: string;
    };

// === v0.2 追加型 ===

export type ImportTarget = "request" | "stock";

export type RequestAcceptMode = "accept" | "stop";

export type MylistImportResult = {
  ok: boolean;
  mylistId: string;
  total: number;
  imported: number;
  duplicated: number;
  failed: number;
  videoIds: string[];
  errorMessage?: string;
};

export type MylistFetchVideoIdsResult =
  | { ok: true; mylistId: string; videoIds: string[] }
  | { ok: false; mylistId: string; errorMessage: string };

export type BroadcasterCommentTemplate = {
  id: string;
  name: string;
  text: string;
  command: string;
  isPermanent: boolean;
  autoPostOnPlay: boolean;
};

export type PostBroadcasterCommentRequest = {
  lvId: string;
  csrfToken: string;
  text: string;
  command?: string;
  name?: string;
  isPermanent?: boolean;
};

export type PostBroadcasterCommentResult = {
  ok: boolean;
  errorMessage?: string;
  status?: number;
};

export type CheckQuoteAvailabilityResult = {
  ok: boolean;
  quotable?: boolean;
  errorMessage?: string;
};

export type CommentSettings = {
  autoPostVideoInfoOnPlay: boolean;
  postDelayMs: number;
  defaultCommand: string;
  defaultName: string;
  defaultIsPermanent: boolean;
  template: string;
};

export type RequestAcceptanceSettings = {
  requestAcceptMode: RequestAcceptMode;
  autoAcceptCommentRequests: boolean;
  preventDuplicateInRequest: boolean;
  maxRequestsPerUser: number;
};

// 現行 (v0.2.2) デフォルトテンプレ。
// 仕様: docs/nico-pong_now-playing-template-update.md
// {displayAuthorName} は authorName.ts の優先順位 (manual → tag_p → tag_work → tag_person → owner → "不明") で解決。
// {ownerName} は投稿者アカウント名/チャンネル名のみ。
export const DEFAULT_BROADCASTER_COMMENT_TEMPLATE =
  "♪ 再生中: {title} / 作者: {displayAuthorName} ：{ownerName} / URL ： {url}";

// 過去のデフォルト値一覧。これらが保存されていた場合のみ自動で新デフォルトに移行する。
// 手動編集された値は破壊しない。
export const PRIOR_BROADCASTER_COMMENT_TEMPLATES: readonly string[] = [
  // v0.2.0 初期
  "♪ 再生中: {title} / {displayAuthorName} / 再生:{viewCount} コメ:{commentCount} マイリス:{mylistCount} {url}",
  // v0.2.1 (作者表示問題があったため移行対象)
  "♪ 再生中: {title} / 作者: {author} / {url}",
  // v0.2.1.x (ホットフィックス中継)
  "♪ 再生中: {title} / 作者: {displayAuthorName} ： {ownerName}",
  "♪ 再生中: {title} / 作者: {displayAuthorName} ： {ownerName} / URL： {url}",
];

export const DEFAULT_COMMENT_SETTINGS: CommentSettings = {
  autoPostVideoInfoOnPlay: true,
  postDelayMs: 500,
  defaultCommand: "",
  defaultName: "",
  defaultIsPermanent: false,
  template: DEFAULT_BROADCASTER_COMMENT_TEMPLATE,
};

export const DEFAULT_REQUEST_ACCEPTANCE_SETTINGS: RequestAcceptanceSettings = {
  requestAcceptMode: "accept",
  autoAcceptCommentRequests: true,
  preventDuplicateInRequest: true,
  maxRequestsPerUser: 3,
};

export type NicoLiveComment = {
  id: string;
  no: number;
  userId: string;
  name?: string;
  text: string;
  textNotag: string;
  premium?: number;
  date: number;
  isOperatorComment: boolean;
  isOwnPost?: boolean;
};

export type CommentNameSource =
  | "nametag"
  | "at_comment"
  | "manual"
  | "user_id";

export type CommentUserProfile = {
  userId: string;
  displayName?: string;
  nameSource: CommentNameSource;
  firstSeenAt: string;
  lastSeenAt: string;
  requestCount: number;
  playedRequestCount: number;
  ng: boolean;
  memo?: string;
};

export type NgRuleSet = {
  videoIds: string[];
  ownerIds: string[];
  userIds: string[];
  titleWords: string[];
  tagWords: string[];
  descriptionWords: string[];
};

export const EMPTY_NG_RULES: NgRuleSet = {
  videoIds: [],
  ownerIds: [],
  userIds: [],
  titleWords: [],
  tagWords: [],
  descriptionWords: [],
};

export type CommentConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

// === コメント受信デバッグ用 (docs/nico-pong_comment_debug_instruction.md) ===
// コメント取得 → 動画ID抽出 → 動画情報取得 → リクエスト登録 の各段で
// どこまで進んだかを可視化するための状態オブジェクト。
// 障害切り分け用途。本番UI上にも表示する。
export type CommentDebugWatcherStatus = "idle" | "watching" | "error";
export type CommentDebugParseStatus = "not_checked" | "success" | "failed";
export type CommentDebugFetchStatus =
  | "not_started"
  | "fetching"
  | "success"
  | "failed";
export type CommentDebugRequestStatus = "not_started" | "success" | "failed";

// === 取得フローの各段階 (時系列イベント) ===
export type CommentDebugStage =
  | "embedded_data"
  | "websocket_url"
  | "watch_ws_connect"
  | "watch_ws_close"
  | "watch_ws_error"
  | "start_watching"
  | "seat"
  | "keep_seat"
  | "ping"
  | "pong"
  | "message_server"
  | "view_uri"
  | "message_stream"
  | "stream_response_meta" // HTTP status + Content-Type
  | "stream_hexdump" // 先頭バイトの hex ダンプ
  | "stream_response_end" // 受信完了時のサマリ (バイト数, 経過時間)
  | "decode_ok"
  | "decode_fail"
  | "comment"
  | "video_id_extract"
  | "video_info"
  | "request_add"
  | "error";

export type NicoPongDebugEvent = {
  stage: CommentDebugStage;
  ok: boolean;
  message: string;
  detail?: unknown;
  timestamp: number;
};

export type WatchWsState =
  | "not_tried"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type CommentDebugState = {
  // === 既存 (pipeline 可視化) ===
  watcherStatus: CommentDebugWatcherStatus;
  receivedCount: number;
  parsedVideoIdCount: number;
  requestAddedCount: number;
  lastReceivedAt?: string;
  lastCommentText?: string;
  lastUserId?: string;
  lastUserName?: string;
  lastParseStatus: CommentDebugParseStatus;
  lastVideoId?: string;
  lastVideoInfoStatus: CommentDebugFetchStatus;
  lastRequestStatus: CommentDebugRequestStatus;
  lastError?: string;

  // === 新: embedded-data introspection ===
  programIdFromUrl?: string;
  embeddedDataFound?: boolean;
  dataPropsFound?: boolean;
  dataPropsParsed?: boolean;
  rootKeys: string[];
  dataPropsParseError?: string;
  webSocketUrlCandidates: WebSocketUrlCandidate[];
  selectedWebSocketUrl?: string;

  // === 新: WS ライフサイクル ===
  watchWsState: WatchWsState;
  startWatchingSentCount: number;
  seatReceivedCount: number;
  keepSeatSentCount: number;
  pingReceivedCount: number;
  pongSentCount: number;

  // === 新: messageServer / viewUri ===
  messageServerReceivedCount: number;
  lastViewUri?: string;

  // === 新: stream / decode ===
  messageStreamOpenCount: number;
  decodeOkCount: number;
  decodeFailCount: number;

  // === 新 (v0.3.5): 直近の NDGR HTTP fetch 詳細 ===
  lastStreamLabel?: string; // 識別用 (entry / segment)
  lastStreamUrl?: string;
  lastStreamAtParam?: string; // ?at= に渡した値
  lastStreamHttpStatus?: number;
  lastStreamContentType?: string;
  lastStreamTotalBytes?: number;
  lastStreamDurationMs?: number;
  lastStreamHexDump?: string;

  // === 新: 時系列イベントログ (最新N件をbounded保持) ===
  events: NicoPongDebugEvent[];
};

export const COMMENT_DEBUG_EVENT_LOG_LIMIT = 60;

export const INITIAL_COMMENT_DEBUG_STATE: CommentDebugState = {
  watcherStatus: "idle",
  receivedCount: 0,
  parsedVideoIdCount: 0,
  requestAddedCount: 0,
  lastParseStatus: "not_checked",
  lastVideoInfoStatus: "not_started",
  lastRequestStatus: "not_started",
  rootKeys: [],
  webSocketUrlCandidates: [],
  watchWsState: "not_tried",
  startWatchingSentCount: 0,
  seatReceivedCount: 0,
  keepSeatSentCount: 0,
  pingReceivedCount: 0,
  pongSentCount: 0,
  messageServerReceivedCount: 0,
  messageStreamOpenCount: 0,
  decodeOkCount: 0,
  decodeFailCount: 0,
  events: [],
};
