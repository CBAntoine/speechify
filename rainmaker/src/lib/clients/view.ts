// What the client workspace screen shows, built from the client and their
// data on the server. Pure: everything needed comes in as arguments.

import type { CallLog, CallReview, Client, ClientData, ClientMessage, Contact, Sequence, ServiceId } from "../types.ts";
import { lastDays, monthPeriod, results, type Results } from "./metrics.ts";
import { quote, type Quote } from "./pricing.ts";
import { pickChannel } from "./rules.ts";

export type TabId = "overview" | ServiceId | "messages" | "contacts" | "settings";

export interface SetupItem {
  service: ServiceId;
  ok: boolean;
  text: string;
}

export interface WorkspaceView {
  client: Client;
  contacts: Contact[];
  contactTotal: number;
  messages: ClientMessage[];
  calls: CallLog[];
  sequences: Sequence[];
  reviews: CallReview[];
  counts: { drafts: number; needsHuman: number; optedOut: number; winbackEligible: number; customers: number; awaitingReview: number; failed: number };
  month: Results;
  last: Results;
  last30: Results;
  quote: Quote;
  base: string;
  integrations: { claude: boolean; twilio: boolean; resend: boolean; eleven: boolean; cron: boolean };
  campaigns: { id: string; businessName: string; createdAt: string }[];
  setup: SetupItem[];
}

export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** What each step still needs before it can run. */
export function setupChecklist(c: Client, d: Pick<ClientData, "contacts" | "sequences" | "reviews">, i: WorkspaceView["integrations"]): SetupItem[] {
  const text = Boolean(c.smsNumber || c.whatsappNumber);
  const items: SetupItem[] = [
    { service: "website", ok: Boolean(c.site), text: "Build the website" },
    { service: "website", ok: Boolean(c.site?.published), text: "Publish it" },
    { service: "reactivation", ok: d.contacts.some((x) => x.source === "import"), text: "Import their past customers" },
    { service: "reactivation", ok: d.contacts.some((x) => x.enrollments.some((e) => e.kind === "reactivation")), text: "Start the win-back" },
    { service: "reviews", ok: Boolean(c.reviewUrl), text: "Add their review link" },
    { service: "reviews", ok: d.contacts.some((x) => x.jobDoneAt), text: "Mark finished jobs" },
    { service: "speed_to_lead", ok: i.twilio && text, text: "Texting number (Twilio)" },
    { service: "speed_to_lead", ok: i.resend, text: "Email sending (Resend)" },
    { service: "speed_to_lead", ok: c.settings.autoSend || c.services.speed_to_lead.status !== "live", text: "Send without waiting for approval" },
    { service: "missed_calls", ok: Boolean(c.smsNumber), text: "Their Twilio number" },
    { service: "missed_calls", ok: Boolean(c.agentId), text: "Voice agent that answers" },
    { service: "missed_calls", ok: c.settings.callFlow === "forwarded" || Boolean(c.staffPhone), text: c.settings.callFlow === "forwarded" ? "Forward unanswered calls to it" : "Staff phone to ring first" },
    { service: "sales_coach", ok: d.reviews.length > 0, text: "Review a first call" },
    { service: "ads", ok: c.campaignIds.length > 0, text: "Write the first campaign" },
    { service: "ads", ok: c.adMonths.length > 0, text: "Record a month of results" },
  ];
  return items.filter((x) => c.services[x.service]?.included !== false);
}

export function buildView(input: {
  client: Client;
  data: ClientData;
  base: string;
  integrations: WorkspaceView["integrations"];
  campaigns: WorkspaceView["campaigns"];
  now?: Date;
}): WorkspaceView {
  const { client: c, data: d } = input;
  const now = input.now ?? new Date();
  const ym = monthKey(now);
  const yearAgo = now.getTime() - 365 * 86_400_000;
  const eligible = d.contacts.filter(
    (x) => x.source === "import" && !x.optedOutAt && !x.enrollments.some((e) => e.kind === "reactivation" && !e.stoppedAt) && (!x.lastVisit || Date.parse(x.lastVisit) < now.getTime() - 60 * 86_400_000) && pickChannel(x, "reactivation", c)
  );
  return {
    client: c,
    contacts: d.contacts.slice(0, 400),
    contactTotal: d.contacts.length,
    messages: d.messages.slice(-600),
    calls: d.calls.slice(0, 100),
    sequences: d.sequences,
    reviews: d.reviews.slice(0, 40),
    counts: {
      drafts: d.messages.filter((m) => m.status === "draft" && m.direction === "out").length,
      needsHuman: d.contacts.filter((x) => x.needsHuman && !x.optedOutAt).length,
      optedOut: d.contacts.filter((x) => x.optedOutAt).length,
      winbackEligible: eligible.length,
      customers: d.contacts.filter((x) => x.source === "import" || x.jobDoneAt || x.bookedAt).length,
      awaitingReview: d.contacts.filter((x) => x.jobDoneAt && !x.reviewClickedAt && Date.parse(x.jobDoneAt) > yearAgo).length,
      failed: d.messages.filter((m) => m.status === "failed").length,
    },
    month: results(c, d, monthPeriod(ym)),
    last: results(c, d, monthPeriod(previousMonth(ym))),
    last30: results(c, d, lastDays(30, now.getTime())),
    quote: quote(c.country, (Object.keys(c.services) as ServiceId[]).filter((s) => c.services[s].included)),
    base: input.base,
    integrations: input.integrations,
    campaigns: input.campaigns,
    setup: setupChecklist(c, d, input.integrations),
  };
}
