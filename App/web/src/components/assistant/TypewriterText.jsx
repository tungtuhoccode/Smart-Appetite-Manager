import { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

/**
 * Renders text with a chunked streaming animation (like Claude's chat).
 * Reveals multiple words per tick for a natural, fast feel.
 */
export function TypewriterText({ content, onComplete, chunkSize = 3, tickDelay = 30 }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [done, setDone] = useState(false);
  const wordsRef = useRef([]);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    wordsRef.current = content.split(/(\s+)/);
    const total = wordsRef.current.length;

    if (total === 0) {
      setDone(true);
      return;
    }

    setVisibleCount(0);
    setDone(false);

    let i = 0;
    const interval = setInterval(() => {
      i = Math.min(i + chunkSize, total);
      setVisibleCount(i);
      if (i >= total) {
        clearInterval(interval);
        setDone(true);
        onCompleteRef.current?.();
      }
    }, tickDelay);

    return () => clearInterval(interval);
  }, [content, chunkSize, tickDelay]);

  if (done) {
    return <MarkdownRenderer content={content} />;
  }

  const partial = wordsRef.current.slice(0, visibleCount).join("");
  return <MarkdownRenderer content={partial} />;
}
