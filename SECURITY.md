# Security Policy

Thank you for helping keep rin-harness and its users safe. This document records
the security boundary for the public [Rin repository](https://github.com/KaR7NA16/rin-harness).

> Rin is pre-1.0 developer-preview software. Public source availability does not
> imply a stable release, production security certification, or support for
> exposing the Host directly to the Internet.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| Current `main` development branch | Best effort |
| Older commits and untagged builds | No backport commitment |

Security support, release branches, and backport promises will be defined before
the first public release.

## Reporting a Vulnerability

**Do not open a public issue for a security vulnerability.** Report it privately
so it can be fixed before it is disclosed.

### Reporting channel

Use GitHub's [private vulnerability report form](https://github.com/KaR7NA16/rin-harness/security/advisories/new).
Private vulnerability reporting is enabled for this repository. Reports are
shared with the repository maintainers through GitHub's security advisory workflow.

In the private report, include:

- affected version(s);
- a description of the vulnerability and its impact;
- steps to reproduce or a proof of concept;
- any suggested fix or workaround.

### What to expect

| Timeline              | Action |
| --------------------- | ------ |
| Within 3 business days | We acknowledge your report and confirm the affected scope. |
| Within 30 days        | We aim to ship a fix, or agree a coordinated disclosure timeline, for confirmed issues. |

We will keep you updated through that private channel, credit you in the eventual
advisory unless you ask to remain anonymous, and not pursue legal action against
responsible disclosure. If we cannot reproduce a report we will ask for more
detail. Please give us a reasonable window before disclosing publicly.

## Security model notes

rin-harness is an agent harness: it runs local tools (shell, filesystem,
subprocess) on your machine, and its web server and desktop app expose those
capabilities locally. Treat it as a local, authenticated development tool:

- Do not bind the web server to a public interface without an authentication and
  authorization layer in front of it.
- Review the repositories, knowledge bases, and environment plans you allow an
  agent to access.
- Report any way to escape path containment, sandboxing, or the web server's
  local-only assumptions as a vulnerability.

## Acknowledgments

We thank everyone who reports security issues responsibly.
