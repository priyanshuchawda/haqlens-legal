# Challenge alignment

HaqLens Legal is an evidence-first assistant for Indian legal-information preparation. This matrix
maps the challenge expectations to the shipped implementation and its verification evidence.

| Challenge direction                                       | Shipped behavior                                                               | Evidence                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Simplify complex legal documents                          | Cited document brief with source-preserving excerpts                           | `POST /v1/briefs/document`, brief contract tests, web brief panel |
| Compare contracts, agreements, or policies                | Deterministic source-scoped comparison of two documents                        | `POST /v1/comparisons/document`, comparison tests and UI          |
| Highlight clauses, obligations, risks, or inconsistencies | Fact review, uncertainty states, safe route outcomes, and brief risk items     | `core` routing rules, extraction contracts, fact review UI        |
| Answer document questions                                 | Grounded answers only when an exact submitted segment can support them         | `POST /v1/questions/document`, citation parser and refusal tests  |
| Explain options and next steps                            | Proof-to-path routing with missing-fact and human-review outcomes              | `POST /v1/routes/prepare`, deterministic core tests               |
| Generate summaries, checklists, and actionable output     | Briefs, confirmed date checks, redacted preparation packet, and official links | Brief/date/packet/source routes and E2E coverage                  |
| Prepare for a legal professional                          | Evidence-linked packet and professional-question brief items                   | Local redaction module, export flow, source citations             |
| Dynamic assistant behavior                                | Context changes route, confidence, missing facts, and safe-mode state          | 137 unit/API/component tests and 11 browser scenarios             |

## Decision model

The system separates model interpretation from decisions that must be reproducible:

1. Evidence is normalized, bounded, segmented, and assigned stable source IDs.
2. Optional Gemini extraction returns strict structured candidates with provenance.
3. Deterministic rules resolve missing facts, conflicting facts, urgent safety, and supported scope.
4. Comparison, date arithmetic, redaction, and citation checks remain ordinary code.
5. The UI requires review before using transcriptions or exporting a packet.

This gives the assistant practical context sensitivity without allowing a model to invent a route,
law, citation, date, or confirmed transcription.

## Efficiency evidence

- Deterministic work runs locally without a model call.
- Requests and provider payloads are bounded before parsing or forwarding.
- No document persistence, analytics pipeline, or database is required.
- The browser sends evidence-bearing requests with `no-store` semantics.
- Failure paths return safe, small envelopes instead of retrying unboundedly.

## Verification evidence

- 137 tests and 315 assertions across contracts, core logic, API policy, adapters, document safety,
  and browser parsers.
- 11 Chromium end-to-end scenarios.
- 2 axe accessibility scenarios.
- Type-check, lint, dependency audit, secret scan, OpenAPI validation, API/web builds, and diff check.
- GitHub Actions repeats the verification and build gate for pull requests and `main` pushes.
