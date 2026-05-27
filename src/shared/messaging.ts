import type {
  CheckQuoteAvailabilityResult,
  ImportTarget,
  MylistFetchVideoIdsResult,
  NicoliveContext,
  PlaybackState,
  PlayVideoRequest,
  PlayVideoResult,
  PostBroadcasterCommentRequest,
  PostBroadcasterCommentResult,
  ProgramInfo,
  StopVideoRequest,
  StopVideoResult,
  VideoFetchResult,
} from "./types";

export type NicoPongMessage =
  | { type: "GET_PROGRAM_INFO" }
  | { type: "PROGRAM_INFO_RESULT"; payload: ProgramInfo }
  | { type: "GET_NICOLIVE_CONTEXT" }
  | { type: "NICOLIVE_CONTEXT_RESULT"; payload: NicoliveContext }
  | { type: "FETCH_VIDEO_INFO"; payload: { videoId: string } }
  | { type: "FETCH_VIDEO_INFO_RESULT"; payload: VideoFetchResult }
  | { type: "PLAY_VIDEO"; payload: PlayVideoRequest }
  | { type: "PLAY_VIDEO_RESULT"; payload: PlayVideoResult }
  | { type: "STOP_VIDEO"; payload: StopVideoRequest }
  | { type: "STOP_VIDEO_RESULT"; payload: StopVideoResult }
  | { type: "PLAYBACK_STATE_CHANGED"; payload: PlaybackState }
  | { type: "GET_PLAYBACK_STATE" }
  // v0.2 追加
  | {
      type: "FETCH_MYLIST_VIDEO_IDS";
      payload: { mylistId: string; target: ImportTarget };
    }
  | {
      type: "FETCH_MYLIST_VIDEO_IDS_RESULT";
      payload: MylistFetchVideoIdsResult;
    }
  | { type: "POST_BROADCASTER_COMMENT"; payload: PostBroadcasterCommentRequest }
  | {
      type: "POST_BROADCASTER_COMMENT_RESULT";
      payload: PostBroadcasterCommentResult;
    }
  | { type: "CHECK_QUOTE_AVAILABILITY"; payload: { videoId: string } }
  | {
      type: "CHECK_QUOTE_AVAILABILITY_RESULT";
      payload: CheckQuoteAvailabilityResult;
    };

export const MSG_GET_PROGRAM_INFO = "GET_PROGRAM_INFO" as const;
export const MSG_PROGRAM_INFO_RESULT = "PROGRAM_INFO_RESULT" as const;
export const MSG_GET_NICOLIVE_CONTEXT = "GET_NICOLIVE_CONTEXT" as const;
export const MSG_NICOLIVE_CONTEXT_RESULT = "NICOLIVE_CONTEXT_RESULT" as const;
export const MSG_FETCH_VIDEO_INFO = "FETCH_VIDEO_INFO" as const;
export const MSG_FETCH_VIDEO_INFO_RESULT = "FETCH_VIDEO_INFO_RESULT" as const;
export const MSG_PLAY_VIDEO = "PLAY_VIDEO" as const;
export const MSG_PLAY_VIDEO_RESULT = "PLAY_VIDEO_RESULT" as const;
export const MSG_STOP_VIDEO = "STOP_VIDEO" as const;
export const MSG_STOP_VIDEO_RESULT = "STOP_VIDEO_RESULT" as const;
export const MSG_PLAYBACK_STATE_CHANGED = "PLAYBACK_STATE_CHANGED" as const;
export const MSG_GET_PLAYBACK_STATE = "GET_PLAYBACK_STATE" as const;

// v0.2
export const MSG_FETCH_MYLIST_VIDEO_IDS = "FETCH_MYLIST_VIDEO_IDS" as const;
export const MSG_FETCH_MYLIST_VIDEO_IDS_RESULT =
  "FETCH_MYLIST_VIDEO_IDS_RESULT" as const;
export const MSG_POST_BROADCASTER_COMMENT = "POST_BROADCASTER_COMMENT" as const;
export const MSG_POST_BROADCASTER_COMMENT_RESULT =
  "POST_BROADCASTER_COMMENT_RESULT" as const;
export const MSG_CHECK_QUOTE_AVAILABILITY = "CHECK_QUOTE_AVAILABILITY" as const;
export const MSG_CHECK_QUOTE_AVAILABILITY_RESULT =
  "CHECK_QUOTE_AVAILABILITY_RESULT" as const;
