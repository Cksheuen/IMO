---
name: brainstorm
description: Turns unclear building requests into an evidence-backed first step. Use for a vague goal, work across several modules, or choosing a technology or architecture; skip clear, small changes.
---

# Brainstorm

Describe one real scenario: input -> what changes -> what the user sees.
Add a counter-example that only looks like success. Choose the smallest slice
through the real entry point and actual dependencies to a real user before
widening across modules.

Read dependency source in `node_modules/` or the package repository rather
than guessing its behavior. Answer what you can investigate yourself; ask
only questions that change the result. If the user asked to discuss first,
do not build until they say so. Changes to rules, skills, memory or config
require user confirmation.

Output: goal as understood; evidence (paths and sources); options with a
recommendation; first slice; what is left out; risks. Mark findings **source
says** (location), **we infer**, or **not checked**.

Example input: "Add offline notes."
Output: "Type a note offline -> store it -> reload and see the same note.
Many passing unit tests alone do not prove this. Source says: src/save.ts
calls the network. We infer: local persistence is the first slice; choose
between the existing store and a new database after checking their source.
Start with one note through the real editor and reload; leave sync conflicts
out. Not checked: storage eviction behavior."
