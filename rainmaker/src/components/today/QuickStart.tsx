"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Bot } from "lucide-react";
import { RainMark } from "@/components/ui";

export function QuickStart({ niches, defaultNiche, defaultCity }: { niches: { id: string; label: string }[]; defaultNiche: string; defaultCity: string }) {
  const router = useRouter();
  const [niche, setNiche] = useState(defaultNiche);
  const [city, setCity] = useState(defaultCity);
  const label = niches.find((n) => n.id === niche)?.label.toLowerCase() ?? "businesses";
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (!city.trim()) return;
    router.push(`/prospects?${new URLSearchParams({ niche, location: city.trim(), go: "1" })}`);
  };
  const agentGoal = `Find 15 ${label} businesses in ${city || "my city"} that clearly need help with their website, booking or reviews`;
  return (
    <section className="hero">
      <svg className="hero-rain" width="260" height="200" viewBox="0 0 260 200" aria-hidden>
        {Array.from({ length: 28 }, (_, i) => (
          <line key={i} x1={(i * 37) % 260} y1={(i * 53) % 200} x2={((i * 37) % 260) - 8} y2={((i * 53) % 200) + 26} stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        ))}
      </svg>
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <span className="brand-mark" style={{ width: 26, height: 26, boxShadow: "none" }}>
          <RainMark size={15} />
        </span>
        <span className="small" style={{ opacity: 0.85, fontWeight: 600 }}>
          Find your next client
        </span>
      </div>
      <h2>Who do you want to work with?</h2>
      <p>Pick a niche and a city. Rainmaker finds the businesses, checks their websites, and ranks them by how much they need you.</p>
      <form className="hero-form" onSubmit={go}>
        <select className="select" value={niche} onChange={(e) => setNiche(e.target.value)} aria-label="Niche">
          {niches.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        <input className="input" value={city} onChange={(e) => setCity(e.target.value)} placeholder="City, e.g. Austin, TX" aria-label="City" required />
        <button className="btn lg" type="submit">
          Find clients <ArrowRight size={16} />
        </button>
      </form>
      <button
        type="button"
        className="btn ghost sm"
        style={{ marginTop: 12, color: "rgba(255,255,255,.85)" }}
        onClick={() => router.push(`/agents?${new URLSearchParams({ agent: "prospector", goal: agentGoal })}`)}
      >
        <Bot size={14} /> Or let the Prospector agent do it for you
      </button>
    </section>
  );
}
