import { latestNews } from "@/lib/data";
import { relativeDay } from "@/lib/format";

export default function NewsTicker({ className = "" }: { className?: string }) {
  const items = latestNews(8);
  const row = items.map((i) => (
    <a key={i.id} href={i.url} target="_blank" rel="noopener noreferrer" className="ticker__item">
      <span className="ticker__src">{i.source}</span>
      {i.title}
      <span className="ticker__when">{relativeDay(i.publishedAt)}</span>
    </a>
  ));
  return (
    <div className={`ticker ${className}`} aria-label="Latest GTA VI headlines">
      <span className="ticker__label">
        <span className="live-dot" aria-hidden="true" /> Intel
      </span>
      <div className="ticker__viewport">
        <div className="ticker__track">
          {row}
          <span aria-hidden="true" className="ticker__dupe">
            {items.map((i) => (
              <span key={`d-${i.id}`} className="ticker__item">
                <span className="ticker__src">{i.source}</span>
                {i.title}
                <span className="ticker__when">{relativeDay(i.publishedAt)}</span>
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
