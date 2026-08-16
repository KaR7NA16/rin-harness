# @rin/provider-probe

Provider connectivity test and model-list discovery exposed as ctx.providerProbe.

Ported from cyberpsychosis providerModelDiscovery and providerService.testConnectivity.
The probe is a direct upstream HTTP call (no Anthropic-to-OpenAI proxy-transform pipeline),
so it stays cordis-free (global fetch + AbortSignal only).

## API

- test(input) — direct upstream connectivity test per distinct model, returning
  { connectivity, modelChecks, allModelsPassed }.
- discover(input) — read a provider model list from its model-list endpoint
  (/models, Ollama /api/tags, LM Studio /api/v1/models), with a 5-minute cache.

## Known Limitations and Deferred Work

- The Anthropic-to-OpenAI proxy-transform pipeline (test step 2) and the image-capability
  probe are not ported; test() reports connectivity + per-model checks only.
