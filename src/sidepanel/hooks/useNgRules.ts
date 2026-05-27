import { useCallback, useEffect, useState } from "react";
import { EMPTY_NG_RULES, type NgRuleSet } from "../../shared/types";
import {
  getNgRules,
  setNgRules as persistNgRules,
} from "../../storage/ngRepository";

export function useNgRules() {
  const [rules, setRules] = useState<NgRuleSet>(EMPTY_NG_RULES);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void getNgRules().then((r) => {
      setRules(r);
      setReady(true);
    });
  }, []);

  const update = useCallback((next: NgRuleSet) => {
    setRules(next);
    void persistNgRules(next);
  }, []);

  return { rules, update, ready };
}
