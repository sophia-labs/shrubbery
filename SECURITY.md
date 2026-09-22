# Security Policy

Shrubbery is a pure RDF→UI interpreter and component library, pre-release
and under active development.

## Supported Versions

Only the current development branch (`main`) is supported. No release
channel or versioned package publishing exists yet.

## Reporting

**Report security issues privately to:** <vera@sophia-labs.com>

Do not open a public issue for a suspected vulnerability. Email the address
above and allow a reasonable window for triage and a fix before any public
disclosure.

Include:

- the affected package, app, or file path;
- reproduction steps from a fresh checkout when possible;
- whether the issue affects the render pipeline, the `TripleSource`/backend
  contract seam (`packages/nucleus/src/contract.ts`), a live `gardend` cell
  connection, or the composite action / CI behavior (`action.yml`);
- logs or fixtures with secrets, tokens, and local file contents redacted.
