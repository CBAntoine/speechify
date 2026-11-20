import { useEffect, useRef, useState } from 'react';

/** Speaker notes that can scroll on their own at a chosen pace. */
export function Teleprompter({ text, running, compact = false }: { text: string; running: boolean; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(22);

  useEffect(() => {
    if (!auto || !running) return;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const tick = (now: number) => {
      const el = ref.current;
      if (el) {
        carry += ((now - last) / 1000) * speed;
        const whole = Math.floor(carry);
        if (whole) {
          el.scrollTop += whole;
          carry -= whole;
        }
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [auto, running, speed]);

  return (
    <div className={`prompter ${compact ? 'prompter-compact' : ''}`}>
      <div className="prompter-text" ref={ref} tabIndex={0}>
        {text.split(/\n{2,}/).map((para, i) => (
          <p key={i}>{para}</p>
        ))}
        <div className="prompter-tail" />
      </div>
      <div className="prompter-controls">
        <label>
          <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-scroll
        </label>
        {auto && (
          <input
            type="range"
            min={8}
            max={70}
            value={speed}
            aria-label="Scroll speed"
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        )}
      </div>
    </div>
  );
}
