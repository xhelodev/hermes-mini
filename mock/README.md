# Hermes Agent mock gateway (v0.21.6)

Node mock of the Hermes Agent API server and a MarkItDown-style document converter for Android APK QA. Deploy the `mock/` directory to Vercel (set **Root Directory** to `mock`) or run locally.

## Quick start

```bash
cd mock
npm install
npm start          # http://localhost:8642
npm test
```

**API key (Bearer):** `mock-test-key`

```bash
export HERMES_MOCK_KEY=mock-test-key
curl -s http://localhost:8642/health
curl -s -H "Authorization: Bearer $HERMES_MOCK_KEY" http://localhost:8642/v1/models
```

## Hermes gateway surface

| Area | Behavior |
| --- | --- |
| Auth | `Authorization: Bearer mock-test-key` on all routes except `GET /health` |
| Health | `GET /health` → `200` `{"status":"ok"}` (no auth) |
| Models | `GET /v1/models` → only `hermes-agent`; `GET /api/model/options` → provider/model picker JSON |
| Chat | `POST /v1/chat/completions` OpenAI-compatible; `stream: true` → SSE `chat.completion.chunk` then `data: [DONE]`; `: keepalive` every 10s |
| Model routing | Request `model` is honored only when `provider` is also sent; response includes `runtime: { provider, model, ... }` |
| Content | Multimodal parts: only `image_url` (`http(s)` or `data:image/*`); `file`, `input_file`, non-image data URLs → `400` `unsupported_content_type` |
| Limits | JSON bodies > 10 MB → `413`; no upload endpoint; >10 concurrent agent runs → `429` |
| Sessions | `GET/POST /api/sessions`, `GET/PATCH/DELETE /api/sessions/{id}` (PATCH accepts `title`, `pinned`, `archived`; archived sessions are left out of the list unless pinned), `GET .../messages` (`order=oldest|latest`, anything else → `400` `invalid_pagination`), `POST .../chat` and `.../chat/stream` (`assistant.delta`, `run.completed` / `run.failed` / `run.cancelled`, then `done`) |
| Runs | `POST /v1/runs` + `Idempotency-Key` (replays with `Idempotency-Replayed: true`), `GET /v1/runs/{id}`, `GET .../events`, `POST .../stop` |

### Gateway fault injection

Query `?fault=` or header `X-Mock-Fault`:

| Value | Effect |
| --- | --- |
| `401` | Unauthorized |
| `down` | `503` |
| `timeout` | Hang (no response) |
| `cut` | Abort mid-stream (streaming chat) |
| `agenterror` | Session chat stream sends `error` then `done`, without `run.failed` (agent crash) |
| `toolarge` | `413` |
| `busy` | `429` |
| `modeloptions:<json>` | Replace `GET /api/model/options` payload (URL-encoded JSON after prefix) |

## Document converter (`POST /convert`)

MarkItDown-like mock for attachment pipelines.

- **Auth:** `Authorization: Bearer mock-test-key` required. Missing token → `401` with a clear message; wrong key → `401` `Invalid API key`.
- **Request:** `multipart/form-data` with a `file` field.
- **Success:** `200` `{"markdown":"..."}` with canned markdown per type.
- **Supported fixtures:** `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.txt` (by extension or common MIME).
- **413:** Total upload over **25 MB** (via `Content-Length` or streamed size).
- **415:** Unsupported types (e.g. `video/mp4`, unknown extensions) with `error.code: unsupported_media_type` and a message listing supported types.

### Converter fault injection

Same `?fault=` / `X-Mock-Fault` mechanism (checked after auth):

| Value | Effect |
| --- | --- |
| `scanned` | For PDF uploads → `422` `{"error":"no_text"}` (simulates a scan with no extractable text) |
| `down` | `503` service unavailable |
| `down-close` or `down:close` | Closes the connection without a JSON body |
| `timeout` | Hang (no response) |

Example:

```bash
curl -s -X POST "http://localhost:8642/convert" \
  -H "Authorization: Bearer mock-test-key" \
  -F "file=@report.pdf;type=application/pdf"

curl -s -X POST "http://localhost:8642/convert?fault=scanned" \
  -H "Authorization: Bearer mock-test-key" \
  -F "file=@scan.pdf;type=application/pdf"
```

## Vercel

1. Import the repo and set **Root Directory** to `mock`.
2. Framework preset: Other; build runs `npm test` then deploys `api/index.mjs` with rewrites to route all paths to the handler.
3. Use the preview URL as the gateway base (same paths as local).

## QA checklist

- [ ] Health without auth
- [ ] Models + model options with auth
- [ ] Chat sync + stream keepalives
- [ ] Session CRUD + chat/stream
- [ ] Runs idempotency + events
- [ ] Converter happy path per file type
- [ ] Converter `401` / `415` / `413` / `scanned` / `down` / `timeout`
- [ ] Gateway fault headers for regression tests

State is in-memory (per server instance); not durable across cold starts on Vercel.
