"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Bot } from "lucide-react";
import { PlacePicker, loadSavedPlace } from "@/components/PlacePicker";

export function QuickStart({ niches, defaultNiche, defaultCity }: { niches: { id: string; label: string }[]; defaultNiche: string; defaultCity: string }) {
  const router = useRouter();
  const [niche, setNiche] = useState(defaultNiche);
  const [city, setCity] = useState(defaultCity);
  useEffect(() => {
    const saved = loadSavedPlace();
    if (saved) setCity(saved);
  }, []);
  const label = niches.find((n) => n.id === niche)?.label.toLowerCase() ?? "businesses";
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    if (!city.trim()) return;
    router.push(`/prospects?${new URLSearchParams({ niche, location: city.trim(), go: "1" })}`);
  };
  const agentGoal = `Find 15 ${label} businesses in ${city || "my city"} that clearly need help with their website, booking or reviews`;
  return (
    <section className="hero">
      <span className="orb hero-orb tone-sky" aria-hidden />
      <div className="row" style={{ gap: 8, marginBottom: 12 }}>
        <span className="orb idle tone-lagoon" style={{ width: 14, height: 14 }} aria-hidden />
        <span className="small muted">Find your next client</span>
      </div>
      <h2>Who do you want to work with?</h2>
      <p>Pick a niche, a province or state, and a city. Rainmaker finds the businesses, checks their websites, and ranks them by how much they need you.</p>
      <form className="hero-form" onSubmit={go}>
        <select className="select" value={niche} onChange={(e) => setNiche(e.target.value)} aria-label="Niche">
          {niches.map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
        </select>
        <PlacePicker value={city} onChange={setCity} labels={false} />
        <button className="btn primary lg" type="submit">
          Find clients <ArrowRight size={16} />
        </button>
      </form>
      <button
        type="button"
        className="btn ghost sm"
        style={{ marginTop: 12 }}
        onClick={() => router.push(`/agents?${new URLSearchParams({ agent: "prospector", goal: agentGoal })}`)}
      >
        <Bot size={14} /> Or let the Prospector agent do it for you
      </button>
    </section>
  );
}
