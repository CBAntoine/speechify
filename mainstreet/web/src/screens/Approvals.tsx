import { BadgeCheck, Check, X } from "lucide-react";
import type { Approval } from "../api";
import { run } from "../commands";
import { ago, APPROVAL_LABEL, dateTime, money } from "../format";
import { href } from "../router";
import { formDialog, useApi } from "../store";
import { Button, Card, Chip, cx, Empty, ErrorNote, Loading, PageHeader, useBusy } from "../ui";

const KIND_TONE: Record<Approval["kind"], string> = { deal: "money", pitch: "blue", reply: "green", spend: "amber", strategy: "violet" };

export function ApprovalRow({ approval: a, compact }: { approval: Approval; compact?: boolean }) {
  const [busy, act] = useBusy();
  const pending = a.status === "pending";

  const approve = () => act(() => run("decide_approval", { approval_id: a.id, decision: "approve", confirmed: true }));
  const reject = () =>
    act(async () => {
      const v = await formDialog({
        title: `Reject: ${a.title}`,
        confirmLabel: "Reject",
        tone: "danger",
        fields: [{ name: "note", label: "Why? (optional — the crew learns from it)", type: "textarea", placeholder: "e.g. Too small to bother, or the price is wrong" }],
      });
      if (!v) return;
      await run("decide_approval", { approval_id: a.id, decision: "reject", note: v.note, confirmed: true });
    });

  return (
    <article className={cx("approval", `kind-${a.kind}`, !pending && "is-decided")}>
      <div className="approval-meta">
        <Chip tone={KIND_TONE[a.kind]}>{APPROVAL_LABEL[a.kind]}</Chip>
        {a.amountCents ? <b className="num approval-amount">{money(a.amountCents)}</b> : null}
        <span className="muted small">{pending ? ago(a.createdAt) : `${a.status === "approved" ? "Approved" : a.status === "rejected" ? "Rejected" : "Expired"} ${ago(a.decidedAt ?? a.createdAt)}${a.decidedBy ? ` · ${a.decidedBy}` : ""}`}</span>
      </div>
      <h3 className="approval-title">{a.title}</h3>
      {a.leadId ? (
        <a className="approval-lead" href={href("lead", a.leadId)}>
          {a.leadName ?? "Open the lead"}
        </a>
      ) : null}
      <p className={cx("approval-detail", compact && "clamp-3")}>{a.detail}</p>
      {pending ? (
        <div className="approval-actions">
          <Button tone={a.kind === "deal" ? "money" : "primary"} icon={Check} busy={busy} onClick={approve}>
            Approve
          </Button>
          <Button tone="ghost" icon={X} disabled={busy} onClick={reject}>
            Reject
          </Button>
        </div>
      ) : null}
    </article>
  );
}

/** Where a decision was made, for the audit trail. */
const DECIDED_BY: Record<string, string> = { dashboard: "in the app", voice: "by voice", phone: "by phone", mcp: "over MCP" };

export function Approvals() {
  const pending = useApi<{ approvals: Approval[] }>("/api/approvals?status=pending");
  const all = useApi<{ approvals: Approval[] }>("/api/approvals");
  const decided = (all.data?.approvals ?? [])
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? b.createdAt).localeCompare(a.decidedAt ?? a.createdAt))
    .slice(0, 25);
  const list = pending.data?.approvals ?? [];

  return (
    <div className="page">
      <PageHeader title="Approvals" sub="Only the decisions that are yours: big deals, first emails in review mode, unusual spend and strategy changes." />
      {pending.error ? <ErrorNote message={pending.error} onRetry={pending.reload} /> : null}
      {!pending.data && pending.loading ? <Loading /> : null}
      {pending.data ? (
        list.length ? (
          <div className="approval-grid">
            {list.map((a) => (
              <ApprovalRow key={a.id} approval={a} />
            ))}
          </div>
        ) : (
          <Card>
            <Empty icon={BadgeCheck} title="You're all caught up" body="When a deal is over your limit or a pitch needs your yes, it lands here and Atlas tells you." />
          </Card>
        )
      ) : null}

      {decided.length ? (
        <Card title="Recent decisions" className="mt">
          <div className="list">
            {decided.map((a) => (
              <div key={a.id} className="decided-row">
                <Chip tone={a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "grey"}>{a.status === "approved" ? "Approved" : a.status === "rejected" ? "Rejected" : "Expired"}</Chip>
                <span className="decided-title">
                  {a.title}
                  {a.leadId ? (
                    <>
                      {" · "}
                      <a href={href("lead", a.leadId)}>{a.leadName ?? "lead"}</a>
                    </>
                  ) : null}
                </span>
                {a.amountCents ? <span className="num">{money(a.amountCents)}</span> : null}
                <span className="muted small">
                  {dateTime(a.decidedAt ?? a.createdAt)}
                  {a.status !== "expired" && a.decidedBy && DECIDED_BY[a.decidedBy] ? ` · ${DECIDED_BY[a.decidedBy]}` : ""}
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
