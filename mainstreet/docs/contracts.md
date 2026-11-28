# Internal contracts

How the parts of Mainstreet talk to each other. Types live in `src/types.ts`.

## Conventions (all server code)

- Node 22.13+, run directly with type stripping: import local files **with the `.ts` extension**, use `import type` for types, no `enum`, `namespace` or constructor parameter properties.
- ESM only. No `__dirname`: use `fileURLToPath(new URL(".", import.meta.url))`.
- No new npm dependencies without a good reason (installed: `@anthropic-ai/sdk`, `hono`, `@hono/node-server`, `playwright`, `zod`; dev: React, Vite, `@elevenlabs/react`, `lucide-react`).
- Everything the crew makes lives under `DATA_DIR` (default `./data`). Paths stored in the database are relative to it.

```
data/
  mainstreet.db
  leads/<leadId>/hero.jpg             hero image (ElevenLabs Image API) — optional
  leads/<leadId>/sites/<variant>/index.html
  leads/<leadId>/sites/<variant>/shot.jpg   mobile screenshot (thumbnail + video source)
  leads/<leadId>/video/voice.mp3
  leads/<leadId>/video/video.mp4
  leads/<leadId>/video/poster.jpg
```

## URLs

| URL | Who | What |
|---|---|---|
| `/` | owner | dashboard (web/dist) |
| `/api/*` | owner | JSON API below (cookie session when `APP_PASSWORD` is set) |
| `/files/<path>` | owner | any file under DATA_DIR |
| `/p/<token>` | prospect | the proposal page |
| `/p/<token>/site/<variant>/` | prospect | a mockup (renders `leads/<id>/sites/<variant>/index.html`) |
| `/p/<token>/hero.jpg` | prospect | the hero image used by the mockups |
| `/p/<token>/video.mp4`, `/p/<token>/poster.jpg` | prospect | the video |
| `/p/<token>/claim` | prospect | starts Stripe Checkout (or shows "reply to claim" when Stripe is off) |
| `/u/<token>` | prospect | one-click unsubscribe |
| `/live/<slug>/` | public | a paid client's live site |
| `/webhooks/stripe`, `/webhooks/inbound-email` | services | webhooks |
| `/api/voice/tools/<name>` | ElevenLabs | webhook tools (when PUBLIC_URL is set) |
| `/mcp` | Claude / other MCP clients | the same commands over MCP (bearer `MCP_TOKEN`) |

Inside a mockup, the hero image is referenced as `../../hero.jpg` (relative), so the same HTML works under `/p/<token>/site/<variant>/` and when opened from disk for screenshots (`leads/<id>/sites/<variant>/index.html` → `leads/<id>/hero.jpg`). The live copy is written with `mode: "live"`.

## Site renderer — `src/site/`

```ts
// src/site/design.ts
export const PALETTES: Record<PaletteId, Palette>;     // Palette = { name, primary, primaryInk, accent, bg, surface, ink, muted, border }
export const FONT_PAIRS: Record<FontPairId, FontPair>; // FontPair = { heading, body, googleHref, headingWeight }
export const ICONS: Record<IconName, string>;          // inline SVG markup (24x24, stroke=currentColor)

// src/site/render.ts
export const VARIANTS: { id: VariantId; label: string; description: string }[];
export interface RenderInput {
  spec: SiteSpec;
  facts: BusinessFacts;
  variant: VariantId;
  heroImageUrl?: string;             // e.g. "../../hero.jpg"; when missing the hero uses generated CSS/SVG art
  mode: "preview" | "live";
  preview?: { agencyName: string; claimUrl: string; priceLabel: string }; // the slim "made for you" bar in preview mode
}
export function renderSite(input: RenderInput): string;   // a complete, self-contained HTML document

// src/site/proposal.ts
export interface ProposalInput {
  token: string;
  business: { name: string; city: string; nicheLabel: string };
  agency: { name: string; ownerName: string; email: string; phone?: string; postalAddress: string; bookingUrl?: string };
  variants: { id: VariantId; label: string; url: string; thumbUrl?: string }[];
  video?: { url: string; poster: string };
  noticed: string[];                // "What we noticed" bullets (diagnosis evidence, plain words)
  priceLabel: string;               // "$500"
  hostingLabel?: string;            // "then $29/mo hosting (optional)"
  deliveryDays: number;
  guarantee: string;
  claimUrl: string;                 // "/p/<token>/claim"
  unsubscribeUrl: string;           // "/u/<token>"
  state: "open" | "paid" | "closed";
}
export function renderProposal(input: ProposalInput): string;
```

## Video — `src/video/`, `src/providers/browser.ts`, `src/providers/ffmpeg.ts`

```ts
// src/providers/browser.ts
export async function getBrowser(): Promise<import("playwright").Browser>; // shared instance; CHROMIUM_PATH → bundled → channel "chrome"
export async function browserAvailable(): Promise<{ ok: boolean; how?: string; error?: string }>;
export async function screenshotFile(fileOrUrl: string, opts: { width: number; height: number; scale?: number; fullPage?: boolean; type?: "png" | "jpeg"; quality?: number }): Promise<Buffer>;
export async function renderHtmlToPng(html: string, opts: { width: number; height: number; transparent?: boolean }): Promise<Buffer>;
export async function closeBrowser(): Promise<void>;

// src/providers/ffmpeg.ts
export function ffmpegPath(): string;  // FFMPEG_PATH or "ffmpeg"
export async function hasFfmpeg(): Promise<boolean>;
export async function runFfmpeg(args: string[], opts?: { timeoutMs?: number }): Promise<void>;
export async function probeDuration(file: string): Promise<number>;

// src/video/captions.ts
export interface Caption { text: string; start: number; end: number }
export interface Alignment { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }
export function captionsFromAlignment(a: Alignment, maxWords?: number): Caption[];
export function captionsFromText(script: string, durationSec: number, maxWords?: number): Caption[];

// src/video/say.ts — offline voice for demo mode
export async function systemSpeech(text: string, outMp3: string): Promise<boolean>; // macOS `say` or espeak-ng; false when neither exists

// src/video/compose.ts
export interface ComposeInput {
  siteShot: string;                 // absolute path to a full-page mobile screenshot (PNG/JPEG, ~1170px wide)
  outDir: string;                   // writes video.mp4 + poster.jpg (+ temp files it cleans up)
  audioPath?: string;               // voiceover; silent track when missing
  durationSec?: number;             // used when there is no audio (default 12)
  captions: Caption[];
  hook: string;                     // top text, e.g. "We built Bright Smile Dental a new website"
  endCard: { title: string; subtitle: string }; // e.g. "$500 · live this week", "Reply YES to claim it"
  brand: { primary: string; accent: string; ink: string; bg: string };
  businessName: string;
}
export interface ComposeResult { videoPath: string; posterPath: string; durationSec: number }
export async function composeVideo(input: ComposeInput): Promise<ComposeResult>;
```

## Dashboard API — `/api/*`

All JSON. Errors: non-2xx with `{ error: string }`.

| Method & path | Body / query | Returns |
|---|---|---|
| `GET /api/me` | | `{ authed, passwordRequired, ownerName, agencyName, demo }` |
| `POST /api/login` | `{ password }` | `{ ok: true }` (sets cookie) or 401 |
| `POST /api/logout` | | `{ ok: true }` |
| `GET /api/overview` | | `Overview` |
| `GET /api/leads` | `?status=&q=&limit=50&offset=0` | `{ leads: LeadSummary[], total, counts: Partial<Record<LeadStatus, number>> }` |
| `GET /api/leads/:id` | | `{ lead: LeadDetail, messages: Message[], events: CrewEvent[] }` |
| `GET /api/approvals` | `?status=pending` | `{ approvals: Approval[] }` |
| `GET /api/outreach` | | `{ cap, sentToday, scheduled: ScheduledItem[], oneTap: OneTapItem[], inbox: InboxItem[] }` |
| `GET /api/events` | `?before=<id>&limit=100&agent=` | `{ events: CrewEvent[] }` |
| `GET /api/settings` | | `{ settings: Settings, integrations: Integrations, niches: { id, label }[] }` |
| `PATCH /api/settings` | partial `Settings` (deep merge) | `{ settings: Settings }` |
| `GET /api/commands` | | `{ commands: { name, description, risk: "read" \| "write" \| "confirm", params: JSONSchema }[] }` |
| `POST /api/commands/:name` | the command's args | `CommandResult` |
| `POST /api/voice/session` | `{ mode: "voice" \| "text" }` | `{ ok: true, auth: { conversationToken } \| { signedUrl }, dynamicVariables }` or `{ ok: false, error }` |
| `GET /api/voice/status` | | `{ configured, agentId?, toolMode: "client" \| "webhook", talkUrl? }` |
| `POST /api/voice/sync` | | `{ ok, agentId, created, tools }` — creates or updates Atlas in ElevenLabs from the command registry |
| `GET /api/stream` | | Server-Sent Events, below |

```ts
type LeadDetail = Lead & {
  proposalUrl?: string;                                   // absolute when PUBLIC_URL is set
  files: {
    variants: { id: VariantId; label: string; url: string; thumb?: string }[];  // url = /p/<token>/site/<id>/
    video?: { url: string; poster: string };
    heroImage?: string;
  };
};
interface ScheduledItem { leadId: string; leadName: string; subject: string; status: Message["status"]; sendAfter?: string; messageId: string }
interface OneTapItem { leadId: string; leadName: string; channel: "call" | "sms" | "dm"; href: string; text: string; done: boolean }
interface InboxItem extends Message { leadName: string }
```

SSE events (`event:` name → `data:` JSON): `crew-event` → `CrewEvent`; `lead` → `{ id, name, status }`; `agent` → `AgentStatus`; `overview` → `{}` (refetch hint). A comment ping every 20 s.

## Commands

Every action (dashboard buttons, Atlas, MCP) goes through one registry (`src/commands/`). Names and args:

| name | args | risk |
|---|---|---|
| `get_briefing` | – | read |
| `get_metrics` | `period?: "today" \| "7d" \| "30d" \| "all"` | read |
| `find_leads` | `query?, status?, city?, niche?, limit?` | read |
| `get_lead` | `lead` (id or business name) | read |
| `list_approvals` | – | read |
| `decide_approval` | `approval_id, decision: "approve" \| "reject", note?, confirmed?` | confirm |
| `run_agent` | `agent, lead?, city?, region?, niche?, count?` | write |
| `pause_crew` / `resume_crew` | `agent?` | write |
| `update_setting` | `path` (e.g. `quotas.pitchesPerDay`), `value`, `confirmed?` | confirm |
| `add_target` | `city?, region?, country?, niche?` | write |
| `remove_target` | `city?, niche?` | write |
| `send_pitch` | `lead, confirmed?` | confirm |
| `send_reply` | `lead, body?, confirmed?` | confirm |
| `draft_reply` | `lead, instructions?` | write |
| `log_outcome` | `lead, outcome, note?, amount?` | write |
| `add_note` | `lead, note` | write |
| `add_lead` | `name, city, region?, niche?, phone?, website?, email?` | write |
| `rebuild` | `lead, what: "mockups" \| "video" \| "pitch" \| "all"` | write |
| `get_activity` | `agent?, limit?` | read |
| `get_spend` | `period?` | read |
| `get_call_list` | – | read |
| `open_screen` | `screen, lead_id?` | browser only (handled by the dashboard, never by the server) |

`confirm` commands answer `{ ok: false, needsConfirmation: { summary } }` until called again with `confirmed: true`.
