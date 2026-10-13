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
