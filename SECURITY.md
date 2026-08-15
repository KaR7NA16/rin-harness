# Security Policy

Thank you for helping keep rin-harness and its users safe. This document explains
how to report security issues and what you can expect after you do.

> rin-harness is pre-1.0 developer-preview software. Only the latest release line
> receives security updates.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1.0 | :x:                |

Security fixes are released on the 0.1.x line. No security-backport promise
applies to development snapshots from before the first tagged release.

## Reporting a Vulnerability

**Do not open a public issue for a security vulnerability.** Report it privately
so it can be fixed before it is disclosed.

### Preferred: GitHub Security Advisory

1. Open the repository at <https://github.com/your-name/rin-harness>.
2. Go to the **Security** tab, then **Advisories -> New draft security advisory**
   (or **Report a vulnerability**).
3. Describe the affected version(s), the impact, and steps to reproduce where
   possible, and submit.

The advisory stays private until a fix is published and the advisory is published.

### Alternative: email

If you cannot use GitHub, email **security@your-domain.example**
(placeholder - replace with the maintainers' address before release). Include:

- affected version(s);
- a description of the vulnerability and its impact;
- steps to reproduce or a proof of concept;
- any suggested fix or workaround.

### What to expect

| Timeline              | Action |
| --------------------- | ------ |
| Within 3 business days | We acknowledge your report and confirm the affected scope. |
| Within 30 days        | We aim to ship a fix, or agree a coordinated disclosure timeline, for confirmed issues. |

We will keep you updated on progress, credit you in the advisory unless you ask to
remain anonymous, and not pursue legal action against responsible disclosure. If
we cannot reproduce a report we will tell you and ask for more detail. Please give
us a reasonable window (we ask for 90 days) before disclosing publicly.

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
