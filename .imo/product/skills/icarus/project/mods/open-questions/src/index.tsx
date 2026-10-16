import React, { useState } from "react";
import {
  reactMod,
  type ViewProps,
} from "../../../packages/david-shared/src/mod";
import {
  OpenQuestionsPanel,
  useResolvedQuestions,
} from "@david/components/open-questions/index";
import { assertOpenQuestions } from "@david/lib/openQuestionModel";
function View({ data, context }: ViewProps) {
  const [open, setOpen] = useState(false);
  const state = useResolvedQuestions("icarus-" + context.documentId);
  return (
    <section>
      <button onClick={() => setOpen(true)}>待确认项</button>
      <OpenQuestionsPanel
        open={open}
        onClose={() => setOpen(false)}
        questions={data.questions}
        resolvedIds={state.resolvedIds}
        onToggleResolved={state.setQuestionResolved}
      />
    </section>
  );
}
export default reactMod("open-questions", View, (data) => {
  assertOpenQuestions(data.questions, "open-questions");
  return data;
});
