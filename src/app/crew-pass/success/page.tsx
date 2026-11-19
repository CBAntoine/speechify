import type { Metadata } from "next";
import Activate from "./Activate";

export const metadata: Metadata = { title: "Welcome to the crew", robots: { index: false } };

export default async function Success({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  return (
    <div className="page" style={{ maxWidth: 640, textAlign: "center" }}>
      <p className="eyebrow">Crew Pass</p>
      <h1 style={{ marginTop: 12 }}>
        Welcome to the <span className="grad-text">crew</span>
      </h1>
      <Activate sessionId={session_id ?? ""} />
    </div>
  );
}
