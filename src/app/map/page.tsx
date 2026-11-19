import type { Metadata } from "next";
import MapExplorer from "@/components/map/MapExplorer";
import NewsTicker from "@/components/NewsTicker";
import GuideAutoOpen from "@/components/GuideAutoOpen";

export const metadata: Metadata = {
  title: "Full-screen interactive map",
  description: "The full-screen Neon Atlas map of Leonida with every secret, Easter egg and tip, plus the Sol voice guide.",
  alternates: { canonical: "/map" },
};

export default async function FullMap({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const { edit } = await searchParams;
  return (
    <>
      <MapExplorer variant="full" editMode={edit === "1"} ticker={<NewsTicker className="explorer__ticker" />} />
      <GuideAutoOpen />
    </>
  );
}
