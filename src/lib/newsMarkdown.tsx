import { ReactNode } from "react";

function renderInline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, j) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyBase}-${j}`} className="text-foreground font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyBase}-${j}`}>{part}</span>;
  });
}

export function renderNewsMarkdown(text: string) {
  const lines = text.split("\n");
  const blocks: JSX.Element[] = [];
  let buffer: string[] = [];
  let listBuffer: string[] = [];

  const flushParagraph = () => {
    if (buffer.length === 0) return;
    const joined = buffer.join(" ").trim();
    if (joined) {
      blocks.push(
        <p
          key={`p-${blocks.length}`}
          className="mb-4 leading-relaxed text-foreground/85"
        >
          {renderInline(joined, `p-${blocks.length}`)}
        </p>
      );
    }
    buffer = [];
  };

  const flushList = () => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul
        key={`ul-${blocks.length}`}
        className="mb-4 space-y-1.5 list-disc pl-5 text-foreground/85"
      >
        {listBuffer.map((item, idx) => (
          <li key={idx} className="leading-relaxed">
            {renderInline(item, `li-${blocks.length}-${idx}`)}
          </li>
        ))}
      </ul>
    );
    listBuffer = [];
  };

  lines.forEach((rawLine, i) => {
    const line = rawLine.trimEnd();
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(
        <h2
          key={`h2-${i}`}
          className="font-display text-xl md:text-2xl font-bold mt-8 mb-3"
        >
          {renderInline(line.slice(3), `h2-${i}`)}
        </h2>
      );
    } else if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      blocks.push(
        <h3
          key={`h3-${i}`}
          className="font-display text-base font-semibold mt-5 mb-2"
        >
          {renderInline(line.slice(4), `h3-${i}`)}
        </h3>
      );
    } else if (line.startsWith("- ")) {
      flushParagraph();
      listBuffer.push(line.slice(2));
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else {
      flushList();
      buffer.push(line);
    }
  });
  flushParagraph();
  flushList();

  return <>{blocks}</>;
}
