// Starting a conversation with the Kestrel agent on ElevenLabs. The agent is private: this
// computer holds your ElevenLabs API key and asks ElevenLabs for a short-lived conversation token
// (voice, over WebRTC) or a signed URL (typed chat, over a WebSocket). The key never reaches the page.
export const ELEVENLABS = "https://api.elevenlabs.io";

export async function voiceSession({ apiKey, agentId }, mode = "voice", base = ELEVENLABS) {
  if (!apiKey) return { ok: false, error: "nokey", message: "Add your ElevenLabs API key in Settings to talk to Kestrel." };
  if (!agentId) return { ok: false, error: "agent", message: "No ElevenLabs agent is set. Add the agent ID in Settings." };
  const endpoint = mode === "text" ? "get-signed-url" : "token";
  let res;
  try {
    res = await fetch(`${base}/v1/convai/conversation/${endpoint}?agent_id=${encodeURIComponent(agentId)}`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(12_000) });
  } catch {
    return { ok: false, error: "network", message: "Couldn't reach ElevenLabs. Check this computer's internet connection." };
  }
  if (res.status === 401 || res.status === 403) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: "auth", message: /permission/i.test(t) ? "Your ElevenLabs API key needs the “ElevenLabs Agents” permission (Write). Edit the key at elevenlabs.io → Developers → API keys." : "ElevenLabs didn't accept the API key. Paste it again in Settings." };
  }
  if (res.status === 404) return { ok: false, error: "agent", message: "That ElevenLabs account doesn't have the Kestrel agent. Check the agent ID in Settings, or use a key from the account the agent was made in." };
  if (!res.ok) return { ok: false, error: "upstream", message: `ElevenLabs answered ${res.status}. Try again in a moment.` };
  const data = await res.json().catch(() => ({}));
  if (mode === "text" && data.signed_url) return { ok: true, auth: { signedUrl: data.signed_url } };
  if (data.token) return { ok: true, auth: { conversationToken: data.token } };
  return { ok: false, error: "upstream", message: "Unexpected answer from ElevenLabs." };
}

/** The account's credits this month (ElevenLabs won't start conversations once they're used up). */
export async function voiceCredits({ apiKey }, base = ELEVENLABS) {
  if (!apiKey) return { ok: false };
  try {
    const res = await fetch(`${base}/v1/user/subscription`, { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { ok: false };
    const s = await res.json();
    const limit = Number(s.character_limit) || 0;
    const used = Number(s.character_count) || 0;
    return { ok: true, used, limit, left: Math.max(0, limit - used), renews: s.next_character_count_reset_unix ? new Date(s.next_character_count_reset_unix * 1000).toISOString() : null };
  } catch {
    return { ok: false };
  }
}
