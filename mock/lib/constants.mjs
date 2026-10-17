export const MOCK_API_KEY = 'mock-test-key';
export const VIRTUAL_MODEL = 'hermes-agent';
export const MAX_CHAT_BODY_BYTES = 10 * 1024 * 1024;
export const MAX_CONVERT_BODY_BYTES = 25 * 1024 * 1024;
export const MAX_CONCURRENT_RUNS = 10;
export const KEEPALIVE_INTERVAL_MS = 10_000;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MODEL_OPTIONS = {
  providers: [
    {
      id: 'openai',
      label: 'OpenAI',
      models: [
        {
          id: 'gpt-4o',
          label: 'GPT-4o',
          capabilities: { vision: true, tools: true },
          pricing: { input_per_mtok: 2.5, output_per_mtok: 10 },
        },
      ],
    },
    {
      id: 'anthropic',
      label: 'Anthropic',
      models: [
        {
          id: 'claude-sonnet-4-20250514',
          label: 'Claude Sonnet 4',
          capabilities: { vision: true, tools: true },
          pricing: { input_per_mtok: 3, output_per_mtok: 15 },
        },
      ],
    },
  ],
};

export const CONVERT_FIXTURES = {
  pdf: '# Quarterly report\n\nCanned **PDF** markdown from the mock converter.\n',
  docx: '# Document\n\nCanned **DOCX** markdown from the mock converter.\n',
  xlsx: '# Spreadsheet\n\n| Col A | Col B |\n| --- | --- |\n| 1 | 2 |\n\n_Canned XLSX fixture._\n',
  pptx: '# Slides\n\n- Slide 1: intro\n- Slide 2: details\n\n_Canned PPTX fixture._\n',
  txt: 'Plain text file converted to markdown.\n',
};

export const CONVERT_SUPPORTED_EXT = new Set(Object.keys(CONVERT_FIXTURES));

// Como GET /v1/capabilities de Hermes, pero con lo que este mock tiene de verdad: sin
// /model, /fork, skills, toolsets ni jobs.
const MOCK_ENDPOINTS = {
  health: ['GET', '/health'],
  models: ['GET', '/v1/models'],
  model_options: ['GET', '/api/model/options'],
  chat_completions: ['POST', '/v1/chat/completions'],
  runs: ['POST', '/v1/runs'],
  run_status: ['GET', '/v1/runs/{run_id}'],
  run_events: ['GET', '/v1/runs/{run_id}/events'],
  run_steer: ['POST', '/v1/runs/{run_id}/steer'],
  run_stop: ['POST', '/v1/runs/{run_id}/stop'],
  sessions: ['GET', '/api/sessions'],
  session_create: ['POST', '/api/sessions'],
  session: ['GET', '/api/sessions/{session_id}'],
  session_update: ['PATCH', '/api/sessions/{session_id}'],
  session_delete: ['DELETE', '/api/sessions/{session_id}'],
  session_messages: ['GET', '/api/sessions/{session_id}/messages'],
  session_chat: ['POST', '/api/sessions/{session_id}/chat'],
  session_chat_stream: ['POST', '/api/sessions/{session_id}/chat/stream'],
};

export const MOCK_CAPABILITIES = {
  object: 'hermes.api_server.capabilities',
  platform: 'hermes-agent',
  model: VIRTUAL_MODEL,
  auth: { type: 'bearer', required: true },
  features: {
    chat_completions: true,
    chat_completions_streaming: true,
    responses_api: false,
    run_submission: true,
    runs_idempotency: { supported: true, durable: false, retention_seconds: 86400 },
    run_status: true,
    run_events_sse: true,
    run_stop: true,
    run_steer: true,
    run_approval_response: false,
    session_chat: true,
    session_chat_streaming: true,
    session_fork: false,
    session_model_lock: false,
    model_options: true,
    skills_api: false,
  },
  endpoints: Object.fromEntries(
    Object.entries(MOCK_ENDPOINTS).map(([name, [method, path]]) => [name, { method, path }]),
  ),
};
