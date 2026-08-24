# @rin/authoring

@rin/authoring groups the two LLM-facing authoring capabilities that share
the same dsh tools/commands and llm seam:

- brief: produces a structured markdown session brief.
- review: reviews an artifact through the general or security lens.

The implementations remain isolated in src/brief/ and src/review/. The package
root exports their public core APIs with explicit brief/review aliases where
both modules use the same symbol name.

## Registration

The aggregate Cordis plugin is exported as apply(ctx, config). It installs
both capabilities and accepts optional brief and review policy objects.

    import { apply } from '@rin/authoring'

    apply(ctx, { brief: { maxEvents: 120 }, review: { maxResultBytes: 16_384 } })

Individual seam registration is available as registerBriefSeam and
registerReviewSeam when a host needs separate lifecycle control.

## Known Limitations and Deferred Work

- Brief and review require a composed dsh llm service and do not provide a
  local model fallback.
