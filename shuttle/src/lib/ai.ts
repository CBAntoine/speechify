// Optional: title, summary, chapters and action items written by Claude from
// the transcript. Runs only when the user saves their own Anthropic API key in
// Settings; the key and the transcript go straight from this browser to the
// Anthropic API. The video itself is never sent.

import Anthropic from '@anthropic-ai/sdk';
import type { Segment } from './types.ts';
import { clock } from './captions.ts';

export interface AiNotes {
  title: string;
  summary: string;
  chapters: Array<{ start_seconds: number; title: string }>;
  action_items: string[];
}

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A specific title, at most 70 characters, no quotes.' },
    summary: { type: 'string', description: 'Two short paragraphs separated by a blank line.' },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start_seconds: { type: 'number', description: 'Copied from a [seconds] stamp in the transcript.' },
          title: { type: 'string', description: 'At most 6 words.' },
        },
        required: ['start_seconds', 'title'],
        additionalProperties: false,
      },
    },
    action_items: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'chapters', 'action_items'],
  additionalProperties: false,
} as const;

const SYSTEM = `You write the notes that accompany a recorded screen-share video: a title, a short summary, chapters and action items. You receive the speaker's transcript, one phrase per line, each line starting with its start time in seconds.

Write for a colleague deciding whether to watch. Use the speaker's own terms and plain, direct sentences. Mention concrete names, numbers and decisions that appear in the transcript; never invent details that are not there.

Chapters mark real topic changes. The first chapter starts at the first transcript line. Use 2 to 8 chapters depending on length; a recording under a minute may have just one. Every start_seconds must be copied exactly from one of the [seconds] stamps.

Action items are tasks, requests or follow-ups the speaker states or clearly implies. Return an empty list when there are none.`;

export class AiError extends Error {}

export async function writeNotes(apiKey: string, transcript: Segment[], signal?: AbortSignal): Promise<AiNotes> {
  const lines = transcript
    .filter((s) => s.text.trim())
    .map((s) => `[${s.start.toFixed(1)}] (${clock(s.start)}) ${s.text.trim()}`)
    .join('\n');
  if (!lines) throw new AiError('There is no transcript to summarize yet.');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const stream = client.beta.messages.stream(
      {
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: `Transcript:\n\n${lines}` }],
      },
      { signal },
    );
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new AiError('Claude declined to summarize this transcript.');
    if (msg.stop_reason === 'max_tokens') throw new AiError('The notes were cut off. Try again.');
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const parsed = JSON.parse(text) as AiNotes;
    return parsed;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('The Anthropic API key was rejected. Check it in Settings.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError('This API key is not allowed to use the model. Check your Anthropic Console.');
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Anthropic rate limit reached. Wait a minute and try again.');
    if (err instanceof Anthropic.APIUserAbortError) throw new AiError('Cancelled.');
    if (err instanceof Anthropic.APIConnectionError) throw new AiError('Could not reach the Anthropic API. Check your connection.');
    if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic API error ${err.status ?? ''}: ${err.message}`);
    if (err instanceof SyntaxError) throw new AiError('The response was not valid notes. Try again.');
    throw err;
  }
}
