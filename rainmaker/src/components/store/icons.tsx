import {
  AudioLines, Captions, Clapperboard, FileText, Globe, Headphones, Image, Languages, Megaphone, MessageCircle, MessageSquare, Mic, Music,
  PhoneCall, PhoneOutgoing, Podcast, Rocket, Store, TrendingUp, Video, Waves, type LucideIcon,
} from "lucide-react";
import { toneOf } from "./tone";

// Only the icons the catalog uses, so the store bundle stays small.
const ICONS: Record<string, LucideIcon> = {
  AudioLines, Captions, Clapperboard, FileText, Globe, Headphones, Image, Languages, Megaphone, MessageCircle, MessageSquare, Mic, Music,
  PhoneCall, PhoneOutgoing, Podcast, Rocket, TrendingUp, Video, Waves,
};

export function OfferIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Ico = ICONS[name] ?? Store;
  return <Ico size={size} aria-hidden />;
}

/** The offer's icon on its gradient orb. */
export function OfferOrb({ offer, size = 18 }: { offer: { id: string; category: string; icon: string }; size?: number }) {
  return (
    <span className="offer-icon">
      <span className={`orb idle ${toneOf(offer)}`} aria-hidden />
      <OfferIcon name={offer.icon} size={size} />
    </span>
  );
}
