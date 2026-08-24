# @rin/workspace

The workspace domain combines environment planning, filesystem access, agent
definitions, plugin configuration, and sandbox execution. These modules share
one repository-to-execution lifecycle while retaining explicit subpath APIs and
independent Cordis configuration.

## Public modules

- `@rin/workspace/environment`
- `@rin/workspace/filesystem`
- `@rin/workspace/agents`
- `@rin/workspace/plugins`
- `@rin/workspace/sandboxes`

Detailed behavior and model-facing effects are documented under `docs/`.

## Known Limitations and Deferred Work

- Container and remote execution providers still require platform-specific
  runtime validation; package aggregation does not prove those providers.
