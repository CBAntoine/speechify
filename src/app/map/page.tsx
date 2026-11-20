import type { Metadata } from "next";
import MapExplorer from "@/components/map/MapExplorer";
import NewsTicker from "@/components/NewsTicker";
import GuideAutoOpen from "@/components/GuideAutoOpen";

export const metadata: Metadata = {
  title: "GTA 6 Interactive Map: Every Secret & Easter Egg",
  description: "Full-screen interactive GTA 6 map of Leonida with every secret, Easter egg and tip, plus Sol, the voice guide that flies the map for you.",
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
