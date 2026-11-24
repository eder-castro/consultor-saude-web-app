---
name: Declared daily water totals
description: Meaning of a user's claimed water goal or explicit daily total compared with recorded drinks.
---

A statement that the daily hydration goal was reached means a declared accumulated total, not an additional drink. Preserve the individual intake records for history but use the declared total as the baseline when calculating the day; subsequent same-day drinks can increase it. A declaration for an earlier date is a whole-day total and must not accidentally add evening drinks simply because the user sent the message earlier in the current day's clock.

**Why:** Adding 2500 ml to previously recorded glasses overstates consumption, while discarding those rows loses the user's underlying records. Backdated messages have no trustworthy original clock time.

**How to apply:** Keep absolute daily totals distinguishable from incremental drinks through review, persistence, daily summaries, weekly graphs, and analysis. Reject partial or negated goal claims rather than converting them into 2500 ml.

When confirmations of the same account/day overlap, the most recent database write to the declared total wins; the original total's stable import identity and all separate drink rows remain unchanged.

**Why:** A read-before-insert sequence can create two daily totals under concurrency, while deleting drinks or changing the total's identity would make history and confirmed analysis references inconsistent.

**How to apply:** Enforce uniqueness and reconciliation in one database operation, not an application-level read followed by a write. Treat protection against contradictory but valid declarations as a separate product decision.

Explicit historical corrections use a different conflict rule from new chat declarations: editing or deleting a reviewed total should fail if that saved amount changed since it was shown.

**Why:** A historical correction targets a value the person inspected; silently applying it to a newer confirmation could remove or overwrite the wrong decision. A new chat declaration instead reconciles the current total.

**How to apply:** For history actions, match the authenticated owner, day, stable total identity, and expected previous quantity atomically. Keep ordinary drink rows outside the mutation.