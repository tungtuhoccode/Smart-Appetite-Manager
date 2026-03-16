import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { StoreMap } from "@/components/shopping/StoreMap";

function tryParseMapData(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.stores)) {
      return parsed;
    }
  } catch {
    // not valid JSON
  }
  return null;
}

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
        rehypePlugins={[rehypeRaw]}
        components={{
          details: ({ children, ...props }) => (
            <details
              className="my-2 rounded-md border bg-muted/30 open:bg-transparent"
              {...props}
            >
              {children}
            </details>
          ),
          summary: ({ children, ...props }) => (
            <summary
              className="cursor-pointer select-none px-3 py-2 text-sm font-medium hover:bg-muted/50 rounded-md"
              {...props}
            >
              {children}
            </summary>
          ),
          p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1">{children}</ol>,
          li: ({ children }) => <li>{children}</li>,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-md border">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
          th: ({ children }) => <th className="px-2 py-1.5 text-left font-semibold whitespace-nowrap border-b">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 border-b whitespace-nowrap">{children}</td>,
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
          pre: ({ children }) => {
            const codeChild = React.Children.toArray(children).find(
              (c) => React.isValidElement(c) && c.props?.className
            );
            if (codeChild) {
              const lang = codeChild.props.className || "";
              if (lang.includes("language-shopper_map_data")) {
                const raw = String(codeChild.props.children || "").trim();
                const mapData = tryParseMapData(raw);
                if (mapData && mapData.stores.length > 0) {
                  return <StoreMap mapData={mapData} height="300px" className="my-3" />;
                }
              }
            }
            return <pre className="overflow-x-auto rounded-md bg-muted p-2 text-[12px] my-2">{children}</pre>;
          },
          code: ({ inline, className, children }) =>
            inline ? (
              <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{children}</code>
            ) : (
              <code className={className}>{children}</code>
            ),
          img: ({ src, alt }) => (
            <img
              src={src}
              alt={alt || "Markdown image"}
              className="rounded-md border object-contain bg-gray-50"
              style={{ width: 140, maxHeight: 120 }}
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
