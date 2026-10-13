export const codeNotes = {
  id: "code-notes",
  apiVersion: 1,
  mount({ root, signal, onCleanup }) {
    for (const pre of root.querySelectorAll("pre[data-code-note]")) {
      const note = document.createElement("details");
      note.dataset.icarusFeature = "code-notes";
      const summary = document.createElement("summary");
      summary.textContent = "代码说明";
      const body = document.createElement("p");
      body.textContent = pre.dataset.codeNote;
      note.append(summary, body);
      pre.after(note);
      onCleanup(() => note.remove());
      // Listener is intentionally lifecycle owned; repeated mounts cannot stack it.
      note.addEventListener(
        "toggle",
        () => {
          note.dataset.expanded = String(note.open);
        },
        { signal },
      );
    }
  },
};

export default codeNotes;
