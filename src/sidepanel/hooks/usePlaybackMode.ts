import { useCallback, useEffect, useState } from "react";
import type { PlaybackMode } from "../../shared/types";
import {
  getPlaybackMode,
  setPlaybackMode,
} from "../../storage/settingsRepository";

export function usePlaybackMode() {
  const [mode, setModeState] = useState<PlaybackMode>("manual");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getPlaybackMode().then((m) => {
      setModeState(m);
      setReady(true);
    });
  }, []);

  const setMode = useCallback((next: PlaybackMode) => {
    setModeState(next);
    void setPlaybackMode(next);
  }, []);

  return { mode, setMode, ready };
}
