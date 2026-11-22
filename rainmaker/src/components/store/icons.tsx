import {
  AudioLines, Captions, Clapperboard, FileText, Globe, Headphones, Image, Languages, Megaphone, MessageCircle, MessageSquare, Mic, Music,
  PhoneCall, PhoneOutgoing, Podcast, Rocket, Store, TrendingUp, Video, Waves, type LucideIcon,
} from "lucide-react";

// Only the icons the catalog uses, so the store bundle stays small.
const ICONS: Record<string, LucideIcon> = {
  AudioLines, Captions, Clapperboard, FileText, Globe, Headphones, Image, Languages, Megaphone, MessageCircle, MessageSquare, Mic, Music,
  PhoneCall, PhoneOutgoing, Podcast, Rocket, TrendingUp, Video, Waves,
};

export function OfferIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Ico = ICONS[name] ?? Store;
  return <Ico size={size} aria-hidden />;
}
