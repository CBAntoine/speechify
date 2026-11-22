"use client";

import { useEffect, useState } from "react";
import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { api, useToast } from "@/components/client";
import { openCopilot } from "@/components/copilot/Copilot";

// Settings > Connections: the copilot's ElevenLabs agent, with a button that
// creates it or pushes the prompt and tools from the code.

type AgentStatus = { connected: boolean; agentId?: string; name?: string; reason?: string; syncedAt?: string };

export function CopilotConnection({ elevenlabs }: { elevenlabs: boolean }) {
  const toast = useToast();
  const [st, setSt] = useState<AgentStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!elevenlabs) return;
    api<AgentStatus>("/api/copilot/agent").then(setSt).catch(() => setSt({ connected: false, reason: "Couldn't check" }));
  }, [elevenlabs]);

  async function sync() {
    setBusy(true);
    try {
      const r = await api<{ agentId: string; created: boolean; tools: number }>("/api/copilot/agent", { method: "POST" });
      toast(r.created ? `Copilot created with ${r.tools} tools` : `Copilot updated (${r.tools} tools)`);
      setSt(await api<AgentStatus>("/api/copilot/agent"));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  const ok = Boolean(elevenlabs && st?.connected);
  return (
    <div className="list-item">
      <span className="icon-tile" style={{ background: "transparent" }}>
        <span className="orb idle tone-sky" style={{ width: 26, height: 26 }} aria-hidden />
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div className="row between" style={{ gap: 8 }}>
          <b>Copilot</b>
          <span className={`badge ${ok ? "good" : "warm"}`}>{!elevenlabs ? "Text help only" : st ? (ok ? "Voice and chat" : "Needs setup") : "Checking…"}</span>
        </div>
        <div className="muted small">
          {elevenlabs
            ? "An ElevenLabs agent that runs Rainmaker for you by voice or text: it opens screens, clicks and fills things in, finds clients, works the pipeline and writes ads. Open it with Ctrl+K (Cmd+K on a Mac)."
            : "Set ELEVENLABS_API_KEY to talk to the copilot and let it take actions. Until then it opens screens and explains features."}
          {elevenlabs && st && !st.connected && st.reason ? ` ${st.reason}.` : ""}
        </div>
        <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
          <button className="btn sm" onClick={openCopilot}>
            Open copilot
          </button>
          {elevenlabs && (
            <button className="btn sm" onClick={() => void sync()} disabled={busy}>
              {busy ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />} {st?.agentId ? "Sync copilot" : "Create copilot"}
            </button>
          )}
          {st?.agentId && (
            <a className="btn sm ghost" href={`https://elevenlabs.io/app/agents/agents/${st.agentId}`} target="_blank" rel="noopener">
              <ExternalLink size={13} /> Open in ElevenLabs
            </a>
          )}
        </div>
      </span>
    </div>
  );
}
