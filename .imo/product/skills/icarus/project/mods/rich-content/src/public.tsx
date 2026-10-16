import { renderRichText } from "@david/lib/richContent/text";
import "./document.css";

export type RichCell = string | { text: string; href: string };
export type RichSection = {
  id: string;
  title: string;
  paragraphs?: string[];
  items?: string[];
  table?: { headers: string[]; rows: RichCell[][] };
};
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim();
const prose = (value: unknown) => value === undefined || (Array.isArray(value) && value.length > 0 && value.every(text));
const safeHref = (value: unknown) => {
  if (!text(value)) return false;
  try {
    const url = new URL(value, "https://icarus.local/");
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
};
export function isValidRichSections(value: unknown): value is RichSection[] {
  if (!Array.isArray(value) || !value.length) return false;
  const ids = new Set<string>();
  return value.every(s => {
    if (!s || !text(s.id) || ids.has(s.id) || !text(s.title) || !prose(s.paragraphs) || !prose(s.items)) return false;
    ids.add(s.id);
    if (s.table !== undefined) {
      const t = s.table;
      if (!t || !Array.isArray(t.headers) || !t.headers.length || !t.headers.every(text) || !Array.isArray(t.rows) || !t.rows.length) return false;
      if (!t.rows.every((r: unknown) => Array.isArray(r) && r.length === t.headers.length && r.every(c => text(c) || (c && text(c.text) && safeHref(c.href))))) return false;
    }
    return !!(s.paragraphs?.length || s.items?.length || s.table);
  });
}

export function RichDocument({ sections, targetPrefix }: { sections: RichSection[]; targetPrefix?: string }) {
  return <div className="icarus-rich-document">
    {sections.map(section => <section key={section.id} className="icarus-document-section"
      data-review-target={targetPrefix ? `${targetPrefix}:${section.id}` : undefined}
      data-review-label={section.title}>
      <h3>{section.title}</h3>
      {section.paragraphs?.map((p, i) => <p key={i}>{renderRichText(p)}</p>)}
      {section.items && <ul>{section.items.map((item, i) => <li key={i}>{renderRichText(item)}</li>)}</ul>}
      {section.table && <div className="icarus-document-table"><table aria-label={section.title}>
        <thead><tr>{section.table.headers.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
        <tbody>{section.table.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>
          {typeof cell === "string" ? renderRichText(cell) : <a href={cell.href} target="_blank" rel="noopener noreferrer">{renderRichText(cell.text)}</a>}
        </td>)}</tr>)}</tbody>
      </table></div>}
    </section>)}
  </div>;
}
