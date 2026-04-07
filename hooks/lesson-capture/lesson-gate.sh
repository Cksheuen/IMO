#!/bin/bash
# DEPRECATED: lesson-gate is no longer part of the default Stop hook chain.
#
# Previous behavior:
# - Read lesson-signals.json during Stop
# - Block stop when unhandled lesson signals existed
# - Force immediate lesson capture
#
# Current behavior (since 2026-04-03):
# - Lesson capture is triggered explicitly via the `lesson-review` skill
# - Review scope is limited to signals with `handled != true`
# - Default Stop hooks no longer block on lesson signals
#
# This shim intentionally does nothing, so stale references or accidental manual
# invocations do not re-enable the old background loop. Use `/lesson-review`
# instead.


exit 0
