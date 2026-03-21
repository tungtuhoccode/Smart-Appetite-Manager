import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

/**
 * Cursor-based typewriter that works with both static and streaming content.
 *
 * - Keeps a character cursor that only moves forward.
 * - When content grows (streaming), the cursor chases the new end.
 * - When content stops growing and the cursor catches up, calls onComplete.
 * - Renders the visible slice through MarkdownRenderer so markdown is always valid.
 */
export function TypewriterText({ content, isStreaming = false, onComplete, charsPerFrame = 8 }) {
  const cursorRef = useRef(0);
  const rafRef = useRef(null);
  const completedRef = useRef(false);
  const [displayed, setDisplayed] = useState("");
  const contentRef = useRef(content);
  contentRef.current = content;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    completedRef.current = false;

    const advance = () => {
      const target = contentRef.current;
      const backlog = target.length - cursorRef.current;

      if (backlog > 0) {
        // Adaptive speed: base rate or 15% of backlog, whichever is larger.
        // Large chunks catch up in ~7 frames (~110ms), small ones trickle smoothly.
        const speed = Math.max(charsPerFrame, backlog * 0.15);
        cursorRef.current = Math.min(cursorRef.current + speed, target.length);
        const rawPos = Math.floor(cursorRef.current);
        // Snap to last newline so we only render complete markdown lines
        if (rawPos < target.length) {
          const safePos = target.lastIndexOf("\n", rawPos);
          setDisplayed(target.slice(0, safePos > 0 ? safePos : rawPos));
        } else {
          setDisplayed(target.slice(0, rawPos));
        }
      }

      // Done when: not streaming, cursor caught up, and content is non-empty
      if (!isStreaming && cursorRef.current >= target.length && target.length > 0) {
        if (!completedRef.current) {
          completedRef.current = true;
          setDisplayed(target);
          onCompleteRef.current?.();
        }
        return; // stop loop
      }

      rafRef.current = requestAnimationFrame(advance);
    };

    rafRef.current = requestAnimationFrame(advance);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isStreaming, charsPerFrame]);

  return <MarkdownRenderer content={displayed} />;
}
