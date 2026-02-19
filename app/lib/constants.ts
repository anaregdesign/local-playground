/**
 * Impact scope:
 * These constants are used by Azure login/logout route handlers.
 * Changing them affects how the app invokes Azure CLI on all platforms.
 */
export const AZURE_CLI_COMMAND = "az";
export const AZURE_LOGIN_ARGS = ["login"] as const;
export const AZURE_LOGOUT_ARGS = ["logout"] as const;
export const AZURE_LOGOUT_TIMEOUT_MS = 30_000;
export const AZURE_LOGOUT_MAX_BUFFER_BYTES = 1024 * 1024;

/**
 * Impact scope:
 * These constants are shared by Azure ARM discovery and Azure OpenAI auth logic.
 * Changing them affects project/deployment discovery and token acquisition behavior.
 */
export const AZURE_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
export const AZURE_ARM_SCOPE = "https://management.azure.com/.default";
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
 * These constants control shared storage locations and filenames.
 * Changing them affects where user settings and MCP profiles are read/written.
 */
export const FOUNDRY_LEGACY_CONFIG_DIRECTORY_NAME = ".foundry_local_playground";
export const FOUNDRY_WINDOWS_CONFIG_DIRECTORY_NAME = "FoundryLocalPlayground";
export const FOUNDRY_AZURE_SELECTION_FILE_NAME = "azure-selection.json";
export const FOUNDRY_MCP_SERVERS_FILE_NAME = "mcp-servers.json";
export const FOUNDRY_PROMPTS_SUBDIRECTORY_NAME = "prompts";

/**
 * Impact scope:
 * These constants are shared across chat runtime validation and home UI validation.
 * Changing them affects what requests are accepted and what values users can set.
 */
export const CONTEXT_WINDOW_DEFAULT = 10;
export const CONTEXT_WINDOW_MIN = 1;
export const CONTEXT_WINDOW_MAX = 200;
export const TEMPERATURE_MIN = 0;
export const TEMPERATURE_MAX = 2;
export const CHAT_MAX_MCP_SERVERS = 8;
export const CHAT_MAX_AGENT_INSTRUCTION_LENGTH = 4000;
export const DEFAULT_AGENT_INSTRUCTION = "You are a concise assistant for a local playground app.";
export const HOME_REASONING_EFFORT_OPTIONS = ["none", "low", "medium", "high"] as const;
export const HOME_DEFAULT_MCP_TRANSPORT = "streamable_http" as const;
export const HOME_INITIAL_MESSAGES: ReadonlyArray<never> = [];

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
export const INSTRUCTION_DIFF_MAX_MATRIX_CELLS = 250_000;
export const INSTRUCTION_ENHANCE_SYSTEM_PROMPT = [
  "You are an expert editor for agent system instructions.",
  "Rewrite the provided instruction to remove contradictions and ambiguity.",
  "Keep the original intent, constraints, and safety boundaries.",
  "Preserve as much of the original information as possible and avoid removing details unless necessary.",
  "Do not omit, summarize, truncate, or replace any part with placeholders.",
  "Do not insert comments like 'omitted', '省略', 'same as original', or similar markers.",
  "Even if the instruction is long, return the complete revised text.",
  "Preserve the language and file-format style requested by the user.",
  "Return only the revised instruction text with no explanations.",
].join(" ");
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
 * These constants define API-side prompt file naming and content limits.
 * Changing them affects saved filename normalization and size validation.
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

/**
 * Impact scope:
 * These constants define side-panel tab labels and ids.
 * Changing them affects tab rendering and aria wiring in the config panel.
 */
export const HOME_MAIN_VIEW_TAB_OPTIONS = [
  { id: "settings", label: "⚙️ Settings" },
  { id: "mcp", label: "🧩 MCP Servers" },
] as const;
