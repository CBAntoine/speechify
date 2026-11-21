"use client";

import { useState } from "react";
import { Globe, Heart, MessageCircle, Share2 } from "lucide-react";
import { charCount, LIMITS } from "@/lib/ads/limits";
import { hue, initials } from "@/lib/format";
import type { Creative, MetaAd } from "@/lib/types";
import { CreativeSvg, type CreativeTemplate } from "./Creative";

export function Counter({ text, max }: { text: string; max: number }) {
  const n = charCount(text);
  return (
    <span className={`counter ${n > max ? "over" : ""}`} title={n > max ? `Over the ${max}-character limit` : `${max - n} characters left`}>
      {n}/{max}
    </span>
  );
}

/** A generic social feed post, the way the ad reads on a phone. */
export function FeedPreview({ ad, business, creative, template, url }: { ad: MetaAd; business: string; creative: Creative; template: CreativeTemplate; url?: string }) {
  const domain = (url ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") || "your-site.com";
  const [more, setMore] = useState(false);
  const cut = LIMITS.metaPrimary;
  const long = charCount(ad.primaryText) > cut;
  const text = more || !long ? ad.primaryText : `${Array.from(ad.primaryText).slice(0, cut).join("").trimEnd()}…`;
  return (
    <div className="feed-post">
      <div className="fp-head">
        <span className="fp-logo" style={{ background: hue(business) }}>
          {initials(business)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div className="truncate" style={{ fontWeight: 650, fontSize: 13.5 }}>
            {business}
          </div>
          <div className="faint" style={{ fontSize: 11.5 }}>
            Sponsored · <Globe size={10} style={{ display: "inline", verticalAlign: "-1px" }} />
          </div>
        </div>
      </div>
      <div className="fp-text">
        {text}
        {long && (
          <button type="button" onClick={() => setMore(!more)} className="faint" style={{ border: 0, background: "none", padding: 0, marginLeft: 4, cursor: "pointer", fontWeight: 600 }}>
            {more ? "See less" : "See more"}
          </button>
        )}
      </div>
      <CreativeSvg creative={{ ...creative }} business={business} template={template} />
      <div className="fp-cta">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="faint truncate" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>
            {domain}
          </div>
          <div className="truncate" style={{ fontWeight: 650, fontSize: 14 }}>
            {ad.headline}
          </div>
          <div className="faint truncate" style={{ fontSize: 12.5 }}>
            {ad.description}
          </div>
        </div>
        <span className="btn sm">{ad.cta}</span>
      </div>
      <div className="row faint" style={{ padding: "8px 14px 10px", gap: 18, fontSize: 12.5, borderTop: "1px solid var(--line)" }}>
        <span className="row" style={{ gap: 5 }}>
          <Heart size={14} /> Like
        </span>
        <span className="row" style={{ gap: 5 }}>
          <MessageCircle size={14} /> Comment
        </span>
        <span className="row" style={{ gap: 5 }}>
          <Share2 size={14} /> Share
        </span>
      </div>
    </div>
  );
}

/** A generic search-results text ad. */
export function SearchPreview({ headlines, descriptions, url, business }: { headlines: string[]; descriptions: string[]; url?: string; business: string }) {
  const domain = (url ?? "").replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, "") || "your-site.com";
  return (
    <div className="serp">
      <div className="faint" style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
        Sponsored
      </div>
      <div className="sp-site">
        <span className="fp-logo" style={{ width: 26, height: 26, fontSize: 10, background: hue(business) }}>
          {initials(business)}
        </span>
        <span>
          <div style={{ fontWeight: 600 }}>{business}</div>
          <div className="faint" style={{ fontSize: 12 }}>
            https://{domain}
          </div>
        </span>
      </div>
      <div className="sp-title">{headlines.slice(0, 3).join(" | ")}</div>
      <div className="sp-desc">{descriptions.slice(0, 2).join(" ")}</div>
    </div>
  );
}
