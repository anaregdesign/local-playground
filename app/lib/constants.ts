/**
 * Impact scope:
 * These constants are shared by Azure ARM discovery and Azure OpenAI auth logic.
 * Changing them affects project/deployment discovery and token acquisition behavior.
 */
export const AZURE_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
export const AZURE_ARM_SCOPE = "https://management.azure.com/.default";
export const AZURE_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
export const AZURE_SUBSCRIPTIONS_API_VERSION = "2022-12-01";
export const AZURE_COGNITIVE_API_VERSION = "2024-10-01";
export const AZURE_OPENAI_DEFAULT_API_VERSION = "v1";
export const AZURE_ACCESS_TOKEN_REFRESH_BUFFER_MS = 30_000;
export const AZURE_MAX_SUBSCRIPTIONS = 64;
export const AZURE_MAX_ACCOUNTS_PER_SUBSCRIPTION = 256;
export const AZURE_MAX_DEPLOYMENTS_PER_ACCOUNT = 256;
export const AZURE_MAX_MODELS_PER_ACCOUNT = 512;

/**
 * Impact scope:
 * These constants control shared storage locations.
 * Changing them affects where SQLite data is stored.
 */
export const FOUNDRY_LEGACY_CONFIG_DIRECTORY_NAME = ".foundry_local_playground";
export const FOUNDRY_WINDOWS_CONFIG_DIRECTORY_NAME = "FoundryLocalPlayground";
export const FOUNDRY_SQLITE_DATABASE_FILE_NAME = "local-playground.sqlite";
export const FOUNDRY_SKILLS_DIRECTORY_NAME = "skills";

/**
 * Impact scope:
 * These constants are shared across chat runtime validation and home UI validation.
 * Changing them affects what requests are accepted and what values users can set.
 */
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;
export const CHAT_MAX_MCP_SERVERS = 8;
export const CHAT_MAX_AGENT_INSTRUCTION_LENGTH = 4000;
export const CHAT_ATTACHMENT_MAX_FILES = 5;
export const CHAT_ATTACHMENT_MAX_PDF_FILE_SIZE_BYTES = 50 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_PDF_TOTAL_SIZE_BYTES = 50 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_NON_PDF_FILE_SIZE_BYTES = 512 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES =
  CHAT_ATTACHMENT_MAX_NON_PDF_FILE_SIZE_BYTES * CHAT_ATTACHMENT_MAX_FILES;
export const CHAT_ATTACHMENT_MAX_FILE_NAME_LENGTH = 128;
export const CHAT_MODEL_RUN_TIMEOUT_MS = 120_000;
export const CHAT_CLEANUP_TIMEOUT_MS = 5_000;
export const CHAT_MAX_RUN_TURNS = 64;
export const CHAT_MAX_CONSECUTIVE_IDENTICAL_SKILL_OPERATIONS = 8;
export const CHAT_MAX_SKILL_OPERATION_CALLS_PER_SERVER_METHOD = 24;
export const CHAT_MAX_SKILL_RUN_SCRIPT_CALLS_PER_SERVER_METHOD = Math.floor(
  CHAT_MAX_RUN_TURNS * 0.75,
);
export const CHAT_MAX_IDENTICAL_SKILL_OPERATION_CALLS_PER_SIGNATURE = 1;
export const CHAT_MAX_IDENTICAL_SKILL_RUN_SCRIPT_CALLS_PER_SIGNATURE = 2;
export const CHAT_MAX_SKILL_OPERATION_ERRORS = 10;
export const CHAT_CODE_INTERPRETER_UPLOAD_TIMEOUT_MS = 30_000;
export const THREAD_ENVIRONMENT_VARIABLES_MAX = 128;
export const THREAD_ENVIRONMENT_KEY_MAX_LENGTH = 128;
export const THREAD_ENVIRONMENT_VALUE_MAX_LENGTH = 16_384;
export const CHAT_ATTACHMENT_ALLOWED_EXTENSIONS = new Set([
  "c",
  "cpp",
  "csv",
  "docx",
  "gif",
  "html",
  "java",
  "jpeg",
  "jpg",
  "js",
  "json",
  "md",
  "pdf",
  "php",
  "pkl",
  "png",
  "pptx",
  "py",
  "rb",
  "tar",
  "tex",
  "txt",
  "xlsx",
  "xml",
  "zip",
]);
export const DEFAULT_AGENT_INSTRUCTION = "You are a concise assistant for a local playground app.";
export const HOME_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high"] as const;
export const HOME_DEFAULT_REASONING_EFFORT = "none" as const;
export const HOME_DEFAULT_UTILITY_REASONING_EFFORT = "high" as const;
export const HOME_DEFAULT_WEB_SEARCH_ENABLED = false;
export const HOME_DEFAULT_MCP_TRANSPORT = "streamable_http" as const;
export const HOME_INITIAL_MESSAGES: ReadonlyArray<never> = [];

/**
 * Impact scope:
 * These constants define Agent Skills discovery and runtime activation limits.
 * Changing them affects SKILL.md validation and chat-time skill loading behavior.
 */
export const AGENT_SKILLS_DIRECTORY_NAME = "skills";
export const AGENT_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const AGENT_SKILL_NAME_MAX_LENGTH = 64;
export const AGENT_SKILL_DESCRIPTION_MAX_LENGTH = 1024;
export const AGENT_SKILL_FILE_MAX_BYTES = 1_000_000;
export const CHAT_MAX_ACTIVE_SKILLS = 24;
export const AGENT_SKILL_SCRIPTS_DIRECTORY_NAME = "scripts";
export const AGENT_SKILL_REFERENCES_DIRECTORY_NAME = "references";
export const AGENT_SKILL_ASSETS_DIRECTORY_NAME = "assets";
export const AGENT_SKILL_RESOURCES_DIRECTORY_NAME = "resources";
export const AGENT_SKILL_RESOURCE_MAX_FILES_PER_DIRECTORY = 200;
export const AGENT_SKILL_RESOURCE_PATH_MAX_LENGTH = 512;
export const AGENT_SKILL_PROMPT_RESOURCE_PREVIEW_MAX_FILES = 24;
export const AGENT_SKILL_TOOL_RESOURCE_PREVIEW_MAX_FILES = 80;
export const AGENT_SKILL_REFERENCE_FILE_MAX_BYTES = 1_000_000;
export const AGENT_SKILL_ASSET_FILE_MAX_BYTES = 2_000_000;
export const AGENT_SKILL_READ_TEXT_DEFAULT_MAX_CHARS = 12_000;
export const AGENT_SKILL_READ_TEXT_MAX_CHARS = 60_000;
export const AGENT_SKILL_SCRIPT_MAX_ARGS = 32;
export const AGENT_SKILL_SCRIPT_ARG_MAX_LENGTH = 512;
export const AGENT_SKILL_SCRIPT_TIMEOUT_MS = 20_000;
export const AGENT_SKILL_SCRIPT_TIMEOUT_MAX_MS = 120_000;
export const AGENT_SKILL_SCRIPT_OUTPUT_MAX_CHARS = 24_000;
export const SKILL_REGISTRY_LIST_CACHE_TTL_MS = 5 * 60_000;
export const SKILL_REGISTRY_TREE_CACHE_TTL_MS = 10 * 60_000;

/**
 * Impact scope:
 * These constants define MCP server validation, parsing, and display behavior.
 * Changing them affects both API-side payload validation and home-side form checks.
 */
export const MCP_SERVER_NAME_MAX_LENGTH = 80;
export const MCP_STDIO_ARGS_MAX = 64;
export const MCP_STDIO_ENV_VARS_MAX = 64;
export const MCP_HTTP_HEADERS_MAX = 64;
export const MCP_AZURE_AUTH_SCOPE_MAX_LENGTH = 512;
export const MCP_TIMEOUT_SECONDS_MIN = 1;
export const MCP_TIMEOUT_SECONDS_MAX = 600;
export const MCP_DEFAULT_TIMEOUT_SECONDS = 30;
export const MCP_DEFAULT_AZURE_AUTH_SCOPE = AZURE_COGNITIVE_SERVICES_SCOPE;
export const MCP_DEFAULT_HTTP_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
};
export const MCP_DEFAULT_OPENAI_DOCS_SERVER_NAME = "openai-docs";
export const MCP_DEFAULT_OPENAI_DOCS_SERVER_URL = "https://developers.openai.com/mcp";
export const MCP_DEFAULT_MICROSOFT_LEARN_SERVER_NAME = "microsoft-learn";
export const MCP_DEFAULT_MICROSOFT_LEARN_SERVER_URL = "https://learn.microsoft.com/api/mcp";
export const MCP_DEFAULT_WORKIQ_SERVER_NAME = "workiq";
export const MCP_DEFAULT_WORKIQ_SERVER_COMMAND = "npx";
export const MCP_DEFAULT_WORKIQ_SERVER_ARGS = ["-y", "@microsoft/workiq", "mcp"] as const;
export const MCP_DEFAULT_FILESYSTEM_MCP_SERVER_NAME = "filesystem";
export const MCP_DEFAULT_FILESYSTEM_MCP_SERVER_COMMAND = "npx";
export const MCP_DEFAULT_FILESYSTEM_MCP_SERVER_ARGS = [
  "-y",
  "@modelcontextprotocol/server-filesystem",
  ".",
] as const;
export const MCP_DEFAULT_MEMORY_MCP_SERVER_NAME = "server-memory";
export const MCP_DEFAULT_MEMORY_MCP_SERVER_COMMAND = "npx";
export const MCP_DEFAULT_MEMORY_MCP_SERVER_ARGS = ["-y", "@modelcontextprotocol/server-memory"] as const;
export const MCP_DEFAULT_EVERYTHING_MCP_SERVER_NAME = "server-everything";
export const MCP_DEFAULT_EVERYTHING_MCP_SERVER_COMMAND = "npx";
export const MCP_DEFAULT_EVERYTHING_MCP_SERVER_ARGS = [
  "-y",
  "@modelcontextprotocol/server-everything",
] as const;
export const MCP_LEGACY_UNAVAILABLE_DEFAULT_STDIO_NPX_PACKAGE_NAMES = [
  "@modelcontextprotocol/server-git",
  "@modelcontextprotocol/server-http",
  "@modelcontextprotocol/server-sqlite",
  "@modelcontextprotocol/server-postgres",
  "@modelcontextprotocol/server-shell",
  "@modelcontextprotocol/server-playwright",
] as const;
export const MCP_DEFAULT_AZURE_MCP_SERVER_NAME = "azure-mcp";
export const MCP_DEFAULT_AZURE_MCP_SERVER_COMMAND = "npx";
export const MCP_DEFAULT_AZURE_MCP_SERVER_ARGS = [
  "-y",
  "@azure/mcp@latest",
  "server",
  "start",
] as const;
export const MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_NAME = "playwright";
export const MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_COMMAND = "npx";
export const MCP_DEFAULT_PLAYWRIGHT_MCP_SERVER_ARGS = ["-y", "@playwright/mcp@latest"] as const;
export const MCP_DEFAULT_MERMAID_MCP_SERVER_NAME = "mcp-mermaid";
export const MCP_DEFAULT_MERMAID_MCP_SERVER_COMMAND = "npx";
export const MCP_DEFAULT_MERMAID_MCP_SERVER_ARGS = ["-y", "mcp-mermaid"] as const;
export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * Impact scope:
 * These constants define instruction file validation, enhancement, and persistence UX.
 * Changing them affects instruction upload/save constraints and enhancement prompts.
 */
export const INSTRUCTION_MAX_FILE_SIZE_BYTES = 1_000_000;
export const INSTRUCTION_MAX_FILE_SIZE_LABEL = "1MB";
export const INSTRUCTION_ALLOWED_EXTENSIONS = new Set(["md", "txt", "xml", "json"]);
export const INSTRUCTION_DEFAULT_EXTENSION = "txt";
export const INSTRUCTION_ENHANCE_SYSTEM_PROMPT = [
  "<enhance_instruction_policy>",
  "  <primary_objective>",
  "    Revise the provided instruction so it faithfully realizes the user's intent.",
  "    Remove contradictions, ambiguity, redundancy, and clear typos/spelling mistakes.",
  "  </primary_objective>",
  "  <editing_boundaries>",
  "    Preserve intended meaning, constraints, and safety boundaries.",
  "    Do not add new requirements not implied by the source.",
  "    Preserve language and file-format style requested by the user.",
  "    Preserve original information as much as possible.",
  "    Remove details only when needed to resolve contradiction, ambiguity, or redundancy.",
  "    Do not omit, summarize, truncate, or replace any part with placeholders.",
  "    Do not insert comments like 'omitted', '省略', 'same as original', or similar markers.",
  "  </editing_boundaries>",
  "  <diff_contract>",
  "    Revise the instruction by producing structured unified-diff hunks against the original content.",
  "    Return exactly one patch target in fileName and follow the requested fileName.",
  "    Return hunks ordered by oldStart in strictly ascending order.",
  "    Do not return overlapping hunks or duplicate source ranges.",
  "    oldStart/newStart must reference exact 1-based line numbers in the source text.",
  "    Context/remove lines must match original source lines exactly.",
  "    Include sufficient context lines around edits so hunks can be applied reliably.",
  "  </diff_contract>",
  "  <reasoning_and_output>",
  "    Think step-by-step internally before answering, but never reveal your reasoning.",
  "    Before finalizing, run an internal checklist for objective completion, schema validity, and patch consistency.",
  "    Do not return the full rewritten instruction text.",
  "    If any internal check fails, return the requested fileName with an empty hunks array.",
  "    Return only structured output that matches the schema. No explanations or markdown fences.",
  "  </reasoning_and_output>",
  "</enhance_instruction_policy>",
].join("\n");
export type InstructionSaveFileType = {
  description?: string;
  accept: Record<string, string[]>;
};
export const INSTRUCTION_SAVE_FILE_TYPES: InstructionSaveFileType[] = [
  {
    description: "Instruction files",
    accept: {
      "text/markdown": [".md"],
      "text/plain": [".txt"],
      "application/json": [".json"],
      "application/xml": [".xml"],
      "text/xml": [".xml"],
    },
  },
];

/**
 * Impact scope:
 * These constants define prompt file naming and content limits.
 * Changing them affects instruction filename normalization and size validation.
 */
export const PROMPT_DEFAULT_FILE_STEM = "instruction";
export const PROMPT_DEFAULT_FILE_EXTENSION = ".md";
export const PROMPT_MAX_FILE_STEM_LENGTH = 64;
export const PROMPT_MAX_FILE_NAME_LENGTH = 128;
export const PROMPT_MAX_CONTENT_BYTES = 1_000_000;
export const PROMPT_ALLOWED_FILE_EXTENSIONS = new Set([".md", ".txt", ".xml", ".json"]);

/**
 * Impact scope:
 * These constants define desktop-first Home layout behavior.
 * Changing them affects splitter bounds and composer textarea resizing.
 */
export const HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX = 320;
export const HOME_MAIN_SPLITTER_MIN_LEFT_WIDTH_PX = 560;
export const HOME_CHAT_INPUT_MIN_HEIGHT_PX = 44;
export const HOME_CHAT_INPUT_MAX_HEIGHT_PX = 220;
export const HOME_THREAD_NAME_MAX_LENGTH = 80;

/**
 * Impact scope:
 * These constants define side-panel tab labels and ids.
 * Changing them affects tab rendering and aria wiring in the config panel.
 */
export const HOME_MAIN_VIEW_TAB_OPTIONS = [
  { id: "threads", label: "🧵 Threads" },
  { id: "mcp", label: "🧩 MCP Servers" },
  { id: "skills", label: "🧠 Skills" },
  { id: "settings", label: "⚙️ Settings" },
] as const;

/**
 * Impact scope:
 * These constants define instruction diff patch schema validation contracts.
 * Changing them affects API /api/instruction-patches output validation and patch parsing.
 */
export const INSTRUCTION_DIFF_PATCH_FILE_NAME_PATTERN =
  /^[A-Za-z0-9._-]+\.(?:md|txt|xml|json)$/;
export const INSTRUCTION_DIFF_PATCH_MAX_HUNKS = 256;
export const INSTRUCTION_DIFF_PATCH_MAX_HUNK_LINES = 512;
export const INSTRUCTION_DIFF_PATCH_MAX_LINE_TEXT_LENGTH = 4_000;
export const INSTRUCTION_DIFF_PATCH_OUTPUT_TYPE = {
  type: "json_schema" as const,
  name: "instruction_diff_patch",
  strict: true,
  schema: {
    type: "object" as const,
    description: "Structured patch hunks for instruction enhancement.",
    properties: {
      fileName: {
        type: "string",
        description: "Target file name for the instruction patch, e.g. instruction.md",
        minLength: 1,
        maxLength: 128,
        pattern: "^[A-Za-z0-9._-]+\\.(?:md|txt|xml|json)$",
      },
      hunks: {
        type: "array",
        description: "Unified diff-style hunks.",
        maxItems: INSTRUCTION_DIFF_PATCH_MAX_HUNKS,
        items: {
          type: "object",
          properties: {
            oldStart: {
              type: "integer",
              minimum: 0,
              description:
                "1-based start line in original text. Use 0 only for pure insertion at start.",
            },
            newStart: {
              type: "integer",
              minimum: 0,
              description: "1-based start line in revised text.",
            },
            lines: {
              type: "array",
              minItems: 1,
              maxItems: INSTRUCTION_DIFF_PATCH_MAX_HUNK_LINES,
              items: {
                type: "object",
                properties: {
                  op: {
                    type: "string",
                    enum: ["context", "add", "remove"],
                  },
                  text: {
                    type: "string",
                    maxLength: INSTRUCTION_DIFF_PATCH_MAX_LINE_TEXT_LENGTH,
                  },
                },
                required: ["op", "text"],
                additionalProperties: false,
              },
            },
          },
          required: ["oldStart", "newStart", "lines"],
          additionalProperties: false,
        },
      },
    },
    required: ["fileName", "hunks"] as Array<"fileName" | "hunks">,
    additionalProperties: false as const,
  },
};

/**
 * Impact scope:
 * These constants define thread naming behavior and home thread request defaults.
 * Changing them affects thread creation naming, auto-title generation, and request-state resets.
 */
export const THREAD_AUTO_TITLE_MAX_LENGTH = 20;
export const THREAD_AUTO_TITLE_SYSTEM_PROMPT = [
  "<thread_auto_title_policy>",
  "  <objective>",
  "    Generate a concise thread title that summarizes the provided Playground content and Instruction.",
  "  </objective>",
  "  <output_rules>",
  `    Return a single plain-text title with at most ${THREAD_AUTO_TITLE_MAX_LENGTH} characters.`,
  "    Keep the same language as the source content.",
  "    Do not use markdown, quotes, prefixes, suffixes, or line breaks.",
  "    Do not reveal reasoning or explanations.",
  "  </output_rules>",
  "</thread_auto_title_policy>",
].join("\n");
export const THREAD_DEFAULT_NAME = "New Thread";
export const HOME_DEFAULT_THREAD_REQUEST_STATE = {
  isSending: false,
  sendProgressMessages: [] as string[],
  activeTurnId: null as string | null,
  lastErrorTurnId: null as string | null,
  error: null as string | null,
};

/**
 * Impact scope:
 * These constants define API cache windows and client status UX timing.
 * Changing them affects attachment availability cache freshness and auto-dismiss behavior.
 */
export const CODE_INTERPRETER_ATTACHMENT_AVAILABILITY_CACHE_MS = 10 * 60 * 1000;
export const AUTO_DISMISS_STATUS_DEFAULT_MS = 5000;

/**
 * Impact scope:
 * These constants define event-log normalization limits and dedupe behavior.
 * Changing them affects accepted telemetry payload size and duplicate suppression windows.
 */
export const APP_EVENT_LOG_MAX_CATEGORY_LENGTH = 80;
export const APP_EVENT_LOG_MAX_EVENT_NAME_LENGTH = 120;
export const APP_EVENT_LOG_MAX_MESSAGE_LENGTH = 4_000;
export const APP_EVENT_LOG_MAX_TEXT_LENGTH = 8_000;
export const APP_EVENT_LOG_MAX_PATH_LENGTH = 1_024;
export const APP_EVENT_LOG_MAX_CONTEXT_DEPTH = 6;
export const APP_EVENT_LOG_MAX_CONTEXT_KEYS = 200;
export const APP_EVENT_LOG_MAX_CONTEXT_ARRAY_ITEMS = 200;
export const CLIENT_EVENT_LOG_DEDUPE_WINDOW_MS = 1_500;

/**
 * Impact scope:
 * These constants define persisted row-id unwrap patterns for thread-linked MCP entries.
 * Changing them affects how saved IDs are normalized and reconstructed.
 */
export const THREAD_MCP_SERVER_ROW_ID_PATTERN = /^thread:[^:]+:mcp:\d+:(.+)$/;
export const THREAD_MCP_RPC_LOG_ROW_ID_PATTERN = /^thread:[^:]+:rpc:\d+:(.+)$/;
