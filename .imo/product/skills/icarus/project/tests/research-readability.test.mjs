import test from "node:test";
import assert from "node:assert/strict";
import { auditReadability } from "../scripts/audit-research-readability.mjs";
test("symbol-heavy prose over 500 characters requires real structure",()=>{
  const q={id:"q",readingGuide:["字段_".repeat(180)]};
  const s={pages:[{id:"p",questions:[q]}]};
  assert.equal(auditReadability(s).passed,false);
  q.readingGuide=[];
  q.readingSections=[{id:"inputs",title:"来源",table:{headers:["字段","来源"],rows:Array.from({length:20},()=>["product_id","getProduct(request.id)"])}}];
  assert.equal(auditReadability(s).passed,true);
  q.readingSections[0].paragraphs=["a_".repeat(251)];
  assert.equal(auditReadability(s).passed,false);
});
