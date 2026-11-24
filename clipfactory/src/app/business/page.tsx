import type { Metadata } from "next";
import Business from "@/components/Business";

export const metadata: Metadata = {
  title: "Clipping business · Clip Factory",
  description: "Who to clip, paid campaigns, your accounts, scheduled posts and what they earned.",
};

export default function Page() {
  return <Business />;
}
