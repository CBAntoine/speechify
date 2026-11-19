import type { Metadata } from "next";
import { SectionHead, TipsGrid } from "@/components/sections";
import AdSlot from "@/components/AdSlot";
import { STATS } from "@/lib/data";

export const metadata: Metadata = {
  title: "GTA 6 tips and tricks for beginners",
  description:
    "Verified GTA VI tips from outlets that have played it: money, police heat, Focus Mode, exploration and vehicles, plus clearly labelled theories.",
  alternates: { canonical: "/tips" },
};

export default function TipsPage() {
  return (
    <div className="page page--wide">
      <SectionHead
        eyebrow={`${STATS.tips} tips · updated daily`}
        title={
          <>
            Tips &amp; <span className="grad-text">tricks</span>
          </>
        }
        lede="Confirmed tips come from outlets with hands-on time. Reported tips come from launch guides and players. Theories are our own reasoning, labelled so you always know which is which."
      />
      <TipsGrid />
      <div style={{ marginTop: 40 }}>
        <AdSlot variant="inline" />
      </div>
    </div>
  );
}
