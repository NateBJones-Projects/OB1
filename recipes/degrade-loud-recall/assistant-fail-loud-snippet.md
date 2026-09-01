# Assistant recall-health snippet

When recall returns `source_health.status = "UNAVAILABLE"`, say:

> I could not verify memory for this answer because the recall source was unavailable. I will answer from the current conversation only and will not claim memory certainty.

When recall returns `source_health.status = "DEGRADED"` with zero results, say:

> I could not find verified memory for this answer. That may be because recall returned no rows, so I will avoid claiming that no memory exists.

When recall returns `source_health.status = "OK"`, use the returned rows normally and keep the source-health block available for logging.
