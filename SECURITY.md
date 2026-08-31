# Security Policy

## Reporting a vulnerability

Email **hello@rominur.com** with the details. Please do not open a public issue for a security
report.

Include the browser and version, the steps to reproduce, and the impact you believe it has.
You can expect an acknowledgement within a few days.

## Scope

EditPDF is a static client-side application. There is no backend, no database, no authentication
and no user data at rest, so the usual server-side classes of vulnerability do not apply.

Reports that are in scope:

- **A document leaving the device.** Any path by which file content reaches the network is the
  most serious issue this project can have. Report it as such.
- **Redaction that does not destroy content.** If redacted text can be recovered from an exported
  file, that is a security bug, not a cosmetic one.
- **Password protection that does not hold**, or permissions that are not applied.
- Cross-site scripting through crafted PDF content, or anything that escapes the page sandbox.
- A supply-chain issue in a bundled dependency.

Out of scope: the deliberate trade-offs documented in the README (device memory limits, conversion
fidelity, font substitution), and anything requiring an attacker to already control the user's
machine or browser.
