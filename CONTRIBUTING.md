# Contributing to Rin

English | [中文](CONTRIBUTING.zh.md)

Thank you for taking an interest in Rin. Rin is a developer-preview runtime for local-first, auditable AI companion systems. The project is still changing quickly, so a useful contribution is one that is small, explicit about its evidence, and easy to review.

## Before changing code

1. Read the [documentation index](docs/README.md), [current architecture](docs/architecture/CURRENT.md), and [active roadmap](docs/roadmap/ACTIVE.md).
2. Confirm the package owner and dependency direction before adding a new import or moving a module.
3. Keep first-party code under apps/ or role-specific directories inside packages/. Do not recreate the removed transition wrapper under rin/.
4. Preserve the distinction between implemented behaviour, planned work, and unverified claims.
5. Update the smallest relevant document, manifest, reference, test, or gate when the change affects a repository contract.

## Local checks

Use the pinned Node.js and pnpm versions from the root package manifest:

~~~sh
pnpm install
pnpm run check
pnpm run smoke
~~~

For focused work, run the narrowest relevant package or test command first, then run pnpm run check before requesting review. Changes to desktop packaging, paths, manifests, generated references, Cordis composition, or CI should include the corresponding evidence.

## Useful contribution areas

- runtime composition, contracts, lifecycle and provider boundaries;
- memory provenance, retrieval, backup, deletion and export;
- Web and desktop accessibility and user-facing controls;
- relationship, consent and companion-safety domains;
- evaluation fixtures, red-team scenarios and reproducible test data;
- documentation, architecture decisions and contributor onboarding;
- provider, MCP and interoperability adapters.

The relationship and safety areas are especially sensitive. Do not claim emotional, clinical, crisis, or production behaviour without a matching implementation and evaluation record.

## Pull requests

A pull request should explain:

- what changed and why;
- which packages, paths, manifests, references or gates are affected;
- how the change was tested;
- what remains unverified or intentionally out of scope.

Avoid mixing a structural migration with an unrelated feature. Preserve provenance when moving files, and do not commit credentials, user data, generated secrets, or local machine paths.

## Issues and security

Use the [issue chooser](https://github.com/KaR7NA16/rin-harness/issues/new/choose)
for bug reports and feature requests. English and Chinese are welcome. The
repository's PR template follows the scope and evidence requirements above.
For security reports or privacy-sensitive material, follow [SECURITY.md](SECURITY.md)
rather than publishing details in an issue. Conduct reporting is described in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

Rin depends on external runtime packages under the @deepseek-ai/* scope. Do not copy or vendor their source into this repository without recording the license and provenance impact in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
