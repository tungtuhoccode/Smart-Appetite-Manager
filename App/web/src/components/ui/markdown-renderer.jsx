import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function isImageHref(href) {
  if (!href || typeof href !== "string") return false;
  const lower = href.toLowerCase();
  if (/^data:image\//.test(lower)) return true;

  try {
    const url = new URL(href, "http://localhost");
    return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(url.pathname);
  } catch {
    return /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(lower);
  }
}

export function MarkdownRenderer({ content, className = "" }) {
  return (
    <div className={`text-sm leading-relaxed text-foreground break-words ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          a: ({ href, children }) => {
            const showImagePreview = isImageHref(href);
            return (
              <span className={showImagePreview ? "inline-block w-full space-y-2" : undefined}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-orange-700 underline underline-offset-2 hover:text-orange-800"
                >
                  {children}
                </a>
                {showImagePreview ? (
                  <img
                    src={href}
                    alt="Recipe image"
                    className="w-full max-h-56 rounded-md border object-cover"
                    loading="lazy"
                  />
                ) : null}
              </span>
            );
          },
          code: ({ inline, children }) =>
            inline ? (
              <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{children}</code>
            ) : (
              <code className="block overflow-x-auto rounded-md bg-muted p-2 text-[12px]">{children}</code>
            ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt || "Markdown image"}
              className="my-2 w-full rounded-md border object-cover"
              loading="lazy"
            />
          ),
        }}
      >
        {content || ""}
      </ReactMarkdown>
    </div>
  );
}
