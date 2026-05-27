import type { NicoPongTab } from "../../shared/types";

type Props = {
  active: NicoPongTab;
  onChange: (tab: NicoPongTab) => void;
  counts: { request: number; stock: number };
};

export default function Tabs({ active, onChange, counts }: Props) {
  return (
    <nav className="tabs" role="tablist">
      <button
        type="button"
        role="tab"
        className={active === "request" ? "active" : ""}
        aria-selected={active === "request"}
        onClick={() => onChange("request")}
      >
        リクエスト ({counts.request})
      </button>
      <button
        type="button"
        role="tab"
        className={active === "stock" ? "active" : ""}
        aria-selected={active === "stock"}
        onClick={() => onChange("stock")}
      >
        ストック ({counts.stock})
      </button>
    </nav>
  );
}
