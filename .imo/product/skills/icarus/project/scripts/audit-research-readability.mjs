import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Authoring gate: a long symbol-heavy plain block needs real structure. */
export function auditReadability(spec) {
  const gaps = [];
  let checked = 0;
  const check = (value, location) => {
    const text = String(value ?? "").replace(/<\/?(?:code|b|strong|mark)>/g, "");
    checked++;
    if (Array.from(text).length > 500 && /[→←=;；{}[\]<>\/|_]/u.test(text))
      gaps.push({ location, length: Array.from(text).length, reason: "超过 500 字且含符号的未分节正文；改为短段、列表、对照表或来源表" });
  };
  const sections = (items, location) => {
    for (const s of items ?? []) {
      check(s.paragraphs?.join("\n"), `${location}/${s.id}/paragraphs`);
      s.items?.forEach((x,i)=>check(x,`${location}/${s.id}/item:${i}`));
      s.table?.rows.forEach((r,i)=>r.forEach((c,j)=>check(typeof c === "string" ? c : c.text,`${location}/${s.id}/row:${i}/cell:${j}`)));
    }
  };
  for (const p of spec.pages ?? []) for (const q of p.questions ?? []) {
    const at = `${p.id}/${q.id}`;
    check(q.answer,`${at}/answer`);
    check(q.readingGuide?.join("\n"),`${at}/readingGuide`);
    sections(q.readingSections,`${at}/readingSections`);
    for (const v of q.graphViews ?? []) {
      check(v.readingGuide?.join("\n"),`${at}/view:${v.id}`);
      sections(v.readingSections,`${at}/view:${v.id}`);
    }
    for (const [id,e] of Object.entries(q.explanations ?? {})) {
      check(e.summary,`${at}/${id}/summary`);
      e.findings?.forEach((x,i)=>check(x,`${at}/${id}/finding:${i}`));
      sections(e.inputSources,`${at}/${id}/inputSources`);
    }
    for (const c of q.codes ?? []) check(c.explanation?.join("\n"),`${at}/code:${c.id}/explanation`);
    q.findings?.forEach((x,i)=>check(x,`${at}/finding:${i}`));
    q.details?.forEach((x,i)=>check(x,`${at}/detail:${i}`));
  }
  return { passed: gaps.length === 0, checked, gaps };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditReadability(JSON.parse(fs.readFileSync(process.argv[2],"utf8")));
  if (process.argv[3]) fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
  if (!report.passed) process.exitCode = 1;
}
