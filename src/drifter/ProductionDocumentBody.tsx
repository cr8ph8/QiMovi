import type { ReactNode } from 'react';

// A small, text-only reader for our own generated documents. Never interpret
// imported document text as HTML, executable links or embedded media.
export default function ProductionDocumentBody({ body }: { body: string }) {
  const lines = body.split(/\r?\n/), blocks: ReactNode[] = [];
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (line.trim().startsWith('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const headings = cells(line), rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      blocks.push(<div className="production-document-table" key={i}><table><thead><tr>{headings.map((cell, index) => <th scope="col" key={index}>{cell}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{headings.map((_, column) => <td key={column}>{row[column] ?? ''}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^#{1,4} /.test(line)) {
      const level = line.indexOf(' '), text = line.slice(level + 1);
      blocks.push(level < 3 ? <h4 key={i}>{text}</h4> : <h5 key={i}>{text}</h5>);
    } else blocks.push(<p key={i}>{line}</p>);
  }
  return <div className="production-document-body">{blocks}</div>;
}
