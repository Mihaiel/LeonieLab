# Security Policy

## Scope

LeonieLab is a fully client-side application. It has no backend, no user accounts,
no database, and no network requests beyond loading static files. The attack surface
is therefore narrow, but unsafe DOM manipulation and other issues are still in scope.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report them privately by:

1. Going to the repository's **Security** tab on GitHub and using
   [Private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability), or
2. Contacting the maintainer **Mihaiel Birta** directly via the email address listed on their
   GitHub profile.

Please include:
- A clear description of the vulnerability
- Steps to reproduce it
- The potential impact
- Any suggested fix, if you have one

You can expect an acknowledgement within **48 hours** and a resolution or status
update within **14 days**.

## Supported Versions

Only the latest commit on the `main` branch is actively maintained.