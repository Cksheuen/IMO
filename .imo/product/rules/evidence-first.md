# Evidence First Rule

## Summary

When something breaks — white screen, crash, runtime error, failing test, or
unexpected behavior — read the most complete runtime evidence currently
available, directly relevant to the problem, and sufficient to verify a
hypothesis before forming one: the fullest console error, logs, and network
trace you can obtain. When evidence is incomplete, you may label a hypothesis
and name the gap explicitly, but never present an unverified guess as a
conclusion or edit code on top of it.

This rule exists to suppress the common agent habit of guessing a cause from a
truncated error fragment or from intuition, then "fixing" the wrong layer.

## Trigger

Apply this rule when any of these hold:

- the user reports a white screen, crash, hang, or runtime exception
- a test, build, or command fails unexpectedly
- behavior differs between environments (online vs local proxy, PPE vs prod)
- the error message is truncated or partial in the visible surface
- you are about to propose a cause without having read the underlying error

Also apply it when the user explicitly asks "why is this broken" or similar.
Apply the completion checks below when reporting a fix or feedback item as done.

## Priority

Use this priority order when diagnosing:

```text
explicit user instruction
> repository hard rules / specs
> runtime evidence (full console error, logs, network trace)
> local code evidence
> hypothesis (must be verified against evidence, never acted on directly)
```

A hypothesis that has not been checked against runtime evidence is not a
conclusion. State it as a guess and verify it before changing code.

## Required Local Evidence

Before proposing a cause, gather the most complete evidence currently
available that is directly relevant to the failure and sufficient to verify a
hypothesis:

- What is the fullest error message and stack available? (A truncated fragment
  like `snapshotPa...` is weak evidence — fetch more complete console output
  if it is accessible.)
- Which network requests fired, and which did not? (A missing request is often
  the real cause, not a rendering bug.)
- What differs between the working path (online) and the broken path (local
  proxy, PPE, different device)? Entry params, uncommitted changes, port
  services, container params.
- Is there a prior write-up of the same symptom in project notes, e2e
  anchors, or history? Check before re-deriving.
- Is this a code problem or an environment problem (dev server not started,
  port occupied, sandbox write restriction, missing container params)?

If some of this evidence cannot be obtained, name the gap explicitly and mark
any claim that depends on it as a hypothesis.

## Habits To Suppress

Suppress these habits unless evidence or the user explicitly requires them:

- guessing a root cause from a truncated or partial error fragment
- proposing a fix before reading the full console error or log
- treating a rendering symptom as a rendering bug without checking whether
  the data request even fired
- skipping the "compare working vs broken" step when environments differ
- re-deriving a root cause that is already recorded in project notes or e2e
  anchors
- editing code to test a hypothesis that could be confirmed by reading a log
- hiding an environment problem (port, permission, sandbox) as a code fix

## Implementation Behavior

When diagnosing:

1. Read the fullest console / JSRuntime error and stack currently available.
2. Check the network trace: which requests fired, which returned errors, which
   never fired.
3. Diff the working path against the broken path (params, uncommitted changes,
   services, container args).
4. Search project notes, e2e anchors, and history for the same symptom.
5. Form a hypothesis only after the above; label it as a hypothesis, name any
   evidence gaps, and verify it against evidence before changing code.
6. Keep the fix scoped to the verified cause; do not bundle unrelated cleanup.

Before declaring completion, verify the actual consumer: identify the source,
generated artifact, loaded page/bundle, service process, or device session the
user is using. Local source edits do not prove a running consumer has changed.
Report configuration, startup, test success, live behavior, and human acceptance
as distinct states. Use existing captures when sufficient; if live verification
is unavailable, state the missing evidence instead of claiming end-to-end success.

For a host integration, prove the smallest supported end-to-end operation before
building dependent UI. A healthy local queue or service does not prove a host
agent can receive its message. Reuse or isolate probes so they do not disturb
the user's running service, device session, or manual controls.

## Allowed Exceptions

You may skip straight to a fix only when at least one is true:

- the user explicitly instructs a direct change without diagnosis
- the error message unambiguously identifies the root cause and location
- the failure is a known, previously documented issue with an established fix

When skipping diagnosis, state that you are doing so and why.

## Review Questions

Before reporting a diagnosis, ask:

- Did I read the most complete error evidence currently available, not just
  the visible fragment?
- Did I check whether the relevant network request actually fired?
- Did I compare the working and broken environments, or assume they are equal?
- Did I check project notes / e2e anchors for an existing write-up?
- Is my proposed cause verified against evidence, or explicitly labeled as a
  hypothesis with its gaps named?
- Did I keep the fix scoped to the verified cause?

If any answer exposes a gap, return to evidence gathering before concluding;
if the gap cannot be closed, report the hypothesis and the missing evidence
instead of a conclusion.

## Non-Goals

- This rule does not replace a full root-cause analysis; it enforces the
  evidence-gathering that must precede one.
- It does not forbid hypotheses — it forbids acting on unverified ones.
- It does not apply to greenfield feature work where nothing is broken.
- It does not override explicit user instructions to skip diagnosis.
