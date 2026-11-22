"use client";

import { useEffect, useState } from "react";
import { Download, LoaderCircle, Mic, Sparkles, Trash } from "lucide-react";
import { api, useToast } from "@/components/client";
import { timeAgo } from "@/lib/format";
import type { AdCampaign, ArtSize } from "@/lib/types";

// ElevenLabs media for a campaign: custom background art for the creative
// card (Image & Video API) and finished audio ads (text to speech).

export function ArtControls({ campaign, size, enabled, onUpdate }: { campaign: AdCampaign; size: ArtSize; enabled: boolean; onUpdate: (c: AdCampaign) => void }) {
  const toast = useToast();
  const [prompt, setPrompt] = useState(campaign.creative.artPrompt ?? "");
  const [busy, setBusy] = useState(false);
  useEffect(() => setPrompt(campaign.creative.artPrompt ?? ""), [campaign.id, campaign.creative.artPrompt]);
  const current = campaign.art?.[size];

  async function make() {
    setBusy(true);
    try {
      const r = await api<{ campaign: AdCampaign }>(`/api/ads/${campaign.id}/art`, { method: "POST", json: { size, prompt: prompt.trim() || undefined } });
      onUpdate(r.campaign);
      toast("Custom art is ready. The card uses it now.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
      <b className="small">
        <Sparkles size={13} style={{ display: "inline", verticalAlign: -2 }} /> Custom AI art
      </b>
      <label className="field">
        <span>What the picture should show (no text: the card adds it)</span>
        <textarea className="textarea" rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. A bright, modern dental clinic with soft morning light, teal and white tones" maxLength={1500} />
      </label>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn sm primary" onClick={() => void make()} disabled={busy || !enabled}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />} {busy ? "Painting (about 20 seconds)…" : current ? "Make new art for this size" : "Make art for this size"}
        </button>
        {current && (
          <a className="btn sm" href={`/api/assets/${current.assetId}?download=${encodeURIComponent(`${campaign.businessName}-art-${size}`)}`}>
            <Download size={14} /> Art only
          </a>
        )}
      </div>
      <div className="faint small">
        {enabled
          ? current
            ? `Made ${timeAgo(current.createdAt)} with ElevenLabs (${current.model}), in the business's brand colours when its website has them.`
            : "Made with the ElevenLabs Image & Video API in the business's brand colours. Needs the Pro plan or above; uses credits."
          : "Add your ElevenLabs key in Settings → API keys to make custom art."}
      </div>
    </div>
  );
}

type Voice = { voiceId: string; name: string; category?: string };

export function AudioTab({ campaign, enabled, onUpdate }: { campaign: AdCampaign; enabled: boolean; onUpdate: (c: AdCampaign) => void }) {
  const toast = useToast();
  const [script, setScript] = useState(campaign.audio?.script ?? campaign.video[0]?.script ?? "");
  const [voices, setVoices] = useState<Voice[]>([]);
  const [voiceId, setVoiceId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setScript(campaign.audio?.script ?? campaign.video[0]?.script ?? ""), [campaign.id, campaign.audio?.script, campaign.video]);

  useEffect(() => {
    if (!enabled) return;
    api<{ voices: Voice[]; defaultVoiceId: string }>("/api/elevenlabs/voices")
      .then((r) => {
        setVoices(r.voices);
        setVoiceId((v) => v || r.defaultVoiceId);
      })
      .catch(() => undefined);
  }, [enabled]);

  const words = script.trim().split(/\s+/).filter(Boolean).length;

  async function make() {
    setBusy("make");
    try {
      const r = await api<{ campaign: AdCampaign }>(`/api/ads/${campaign.id}/voiceover`, { method: "POST", json: { text: script, voiceId: voiceId || undefined } });
      onUpdate(r.campaign);
      toast("Voiceover ready");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const r = await api<{ campaign: AdCampaign }>(`/api/ads/${campaign.id}/voiceover?voiceover=${encodeURIComponent(id)}`, { method: "DELETE" });
      onUpdate(r.campaign);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid-2 wide-left">
      <div className="card card-pad stack">
        <div className="row between">
          <b>{campaign.audio?.title ?? "Audio ad"}</b>
          <span className={`faint small ${words > 85 ? "margin-warn" : ""}`}>
            {words} words · about {Math.max(1, Math.round(words / 2.5))} seconds
          </span>
        </div>
        <textarea className="textarea" rows={8} value={script} onChange={(e) => setScript(e.target.value)} maxLength={5000} aria-label="Audio ad script" />
        <div className="faint small">For radio, Spotify and YouTube audio ads, on-hold messages and video voiceovers. 55–80 words fits a 30-second spot.</div>
        <div className="row wrap" style={{ gap: 8 }}>
          <select className="select" style={{ maxWidth: 280 }} value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={!enabled || !voices.length} aria-label="Voice">
            {!voices.length && <option value="">{enabled ? "Loading voices…" : "No voices"}</option>}
            {voices.map((v) => (
              <option key={v.voiceId} value={v.voiceId}>
                {v.name}
              </option>
            ))}
          </select>
          <button className="btn primary" onClick={() => void make()} disabled={!enabled || busy === "make" || !script.trim()}>
            {busy === "make" ? <LoaderCircle size={15} className="spin" /> : <Mic size={15} />} {busy === "make" ? "Recording…" : "Make voiceover"}
          </button>
        </div>
        {!enabled && <div className="faint small">Add your ElevenLabs key in Settings → API keys to make voiceovers.</div>}
      </div>
      <div className="card card-pad stack">
        <b>Voiceovers</b>
        {!campaign.voiceovers?.length ? (
          <div className="faint small">None yet. Each one is saved here with the script it read.</div>
        ) : (
          campaign.voiceovers.map((v) => (
            <div key={v.id} className="stack" style={{ gap: 6, paddingBottom: 10, borderBottom: "1px solid var(--line)" }}>
              <div className="row between">
                <span className="small">
                  <b>{v.voiceName ?? "Default voice"}</b> · {timeAgo(v.createdAt)}
                </span>
                <span className="row" style={{ gap: 4 }}>
                  <a className="btn ghost icon sm" href={`/api/assets/${v.assetId}?download=${encodeURIComponent(`${campaign.businessName}-voiceover`)}`} aria-label="Download MP3" title="Download MP3">
                    <Download size={15} />
                  </a>
                  <button className="btn ghost icon sm" onClick={() => void remove(v.id)} disabled={busy === v.id} aria-label="Delete voiceover">
                    <Trash size={15} />
                  </button>
                </span>
              </div>
              <audio controls preload="none" src={`/api/assets/${v.assetId}`} style={{ width: "100%" }} />
              <div className="faint small" style={{ whiteSpace: "pre-wrap" }}>
                {v.text.length > 220 ? `${v.text.slice(0, 220)}…` : v.text}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
