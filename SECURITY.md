# Security and privacy

HaqLens Legal is designed for sensitive legal-information preparation. The default configuration keeps provider access server-side, avoids persistence, and treats uploaded material as user-controlled data.

## Current controls

- JSON request bodies are bounded and validated with strict schemas.
- Transcription payloads have a separate 10 MiB limit.
- Uploads are classified by content signatures and safe UTF-8 decoding, not filename alone.
- Evidence-bearing responses use `Cache-Control: no-store`.
- Gemini is opt-in and the API key is never exposed to the browser.
- Transcription is unconfirmed until the user checks it against the original.
- The local secret scanner runs as part of the verification workflow.
- The application does not persist documents, results, accounts, or analytics data.

## Reporting

Do not publish sensitive evidence in an issue. For a suspected vulnerability, preserve the smallest reproducible example and contact the project owner privately before disclosure.

## Deployment boundary

The in-memory peer limit is suitable for local and single-process use. A public multi-instance deployment must add a reviewed trusted-proxy identity and distributed rate-limit design before handling real documents.
