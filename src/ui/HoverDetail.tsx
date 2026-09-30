import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

/**
 * Inline text with an explanation popover on hover, keyboard focus, or tap. Replaces the native
 * `title` tooltip, which is slow, unreliable inside scrolling tables, and absent on touch screens.
 * The popover is fixed-positioned so the table's scroll container can't clip it.
 */
export function HoverDetail(props: { lines: string[]; children: ComponentChildren }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean } | null>(null);

  const open = () => {
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    const above = r.bottom > window.innerHeight * 0.6;
    const width = Math.min(360, window.innerWidth - 32);
    const left = Math.min(Math.max(16, r.right - width), window.innerWidth - width - 16);
    setPos({ left, top: above ? r.top - 6 : r.bottom + 6, above });
  };
  const close = () => setPos(null);

  // A fixed popover would drift from its cell when anything scrolls, so close it instead.
  useEffect(() => {
    if (!pos) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  const [title, ...rest] = props.lines;
  return (
    <span
      ref={anchor}
      class="has-detail"
      tabIndex={0}
      aria-label={props.lines.join('. ')}
      onMouseEnter={open}
      onMouseLeave={close}
      onFocus={open}
      onBlur={close}
      onClick={() => (pos ? close() : open())}
    >
      {props.children}
      {pos && (
        <span
          class="detail-pop"
          role="tooltip"
          style={{ left: `${pos.left}px`, top: `${pos.top}px`, transform: pos.above ? 'translateY(-100%)' : undefined }}
        >
          <strong>{title}</strong>
          {rest.map((line, i) => (
            <span key={i} class="detail-pop__line">
              {line}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
