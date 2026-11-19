import { CATEGORIES, CONFIDENCE } from "@/lib/data";
import type { CategoryId, Confidence } from "@/lib/types";
import { Icon } from "./icons";

export function ConfidenceBadge({ value, withHelp = false }: { value: Confidence; withHelp?: boolean }) {
  const meta = CONFIDENCE[value];
  return (
    <span className={`badge badge--${value}`} style={{ "--bc": meta.color } as React.CSSProperties} title={meta.help}>
      {value === "confirmed" && <Icon name="check" size={12} strokeWidth={2.4} />}
      {meta.short}
      {withHelp && <span className="sr-only">: {meta.help}</span>}
    </span>
  );
}

export function CategoryBadge({ value }: { value: CategoryId }) {
  const meta = CATEGORIES[value];
  return (
    <span className="badge badge--category" style={{ "--bc": meta.color } as React.CSSProperties}>
      <Icon name={value} size={13} strokeWidth={2} />
      {meta.label}
    </span>
  );
}
