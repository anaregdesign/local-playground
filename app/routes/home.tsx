import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConfigPanel } from "~/components/home/config/ConfigPanel";
import { PlaygroundPanel } from "~/components/home/playground/PlaygroundPanel";
import { CopyIconButton } from "~/components/home/shared/CopyIconButton";
import { FluentUI } from "~/components/home/shared/fluent";
import type { MainViewTab, McpTransport, ReasoningEffort } from "~/components/home/shared/types";
import { validateContextWindowInput } from "~/lib/home/settings/context-window";
import type { Route } from "./+types/home";

const { Button } = FluentUI;

type ChatRole = "user" | "assistant";

type McpHttpServerConfig = {
  id: string;
  name: string;
  transport: "streamable_http" | "sse";
  url: string;
  headers: Record<string, string>;
  useAzureAuth: boolean;
  azureAuthScope: string;
  timeoutSeconds: number;
};

type McpStdioServerConfig = {
  id: string;
  name: string;
  transport: "stdio";
  command: string;
  args: string[];
  cwd?: string;
  env: Record<string, string>;
};

type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig;
type AzureConnectionOption = {
  id: string;
  projectName: string;
  baseUrl: string;
  apiVersion: string;
};

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  turnId: string;
};

type JsonTokenType =
  | "plain"
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "punctuation";

type JsonToken = {
  value: string;
  type: JsonTokenType;
};

type ChatApiResponse = {
  message?: string;
  error?: string;
  errorCode?: "azure_login_required";
};
type SaveInstructionToClientFileResult = {
  fileName: string;
  mode: "picker" | "download";
};
type SaveFilePickerFileType = {
  description?: string;
  accept: Record<string, string[]>;
};
type SaveFilePickerOptionsCompat = {
  suggestedName?: string;
  types?: SaveFilePickerFileType[];
};
type SaveFileWritableStream = {
  write(data: string): Promise<void>;
  close(): Promise<void>;
};
type SaveFileHandleCompat = {
  name: string;
  createWritable(): Promise<SaveFileWritableStream>;
};
type WindowWithSaveFilePicker = Window & {
  showSaveFilePicker?: (options?: SaveFilePickerOptionsCompat) => Promise<SaveFileHandleCompat>;
};
type InstructionLanguage = "japanese" | "english" | "mixed" | "unknown";
type InstructionDiffLineType = "context" | "added" | "removed";
type InstructionDiffLine = {
  type: InstructionDiffLineType;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
};
type InstructionEnhanceComparison = {
  original: string;
  enhanced: string;
  extension: string;
  language: InstructionLanguage;
  diffLines: InstructionDiffLine[];
};
type ChatStreamProgressEvent = {
  type: "progress";
  message?: unknown;
  isMcp?: unknown;
};
type ChatStreamFinalEvent = {
  type: "final";
  message?: unknown;
};
type ChatStreamErrorEvent = {
  type: "error";
  error?: unknown;
  errorCode?: unknown;
};
type ChatStreamMcpRpcEvent = {
  type: "mcp_rpc";
  record?: unknown;
};
type ChatStreamEvent =
  | ChatStreamProgressEvent
  | ChatStreamFinalEvent
  | ChatStreamErrorEvent
  | ChatStreamMcpRpcEvent;
type McpRpcHistoryEntry = {
  id: string;
  sequence: number;
  serverName: string;
  method: string;
  startedAt: string;
  completedAt: string;
  request: unknown;
  response: unknown;
  isError: boolean;
  turnId: string;
};

type JsonHighlightStyle = "default" | "compact";

type AzureActionApiResponse = {
  message?: string;
  error?: string;
};
type AzureConnectionsApiResponse = {
  projects?: unknown;
  deployments?: unknown;
  tenantId?: unknown;
  authRequired?: boolean;
  error?: string;
};
type AzureSelectionPreference = {
  tenantId: string;
  projectId: string;
  deploymentName: string;
};
type AzureSelectionApiResponse = {
  selection?: unknown;
  error?: string;
};

type SaveMcpServerRequest = Omit<McpHttpServerConfig, "id"> | Omit<McpStdioServerConfig, "id">;
type McpServersApiResponse = {
  profile?: unknown;
  profiles?: unknown;
  warning?: string;
  error?: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [];
const DEFAULT_CONTEXT_WINDOW_SIZE = 10;
const MIN_CONTEXT_WINDOW_SIZE = 1;
const MAX_CONTEXT_WINDOW_SIZE = 200;
const DEFAULT_AGENT_INSTRUCTION = "You are a concise assistant for a local playground app.";
const MAX_INSTRUCTION_FILE_SIZE_BYTES = 1_000_000;
const MAX_INSTRUCTION_FILE_SIZE_LABEL = "1MB";
const ALLOWED_INSTRUCTION_EXTENSIONS = new Set(["md", "txt", "xml", "json"]);
const INSTRUCTION_SAVE_FILE_TYPES: SaveFilePickerFileType[] = [
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
const DEFAULT_INSTRUCTION_EXTENSION = "txt";
const MAX_INSTRUCTION_DIFF_MATRIX_CELLS = 250_000;
const ENHANCE_INSTRUCTION_SYSTEM_PROMPT = [
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
const DEFAULT_MCP_TRANSPORT: McpTransport = "streamable_http";
const DEFAULT_MCP_AZURE_AUTH_SCOPE = "https://cognitiveservices.azure.com/.default";
const DEFAULT_MCP_TIMEOUT_SECONDS = 30;
const MIN_MCP_TIMEOUT_SECONDS = 1;
const MAX_MCP_TIMEOUT_SECONDS = 600;
const MAX_MCP_HTTP_HEADERS = 64;
const HTTP_HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const MAX_MCP_AZURE_AUTH_SCOPE_LENGTH = 512;
const CHAT_INPUT_MIN_HEIGHT_PX = 44;
const CHAT_INPUT_MAX_HEIGHT_PX = 220;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Local Playground" },
    { name: "description", content: "Local desktop playground with OpenAI backend." },
  ];
}

export default function Home() {
  const [azureConnections, setAzureConnections] = useState<AzureConnectionOption[]>([]);
  const [azureDeployments, setAzureDeployments] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [activeMainTab, setActiveMainTab] = useState<MainViewTab>("settings");
  const [selectedAzureConnectionId, setSelectedAzureConnectionId] = useState("");
  const [selectedAzureDeploymentName, setSelectedAzureDeploymentName] = useState("");
  const [isLoadingAzureConnections, setIsLoadingAzureConnections] = useState(false);
  const [isLoadingAzureDeployments, setIsLoadingAzureDeployments] = useState(false);
  const [azureConnectionError, setAzureConnectionError] = useState<string | null>(null);
  const [azureDeploymentError, setAzureDeploymentError] = useState<string | null>(null);
  const [isAzureAuthRequired, setIsAzureAuthRequired] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("none");
  const [agentInstruction, setAgentInstruction] = useState(DEFAULT_AGENT_INSTRUCTION);
  const [loadedInstructionFileName, setLoadedInstructionFileName] = useState<string | null>(null);
  const [instructionFileError, setInstructionFileError] = useState<string | null>(null);
  const [instructionSaveError, setInstructionSaveError] = useState<string | null>(null);
  const [instructionSaveSuccess, setInstructionSaveSuccess] = useState<string | null>(null);
  const [isSavingInstructionPrompt, setIsSavingInstructionPrompt] = useState(false);
  const [instructionEnhanceError, setInstructionEnhanceError] = useState<string | null>(null);
  const [instructionEnhanceSuccess, setInstructionEnhanceSuccess] = useState<string | null>(null);
  const [isEnhancingInstruction, setIsEnhancingInstruction] = useState(false);
  const [instructionEnhanceComparison, setInstructionEnhanceComparison] =
    useState<InstructionEnhanceComparison | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [savedMcpServers, setSavedMcpServers] = useState<McpServerConfig[]>([]);
  const [selectedSavedMcpServerId, setSelectedSavedMcpServerId] = useState("");
  const [mcpNameInput, setMcpNameInput] = useState("");
  const [mcpUrlInput, setMcpUrlInput] = useState("");
  const [mcpCommandInput, setMcpCommandInput] = useState("");
  const [mcpArgsInput, setMcpArgsInput] = useState("");
  const [mcpCwdInput, setMcpCwdInput] = useState("");
  const [mcpEnvInput, setMcpEnvInput] = useState("");
  const [mcpHeadersInput, setMcpHeadersInput] = useState("");
  const [mcpUseAzureAuthInput, setMcpUseAzureAuthInput] = useState(false);
  const [mcpAzureAuthScopeInput, setMcpAzureAuthScopeInput] = useState(
    DEFAULT_MCP_AZURE_AUTH_SCOPE,
  );
  const [mcpTimeoutSecondsInput, setMcpTimeoutSecondsInput] = useState(
    String(DEFAULT_MCP_TIMEOUT_SECONDS),
  );
  const [mcpTransport, setMcpTransport] = useState<McpTransport>(DEFAULT_MCP_TRANSPORT);
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [mcpFormWarning, setMcpFormWarning] = useState<string | null>(null);
  const [savedMcpError, setSavedMcpError] = useState<string | null>(null);
  const [isLoadingSavedMcpServers, setIsLoadingSavedMcpServers] = useState(false);
  const [isSavingMcpServer, setIsSavingMcpServer] = useState(false);
  const [contextWindowInput, setContextWindowInput] = useState(
    String(DEFAULT_CONTEXT_WINDOW_SIZE),
  );
  const [isSending, setIsSending] = useState(false);
  const [sendProgressMessages, setSendProgressMessages] = useState<string[]>([]);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [lastErrorTurnId, setLastErrorTurnId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStartingAzureLogin, setIsStartingAzureLogin] = useState(false);
  const [isStartingAzureLogout, setIsStartingAzureLogout] = useState(false);
  const [azureLoginError, setAzureLoginError] = useState<string | null>(null);
  const [azureLogoutError, setAzureLogoutError] = useState<string | null>(null);
  const [mcpRpcHistory, setMcpRpcHistory] = useState<McpRpcHistoryEntry[]>([]);
  const [rightPaneWidth, setRightPaneWidth] = useState(420);
  const [activeResizeHandle, setActiveResizeHandle] = useState<"main" | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const instructionFileInputRef = useRef<HTMLInputElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const azureDeploymentRequestSeqRef = useRef(0);
  const activeAzureTenantIdRef = useRef("");
  const preferredAzureSelectionRef = useRef<AzureSelectionPreference | null>(null);
  const contextWindowValidation = validateContextWindowInput(contextWindowInput);
  const isChatLocked = isAzureAuthRequired;
  const activeAzureConnection =
    azureConnections.find((connection) => connection.id === selectedAzureConnectionId) ??
    azureConnections[0] ??
    null;
  const canClearAgentInstruction =
    agentInstruction.length > 0 ||
    loadedInstructionFileName !== null ||
    instructionFileError !== null;
  const canSaveAgentInstructionPrompt = agentInstruction.trim().length > 0;
  const canEnhanceAgentInstruction = agentInstruction.trim().length > 0;
  const mcpHistoryByTurnId = buildMcpHistoryByTurnId(mcpRpcHistory);
  const activeTurnMcpHistory = activeTurnId ? (mcpHistoryByTurnId.get(activeTurnId) ?? []) : [];
  const errorTurnMcpHistory = lastErrorTurnId ? (mcpHistoryByTurnId.get(lastErrorTurnId) ?? []) : [];
  const savedMcpServerOptions = savedMcpServers.map((server) => ({
    id: server.id,
    label: formatMcpServerOption(server),
  }));
  const canSendMessage =
    !isSending &&
    !isChatLocked &&
    !isLoadingAzureConnections &&
    !isLoadingAzureDeployments &&
    !!activeAzureConnection &&
    !!selectedAzureDeploymentName.trim() &&
    draft.trim().length > 0 &&
    contextWindowValidation.isValid;

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending, sendProgressMessages]);

  useEffect(() => {
    const input = chatInputRef.current;
    if (!input) {
      return;
    }

    resizeChatInput(input);
  }, [draft]);

  useEffect(() => {
    void loadSavedMcpServers();
    void loadAzureConnections();
  }, []);

  useEffect(() => {
    if (!isAzureAuthRequired) {
      return;
    }

    const refreshConnections = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      void (async () => {
        const stillAuthRequired = await loadAzureConnections();
        if (!stillAuthRequired) {
          setAzureLoginError(null);
          setError(null);
        }
      })();
    };

    const intervalId = window.setInterval(refreshConnections, 4000);
    window.addEventListener("focus", refreshConnections);
    document.addEventListener("visibilitychange", refreshConnections);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshConnections);
      document.removeEventListener("visibilitychange", refreshConnections);
    };
  }, [isAzureAuthRequired]);

  useEffect(() => {
    if (!activeAzureConnection) {
      setAzureDeployments([]);
      setSelectedAzureDeploymentName("");
      setAzureDeploymentError(null);
      return;
    }

    void loadAzureDeployments(activeAzureConnection.id);
  }, [activeAzureConnection]);

  useEffect(() => {
    if (isAzureAuthRequired) {
      return;
    }

    const tenantId = activeAzureTenantIdRef.current.trim();
    const projectId = selectedAzureConnectionId.trim();
    const deploymentName = selectedAzureDeploymentName.trim();
    if (!tenantId || !projectId || !deploymentName) {
      return;
    }

    if (!azureConnections.some((connection) => connection.id === projectId)) {
      return;
    }

    if (!azureDeployments.includes(deploymentName)) {
      return;
    }

    const preferred = preferredAzureSelectionRef.current;
    if (
      preferred &&
      preferred.tenantId === tenantId &&
      preferred.projectId === projectId &&
      preferred.deploymentName === deploymentName
    ) {
      return;
    }

    void saveAzureSelectionPreference({ tenantId, projectId, deploymentName });
  }, [
    azureConnections,
    azureDeployments,
    isAzureAuthRequired,
    selectedAzureConnectionId,
    selectedAzureDeploymentName,
  ]);

  useEffect(() => {
    if (isChatLocked && activeMainTab !== "settings") {
      setActiveMainTab("settings");
    }
  }, [activeMainTab, isChatLocked]);

  useEffect(() => {
    const body = document.body;
    const previousCursor = body.style.cursor;
    const previousUserSelect = body.style.userSelect;

    if (activeResizeHandle === "main") {
      body.style.cursor = "col-resize";
      body.style.userSelect = "none";
    }

    return () => {
      body.style.cursor = previousCursor;
      body.style.userSelect = previousUserSelect;
    };
  }, [activeResizeHandle]);

  useEffect(() => {
    const handleResize = () => {
      const layoutElement = layoutRef.current;
      if (layoutElement) {
        const rect = layoutElement.getBoundingClientRect();
        const minRightWidth = 320;
        const minLeftWidth = 560;
        const maxRightWidth = Math.max(minRightWidth, rect.width - minLeftWidth);
        setRightPaneWidth((current) => clampNumber(current, minRightWidth, maxRightWidth));
      }

    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  async function loadSavedMcpServers() {
    setIsLoadingSavedMcpServers(true);

    try {
      const response = await fetch("/api/mcp-servers", {
        method: "GET",
      });

      const payload = (await response.json()) as McpServersApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load saved MCP servers.");
      }

      const parsedServers = readMcpServerList(payload.profiles);
      setSavedMcpServers(parsedServers);
      setSelectedSavedMcpServerId((current) =>
        current && parsedServers.some((server) => server.id === current)
          ? current
          : parsedServers[0]?.id ?? "",
      );
      setSavedMcpError(null);
    } catch (loadError) {
      setSavedMcpError(
        loadError instanceof Error ? loadError.message : "Failed to load saved MCP servers.",
      );
    } finally {
      setIsLoadingSavedMcpServers(false);
    }
  }

  async function loadAzureSelectionPreference(
    tenantId: string,
  ): Promise<AzureSelectionPreference | null> {
    const normalizedTenantId = tenantId.trim();
    if (!normalizedTenantId) {
      return null;
    }

    try {
      const response = await fetch(
        `/api/azure-selection?tenantId=${encodeURIComponent(normalizedTenantId)}`,
        {
          method: "GET",
        },
      );
      const payload = (await response.json()) as AzureSelectionApiResponse;
      if (!response.ok) {
        return null;
      }

      return readAzureSelectionFromUnknown(payload.selection, normalizedTenantId);
    } catch {
      return null;
    }
  }

  async function saveAzureSelectionPreference(selection: AzureSelectionPreference): Promise<void> {
    preferredAzureSelectionRef.current = selection;

    try {
      const response = await fetch("/api/azure-selection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(selection),
      });
      if (!response.ok) {
        return;
      }
    } catch {
      // Ignore persistence failures and continue normal UI flow.
    }
  }

  async function loadAzureConnections(): Promise<boolean> {
    setIsLoadingAzureConnections(true);

    try {
      const response = await fetch("/api/azure-connections", {
        method: "GET",
      });

      const payload = (await response.json()) as AzureConnectionsApiResponse;
      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        activeAzureTenantIdRef.current = "";
        preferredAzureSelectionRef.current = null;
        setIsAzureAuthRequired(authRequired);
        setAzureConnections([]);
        setAzureDeployments([]);
        setSelectedAzureConnectionId("");
        setSelectedAzureDeploymentName("");
        setAzureConnectionError(authRequired ? null : payload.error || "Failed to load Azure projects.");
        setAzureDeploymentError(null);
        return authRequired;
      }

      const parsedProjects = readAzureProjectList(payload.projects);
      const tenantId = readTenantIdFromUnknown(payload.tenantId);
      activeAzureTenantIdRef.current = tenantId;
      const preferredSelection = tenantId ? await loadAzureSelectionPreference(tenantId) : null;
      preferredAzureSelectionRef.current = preferredSelection;
      const preferredProjectId = preferredSelection?.projectId ?? "";

      setAzureConnections(parsedProjects);
      setAzureDeployments([]);
      setIsAzureAuthRequired(payload.authRequired === true ? true : false);
      setAzureConnectionError(null);
      setAzureDeploymentError(null);
      setSelectedAzureConnectionId((current) =>
        current && parsedProjects.some((connection) => connection.id === current)
          ? current
          : preferredProjectId && parsedProjects.some((connection) => connection.id === preferredProjectId)
            ? preferredProjectId
            : parsedProjects[0]?.id ?? "",
      );
      return payload.authRequired === true;
    } catch (loadError) {
      activeAzureTenantIdRef.current = "";
      preferredAzureSelectionRef.current = null;
      setIsAzureAuthRequired(false);
      setAzureConnections([]);
      setAzureDeployments([]);
      setSelectedAzureConnectionId("");
      setSelectedAzureDeploymentName("");
      setAzureConnectionError(
        loadError instanceof Error ? loadError.message : "Failed to load Azure projects.",
      );
      setAzureDeploymentError(null);
      return false;
    } finally {
      setIsLoadingAzureConnections(false);
    }
  }

  async function loadAzureDeployments(projectId: string): Promise<void> {
    if (!projectId) {
      setAzureDeployments([]);
      setSelectedAzureDeploymentName("");
      setAzureDeploymentError(null);
      return;
    }

    const requestSeq = azureDeploymentRequestSeqRef.current + 1;
    azureDeploymentRequestSeqRef.current = requestSeq;
    setIsLoadingAzureDeployments(true);
    setAzureDeploymentError(null);

    try {
      const response = await fetch(
        `/api/azure-connections?projectId=${encodeURIComponent(projectId)}`,
        {
          method: "GET",
        },
      );

      const payload = (await response.json()) as AzureConnectionsApiResponse;
      if (requestSeq !== azureDeploymentRequestSeqRef.current) {
        return;
      }

      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        setIsAzureAuthRequired(authRequired);
        setAzureDeployments([]);
        setSelectedAzureDeploymentName("");
        setAzureDeploymentError(
          authRequired ? null : payload.error || "Failed to load deployments for the selected project.",
        );
        return;
      }

      const parsedDeployments = readAzureDeploymentList(payload.deployments);
      const tenantIdFromPayload = readTenantIdFromUnknown(payload.tenantId);
      if (tenantIdFromPayload) {
        activeAzureTenantIdRef.current = tenantIdFromPayload;
      }

      const preferredSelection = preferredAzureSelectionRef.current;
      const preferredDeploymentName =
        preferredSelection &&
        preferredSelection.tenantId === activeAzureTenantIdRef.current &&
        preferredSelection.projectId === projectId
          ? preferredSelection.deploymentName
          : "";

      setIsAzureAuthRequired(false);
      setAzureDeployments(parsedDeployments);
      setSelectedAzureDeploymentName((current) =>
        parsedDeployments.includes(current)
          ? current
          : preferredDeploymentName && parsedDeployments.includes(preferredDeploymentName)
            ? preferredDeploymentName
            : parsedDeployments[0] ?? "",
      );
      setAzureDeploymentError(
        parsedDeployments.length === 0
          ? "No Agents SDK-compatible deployments found for this project."
          : null,
      );
    } catch (loadError) {
      if (requestSeq !== azureDeploymentRequestSeqRef.current) {
        return;
      }

      setIsAzureAuthRequired(false);
      setAzureDeployments([]);
      setSelectedAzureDeploymentName("");
      setAzureDeploymentError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load deployments for the selected project.",
      );
    } finally {
      if (requestSeq === azureDeploymentRequestSeqRef.current) {
        setIsLoadingAzureDeployments(false);
      }
    }
  }

  async function saveMcpServerToConfig(server: McpServerConfig): Promise<{
    profile: McpServerConfig;
    warning: string | null;
  }> {
    const response = await fetch("/api/mcp-servers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(serializeMcpServerForSave(server)),
    });

    const payload = (await response.json()) as McpServersApiResponse;
    if (!response.ok) {
      throw new Error(payload.error || "Failed to save MCP server.");
    }

    const profile = readMcpServerFromUnknown(payload.profile);
    if (!profile) {
      throw new Error("Saved MCP server response is invalid.");
    }

    const profiles = readMcpServerList(payload.profiles);
    if (profiles.length > 0) {
      setSavedMcpServers(profiles);
      setSelectedSavedMcpServerId(profile.id);
    } else {
      setSavedMcpServers((current) => upsertMcpServer(current, profile));
      setSelectedSavedMcpServerId(profile.id);
    }

    return {
      profile,
      warning: typeof payload.warning === "string" ? payload.warning : null,
    };
  }

  async function sendMessage() {
    const content = draft.trim();
    if (
      !content ||
      isSending ||
      !contextWindowValidation.isValid
    ) {
      return;
    }

    if (isChatLocked) {
      setActiveMainTab("settings");
      setError("Playground is unavailable while logged out. Open ⚙️ Settings and sign in.");
      return;
    }

    if (!activeAzureConnection) {
      setError(
        isAzureAuthRequired
          ? "Azure login is required. Click Project or Deployment and sign in."
          : "No Azure project is available. Check your Azure account permissions.",
      );
      return;
    }

    const deploymentName = selectedAzureDeploymentName.trim();
    if (isLoadingAzureDeployments) {
      setError("Deployment list is loading. Please wait.");
      return;
    }

    if (!deploymentName || !azureDeployments.includes(deploymentName)) {
      setError("Select an Azure deployment before sending.");
      return;
    }

    const turnId = createId("turn");
    const userMessage: ChatMessage = createMessage("user", content, turnId);
    const contextWindowSize = contextWindowValidation.value;
    if (contextWindowSize === null) {
      return;
    }

    const history = messages
      .slice(-contextWindowSize)
      .map(({ role, content: previousContent }) => ({
        role,
        content: previousContent,
      }));

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError(null);
    setAzureLoginError(null);
    setLastErrorTurnId(null);
    setIsSending(true);
    setActiveTurnId(turnId);
    setSendProgressMessages(["Preparing request..."]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
        },
        body: JSON.stringify({
          message: content,
          history,
          azureConfig: {
            projectName: activeAzureConnection.projectName,
            baseUrl: activeAzureConnection.baseUrl,
            apiVersion: activeAzureConnection.apiVersion,
            deploymentName,
          },
          reasoningEffort,
          contextWindowSize,
          agentInstruction,
          mcpServers: mcpServers.map((server) =>
            server.transport === "stdio"
              ? {
                  name: server.name,
                  transport: server.transport,
                  command: server.command,
                  args: server.args,
                  cwd: server.cwd,
                  env: server.env,
                }
              : {
                  name: server.name,
                  transport: server.transport,
                  url: server.url,
                  headers: server.headers,
                  useAzureAuth: server.useAzureAuth,
                  azureAuthScope: server.azureAuthScope,
                  timeoutSeconds: server.timeoutSeconds,
                },
          ),
        }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      const isEventStream = contentType.toLowerCase().includes("text/event-stream");

      let payload: ChatApiResponse;
      if (isEventStream) {
        payload = await readChatEventStreamPayload(response, {
          onProgress: (message) => {
            appendProgressMessage(message, setSendProgressMessages);
          },
          onMcpRpcRecord: (entry) => {
            setMcpRpcHistory((current) =>
              upsertMcpRpcHistoryEntry(current, {
                ...entry,
                turnId,
              }),
            );
          },
        });
      } else {
        payload = (await response.json()) as ChatApiResponse;
      }

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Failed to send message.");
      }

      if (!payload.message) {
        throw new Error("The server returned an empty message.");
      }

      setMessages((current) => [...current, createMessage("assistant", payload.message!, turnId)]);
      setLastErrorTurnId(null);
    } catch (sendError) {
      setLastErrorTurnId(turnId);
      setError(sendError instanceof Error ? sendError.message : "Could not reach the server.");
    } finally {
      setIsSending(false);
      setActiveTurnId(null);
      setSendProgressMessages([]);
    }
  }

  async function handleAzureLogin() {
    if (isStartingAzureLogin) {
      return;
    }

    setAzureLoginError(null);
    setIsStartingAzureLogin(true);
    try {
      const stillAuthRequired = await loadAzureConnections();
      if (!stillAuthRequired) {
        return;
      }

      const response = await fetch("/api/azure-login", {
        method: "POST",
      });
      const payload = (await response.json()) as AzureActionApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to start Azure login.");
      }

      setError(payload.message || "Azure login started. Sign in and reload Azure connections.");
      setAzureConnectionError(null);
    } catch (loginError) {
      setAzureLoginError(
        loginError instanceof Error ? loginError.message : "Failed to start Azure login.",
      );
    } finally {
      setIsStartingAzureLogin(false);
    }
  }

  async function handleAzureLogout() {
    if (isStartingAzureLogout) {
      return;
    }

    setAzureLogoutError(null);
    setIsStartingAzureLogout(true);
    try {
      const response = await fetch("/api/azure-logout", {
        method: "POST",
      });
      const payload = (await response.json()) as AzureActionApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to run Azure logout.");
      }

      setError(payload.message || "Azure logout completed.");
      setAzureDeploymentError(null);
      await loadAzureConnections();
    } catch (logoutError) {
      setAzureLogoutError(
        logoutError instanceof Error ? logoutError.message : "Failed to run Azure logout.",
      );
    } finally {
      setIsStartingAzureLogout(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isChatLocked) {
      setActiveMainTab("settings");
      return;
    }
    void sendMessage();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isChatLocked) {
        setActiveMainTab("settings");
        return;
      }
      void sendMessage();
    }
  }

  function handleDraftChange(event: React.ChangeEvent<HTMLTextAreaElement>, value: string) {
    setDraft(value);
    resizeChatInput(event.currentTarget);
  }

  function resizeChatInput(input: HTMLTextAreaElement) {
    input.style.height = "auto";
    const boundedHeight = Math.max(
      CHAT_INPUT_MIN_HEIGHT_PX,
      Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT_PX),
    );
    input.style.height = `${boundedHeight}px`;
    input.style.overflowY = input.scrollHeight > CHAT_INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
  }

  function handleChatProjectChange(projectId: string) {
    setSelectedAzureConnectionId(projectId);
    setSelectedAzureDeploymentName("");
    setAzureDeploymentError(null);
    setError(null);
  }

  function handleChatDeploymentChange(nextDeploymentNameRaw: string) {
    const nextDeploymentName = nextDeploymentNameRaw.trim();
    setSelectedAzureDeploymentName(nextDeploymentName);
    setError(null);

    const tenantId = activeAzureTenantIdRef.current.trim();
    const projectId = (activeAzureConnection?.id ?? "").trim();
    if (!tenantId || !projectId || !nextDeploymentName) {
      return;
    }

    if (!azureDeployments.includes(nextDeploymentName)) {
      return;
    }

    void saveAzureSelectionPreference({
      tenantId,
      projectId,
      deploymentName: nextDeploymentName,
    });
  }

  function handleAgentInstructionChange(value: string) {
    setAgentInstruction(value);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceError(null);
    setInstructionEnhanceSuccess(null);
    setInstructionEnhanceComparison(null);
  }

  function handleClearInstruction() {
    setAgentInstruction("");
    setLoadedInstructionFileName(null);
    setInstructionFileError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceError(null);
    setInstructionEnhanceSuccess(null);
    setInstructionEnhanceComparison(null);
  }

  async function handleInstructionFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    setInstructionFileError(null);

    const extension = getFileExtension(file.name);
    if (!ALLOWED_INSTRUCTION_EXTENSIONS.has(extension)) {
      setInstructionFileError("Only .md, .txt, .xml, and .json files are supported.");
      input.value = "";
      return;
    }

    if (file.size > MAX_INSTRUCTION_FILE_SIZE_BYTES) {
      setInstructionFileError(
        `Instruction file is too large. Max ${MAX_INSTRUCTION_FILE_SIZE_LABEL}.`,
      );
      input.value = "";
      return;
    }

    try {
      const text = await file.text();
      setAgentInstruction(text);
      setLoadedInstructionFileName(file.name);
      setInstructionSaveError(null);
      setInstructionSaveSuccess(null);
      setInstructionEnhanceError(null);
      setInstructionEnhanceSuccess(null);
      setInstructionEnhanceComparison(null);
    } catch {
      setInstructionFileError("Failed to read the selected instruction file.");
    } finally {
      input.value = "";
    }
  }

  async function handleSaveInstructionPrompt() {
    if (isSavingInstructionPrompt) {
      return;
    }

    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);

    if (!agentInstruction.trim()) {
      setInstructionSaveError("Instruction is empty.");
      return;
    }

    setIsSavingInstructionPrompt(true);

    try {
      const sourceFileName = resolveInstructionSourceFileName(loadedInstructionFileName);
      const suggestedFileName = buildInstructionSuggestedFileName(
        sourceFileName,
        agentInstruction,
      );
      const saveResult = await saveInstructionToClientFile(agentInstruction, suggestedFileName);
      setLoadedInstructionFileName(saveResult.fileName);
      setInstructionSaveSuccess(
        saveResult.mode === "picker"
          ? `Saved as ${saveResult.fileName}`
          : `Download started: ${saveResult.fileName}`,
      );
    } catch (saveError) {
      if (isInstructionSaveCanceled(saveError)) {
        return;
      }
      setInstructionSaveError(
        saveError instanceof Error ? saveError.message : "Failed to save instruction prompt.",
      );
    } finally {
      setIsSavingInstructionPrompt(false);
    }
  }

  async function handleEnhanceInstruction() {
    if (isEnhancingInstruction) {
      return;
    }

    setInstructionEnhanceError(null);
    setInstructionEnhanceSuccess(null);
    setInstructionEnhanceComparison(null);

    const currentInstruction = agentInstruction.trim();
    if (!currentInstruction) {
      setInstructionEnhanceError("Instruction is empty.");
      return;
    }

    if (isChatLocked) {
      setActiveMainTab("settings");
      setInstructionEnhanceError(
        "Playground is unavailable while logged out. Open Azure Connection and sign in first.",
      );
      return;
    }

    if (!activeAzureConnection) {
      setInstructionEnhanceError("No Azure project is selected.");
      return;
    }

    const deploymentName = selectedAzureDeploymentName.trim();
    if (isLoadingAzureDeployments) {
      setInstructionEnhanceError("Deployment list is loading. Please wait.");
      return;
    }

    if (!deploymentName || !azureDeployments.includes(deploymentName)) {
      setInstructionEnhanceError("Select an Azure deployment before enhancing.");
      return;
    }

    const sourceFileName = resolveInstructionSourceFileName(loadedInstructionFileName);
    const instructionExtension = resolveInstructionFormatExtension(
      sourceFileName,
      currentInstruction,
    );
    const instructionLanguage = detectInstructionLanguage(currentInstruction);
    const enhanceRequestMessage = buildInstructionEnhanceMessage({
      instruction: currentInstruction,
      extension: instructionExtension,
      language: instructionLanguage,
    });

    setIsEnhancingInstruction(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message: enhanceRequestMessage,
          history: [],
          azureConfig: {
            projectName: activeAzureConnection.projectName,
            baseUrl: activeAzureConnection.baseUrl,
            apiVersion: activeAzureConnection.apiVersion,
            deploymentName,
          },
          reasoningEffort: "none",
          contextWindowSize: 1,
          agentInstruction: ENHANCE_INSTRUCTION_SYSTEM_PROMPT,
          mcpServers: [],
        }),
      });

      const payload = (await response.json()) as ChatApiResponse;
      if (!response.ok || payload.error) {
        if (payload.errorCode === "azure_login_required") {
          setIsAzureAuthRequired(true);
        }

        throw new Error(payload.error || "Failed to enhance instruction.");
      }

      const rawEnhancedInstruction =
        typeof payload.message === "string" ? payload.message.trim() : "";
      if (!rawEnhancedInstruction) {
        throw new Error("Enhancement response is empty.");
      }

      const normalizedEnhancedInstruction = normalizeEnhancedInstructionResponse(
        rawEnhancedInstruction,
      );
      const formatValidation = validateEnhancedInstructionFormat(
        normalizedEnhancedInstruction,
        instructionExtension,
      );
      if (!formatValidation.ok) {
        throw new Error(formatValidation.error);
      }

      const languageValidation = validateInstructionLanguagePreserved(
        currentInstruction,
        normalizedEnhancedInstruction,
      );
      if (!languageValidation.ok) {
        throw new Error(languageValidation.error);
      }

      const completenessValidation = validateEnhancedInstructionCompleteness(
        normalizedEnhancedInstruction,
      );
      if (!completenessValidation.ok) {
        throw new Error(completenessValidation.error);
      }

      if (normalizedEnhancedInstruction === currentInstruction) {
        setInstructionEnhanceSuccess("No changes were suggested.");
        return;
      }

      setInstructionEnhanceComparison({
        original: currentInstruction,
        enhanced: normalizedEnhancedInstruction,
        extension: instructionExtension,
        language: instructionLanguage,
        diffLines: buildInstructionDiffLines(currentInstruction, normalizedEnhancedInstruction),
      });
      setInstructionFileError(null);
      setInstructionSaveError(null);
      setInstructionSaveSuccess(null);
      setInstructionEnhanceSuccess("Review the diff and choose which version to adopt.");
    } catch (enhanceError) {
      setInstructionEnhanceError(
        enhanceError instanceof Error ? enhanceError.message : "Failed to enhance instruction.",
      );
    } finally {
      setIsEnhancingInstruction(false);
    }
  }

  function handleAdoptEnhancedInstruction() {
    if (!instructionEnhanceComparison) {
      return;
    }

    setAgentInstruction(instructionEnhanceComparison.enhanced);
    setInstructionEnhanceComparison(null);
    setInstructionEnhanceError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceSuccess("Enhanced instruction applied.");
  }

  function handleAdoptOriginalInstruction() {
    if (!instructionEnhanceComparison) {
      return;
    }

    setAgentInstruction(instructionEnhanceComparison.original);
    setInstructionEnhanceComparison(null);
    setInstructionEnhanceError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceSuccess("Kept original instruction.");
  }

  async function handleAddMcpServer() {
    const rawName = mcpNameInput.trim();
    setMcpFormError(null);
    setMcpFormWarning(null);

    let serverToAdd: McpServerConfig;

    if (mcpTransport === "stdio") {
      const command = mcpCommandInput.trim();
      if (!command) {
        setMcpFormError("MCP stdio command is required.");
        return;
      }

      if (/\s/.test(command)) {
        setMcpFormError("MCP stdio command must not include spaces.");
        return;
      }

      const argsResult = parseStdioArgsInput(mcpArgsInput);
      if (!argsResult.ok) {
        setMcpFormError(argsResult.error);
        return;
      }

      const envResult = parseStdioEnvInput(mcpEnvInput);
      if (!envResult.ok) {
        setMcpFormError(envResult.error);
        return;
      }

      const cwd = mcpCwdInput.trim();
      const name = rawName || command;

      serverToAdd = {
        name,
        transport: "stdio",
        command,
        args: argsResult.value,
        cwd: cwd || undefined,
        env: envResult.value,
        id: createId("mcp"),
      };
    } else {
      const rawUrl = mcpUrlInput.trim();
      if (!rawUrl) {
        setMcpFormError("MCP server URL is required.");
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        setMcpFormError("MCP server URL is invalid.");
        return;
      }

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setMcpFormError("MCP server URL must start with http:// or https://.");
        return;
      }

      const name = rawName || parsed.hostname;
      if (!name) {
        setMcpFormError("MCP server name is required.");
        return;
      }

      const normalizedUrl = parsed.toString();
      const headersResult = parseHttpHeadersInput(mcpHeadersInput);
      if (!headersResult.ok) {
        setMcpFormError(headersResult.error);
        return;
      }

      let azureAuthScope = DEFAULT_MCP_AZURE_AUTH_SCOPE;
      if (mcpUseAzureAuthInput) {
        const scopeResult = parseAzureAuthScopeInput(mcpAzureAuthScopeInput);
        if (!scopeResult.ok) {
          setMcpFormError(scopeResult.error);
          return;
        }
        azureAuthScope = scopeResult.value;
      }
      const timeoutResult = parseMcpTimeoutSecondsInput(mcpTimeoutSecondsInput);
      if (!timeoutResult.ok) {
        setMcpFormError(timeoutResult.error);
        return;
      }

      serverToAdd = {
        id: createId("mcp"),
        name,
        url: normalizedUrl,
        transport: mcpTransport,
        headers: headersResult.value,
        useAzureAuth: mcpUseAzureAuthInput,
        azureAuthScope,
        timeoutSeconds: timeoutResult.value,
      };
    }

    const existingServerIndex = mcpServers.findIndex(
      (server) => buildMcpServerKey(server) === buildMcpServerKey(serverToAdd),
    );
    const existingServerName =
      existingServerIndex >= 0 ? (mcpServers[existingServerIndex]?.name ?? "") : "";

    setIsSavingMcpServer(true);
    let saveWarning: string | null = null;
    let savedProfileName = serverToAdd.name;
    try {
      const saveResult = await saveMcpServerToConfig(serverToAdd);
      saveWarning = saveResult.warning;
      savedProfileName = saveResult.profile.name;

      if (existingServerIndex >= 0) {
        setMcpServers((current) =>
          current.map((server, index) =>
            index === existingServerIndex ? { ...server, name: savedProfileName } : server,
          ),
        );
      } else {
        setMcpServers((current) => [...current, { ...serverToAdd, name: savedProfileName }]);
      }

      setSavedMcpError(null);
    } catch (saveError) {
      setMcpFormError(saveError instanceof Error ? saveError.message : "Failed to save MCP server.");
      return;
    } finally {
      setIsSavingMcpServer(false);
    }

    setMcpFormError(null);
    if (existingServerIndex >= 0) {
      const fallbackLocalWarning =
        existingServerName && existingServerName !== savedProfileName
          ? `An MCP server with the same configuration already exists. Renamed it from "${existingServerName}" to "${savedProfileName}".`
          : "An MCP server with the same configuration already exists. Reused the existing entry.";
      setMcpFormWarning(saveWarning ?? fallbackLocalWarning);
    } else {
      setMcpFormWarning(saveWarning);
    }
    setMcpNameInput("");
    setMcpUrlInput("");
    setMcpCommandInput("");
    setMcpArgsInput("");
    setMcpCwdInput("");
    setMcpEnvInput("");
    setMcpHeadersInput("");
    setMcpUseAzureAuthInput(false);
    setMcpAzureAuthScopeInput(DEFAULT_MCP_AZURE_AUTH_SCOPE);
    setMcpTimeoutSecondsInput(String(DEFAULT_MCP_TIMEOUT_SECONDS));
    setMcpTransport(DEFAULT_MCP_TRANSPORT);
  }

  function handleLoadSavedMcpServerToForm() {
    if (!selectedSavedMcpServerId) {
      setSavedMcpError("Select a saved MCP server first.");
      return;
    }

    const selected = savedMcpServers.find((server) => server.id === selectedSavedMcpServerId);
    if (!selected) {
      setSavedMcpError("Selected MCP server is not available.");
      return;
    }

    setMcpNameInput(selected.name);
    setMcpTransport(selected.transport);
    setMcpFormError(null);
    setMcpFormWarning(null);

    if (selected.transport === "stdio") {
      setMcpCommandInput(selected.command);
      setMcpArgsInput(formatStdioArgsInput(selected.args));
      setMcpCwdInput(selected.cwd ?? "");
      setMcpEnvInput(formatKeyValueLines(selected.env));
      setMcpUrlInput("");
      setMcpHeadersInput("");
      setMcpUseAzureAuthInput(false);
      setMcpAzureAuthScopeInput(DEFAULT_MCP_AZURE_AUTH_SCOPE);
      setMcpTimeoutSecondsInput(String(DEFAULT_MCP_TIMEOUT_SECONDS));
    } else {
      setMcpUrlInput(selected.url);
      setMcpHeadersInput(formatKeyValueLines(selected.headers));
      setMcpUseAzureAuthInput(selected.useAzureAuth);
      setMcpAzureAuthScopeInput(selected.azureAuthScope);
      setMcpTimeoutSecondsInput(String(selected.timeoutSeconds));
      setMcpCommandInput("");
      setMcpArgsInput("");
      setMcpCwdInput("");
      setMcpEnvInput("");
    }

    setSavedMcpError(null);
  }

  function handleRemoveMcpServer(id: string) {
    setMcpServers((current) => current.filter((server) => server.id !== id));
  }

  function handleResetThread() {
    if (isSending) {
      return;
    }

    setMessages(INITIAL_MESSAGES);
    setMcpRpcHistory([]);
    setDraft("");
    setError(null);
    setActiveTurnId(null);
    setLastErrorTurnId(null);
    setSendProgressMessages([]);
    setIsComposing(false);
  }

  function handleMainSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const layoutElement = layoutRef.current;
    if (!layoutElement) {
      return;
    }

    const rect = layoutElement.getBoundingClientRect();
    const minRightWidth = 320;
    const minLeftWidth = 560;
    const maxRightWidth = Math.max(minRightWidth, rect.width - minLeftWidth);
    setActiveResizeHandle("main");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextRightWidth = rect.right - moveEvent.clientX;
      setRightPaneWidth(clampNumber(nextRightWidth, minRightWidth, maxRightWidth));
    };

    const stopResizing = () => {
      setActiveResizeHandle(null);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);
  }

  function handleChatAzureSelectorAction(target: "project" | "deployment") {
    if (
      isSending ||
      isStartingAzureLogin ||
      isStartingAzureLogout ||
      isLoadingAzureConnections ||
      isLoadingAzureDeployments
    ) {
      return;
    }

    setError(null);
    setAzureLoginError(null);

    if (isAzureAuthRequired) {
      void handleAzureLogin();
      return;
    }

    const needsProjectReload = azureConnections.length === 0 || !activeAzureConnection;
    const needsDeploymentReload =
      target === "deployment" &&
      (!activeAzureConnection || azureDeployments.length === 0 || !selectedAzureDeploymentName.trim());

    if (needsProjectReload || needsDeploymentReload) {
      void loadAzureConnections();
    }
  }

  const handleCopyMessage = (content: string) => {
    void copyTextToClipboard(content).catch(() => {
      setError("Failed to copy message to clipboard.");
    });
  };

  const handleCopyMcpLog = (text: string) => {
    void copyTextToClipboard(text).catch(() => {
      setError("Failed to copy MCP log to clipboard.");
    });
  };

  const settingsTabProps = {
    azureConnectionSectionProps: {
      isAzureAuthRequired,
      isSending,
      isStartingAzureLogin,
      onAzureLogin: handleAzureLogin,
      isLoadingAzureConnections,
      isLoadingAzureDeployments,
      activeAzureConnection,
      selectedAzureDeploymentName,
      isStartingAzureLogout,
      onAzureLogout: handleAzureLogout,
      azureDeploymentError,
      azureLogoutError,
      azureConnectionError,
    },
    instructionSectionProps: {
      agentInstruction,
      instructionEnhanceComparison,
      describeInstructionLanguage,
      isSending,
      isEnhancingInstruction,
      isSavingInstructionPrompt,
      canSaveAgentInstructionPrompt,
      canEnhanceAgentInstruction,
      canClearAgentInstruction,
      loadedInstructionFileName,
      instructionFileInputRef,
      instructionFileError,
      instructionSaveError,
      instructionSaveSuccess,
      instructionEnhanceError,
      instructionEnhanceSuccess,
      onAgentInstructionChange: handleAgentInstructionChange,
      onInstructionFileChange: handleInstructionFileChange,
      onSaveInstructionPrompt: handleSaveInstructionPrompt,
      onEnhanceInstruction: handleEnhanceInstruction,
      onClearInstruction: handleClearInstruction,
      onAdoptEnhancedInstruction: handleAdoptEnhancedInstruction,
      onAdoptOriginalInstruction: handleAdoptOriginalInstruction,
    },
  };

  const mcpServersTabProps = {
    selectedSavedMcpServerId,
    savedMcpServerOptions,
    isSending,
    isLoadingSavedMcpServers,
    savedMcpError,
    onSelectedSavedMcpServerIdChange: (value: string) => {
      setSelectedSavedMcpServerId(value);
      setSavedMcpError(null);
    },
    onLoadSavedMcpServerToForm: handleLoadSavedMcpServerToForm,
    onReloadSavedMcpServers: loadSavedMcpServers,
    mcpNameInput,
    onMcpNameInputChange: setMcpNameInput,
    mcpTransport,
    onMcpTransportChange: (value: McpTransport) => {
      setMcpTransport(value);
      setMcpFormError(null);
    },
    mcpCommandInput,
    onMcpCommandInputChange: setMcpCommandInput,
    mcpArgsInput,
    onMcpArgsInputChange: setMcpArgsInput,
    mcpCwdInput,
    onMcpCwdInputChange: setMcpCwdInput,
    mcpEnvInput,
    onMcpEnvInputChange: setMcpEnvInput,
    mcpUrlInput,
    onMcpUrlInputChange: setMcpUrlInput,
    mcpHeadersInput,
    onMcpHeadersInputChange: setMcpHeadersInput,
    mcpUseAzureAuthInput,
    onMcpUseAzureAuthInputChange: (checked: boolean) => {
      setMcpUseAzureAuthInput(checked);
      if (checked && !mcpAzureAuthScopeInput.trim()) {
        setMcpAzureAuthScopeInput(DEFAULT_MCP_AZURE_AUTH_SCOPE);
      }
    },
    mcpAzureAuthScopeInput,
    onMcpAzureAuthScopeInputChange: setMcpAzureAuthScopeInput,
    mcpTimeoutSecondsInput,
    onMcpTimeoutSecondsInputChange: setMcpTimeoutSecondsInput,
    defaultMcpAzureAuthScope: DEFAULT_MCP_AZURE_AUTH_SCOPE,
    defaultMcpTimeoutSeconds: DEFAULT_MCP_TIMEOUT_SECONDS,
    minMcpTimeoutSeconds: MIN_MCP_TIMEOUT_SECONDS,
    maxMcpTimeoutSeconds: MAX_MCP_TIMEOUT_SECONDS,
    onAddMcpServer: handleAddMcpServer,
    isSavingMcpServer,
    mcpFormError,
    mcpFormWarning,
  };

  const playgroundPanelProps = {
    messages,
    mcpHistoryByTurnId,
    isSending,
    onResetThread: handleResetThread,
    renderMessageContent,
    renderTurnMcpLog,
    onCopyMessage: handleCopyMessage,
    onCopyMcpLog: handleCopyMcpLog,
    sendProgressMessages,
    activeTurnMcpHistory,
    errorTurnMcpHistory,
    endOfMessagesRef,
    error,
    azureLoginError,
    onSubmit: handleSubmit,
    chatInputRef,
    draft,
    onDraftChange: handleDraftChange,
    onInputKeyDown: handleInputKeyDown,
    onCompositionStart: () => setIsComposing(true),
    onCompositionEnd: () => setIsComposing(false),
    isChatLocked,
    isLoadingAzureConnections,
    isLoadingAzureDeployments,
    isAzureAuthRequired,
    isStartingAzureLogin,
    isStartingAzureLogout,
    onChatAzureSelectorAction: handleChatAzureSelectorAction,
    azureConnections,
    activeAzureConnectionId: activeAzureConnection?.id ?? "",
    onProjectChange: handleChatProjectChange,
    selectedAzureDeploymentName,
    azureDeployments,
    onDeploymentChange: handleChatDeploymentChange,
    reasoningEffort,
    reasoningEffortOptions: REASONING_EFFORT_OPTIONS,
    onReasoningEffortChange: setReasoningEffort,
    contextWindowValidation,
    contextWindowInput,
    onContextWindowInputChange: setContextWindowInput,
    minContextWindowSize: MIN_CONTEXT_WINDOW_SIZE,
    maxContextWindowSize: MAX_CONTEXT_WINDOW_SIZE,
    canSendMessage,
    mcpServers,
    onRemoveMcpServer: handleRemoveMcpServer,
  };

  return (
    <main className="chat-page">
      <div
        className="chat-layout workspace-layout"
        ref={layoutRef}
        style={
          {
            "--right-pane-width": `${rightPaneWidth}px`,
          } as CSSProperties
        }
      >
        <PlaygroundPanel {...playgroundPanelProps} />

        <div
          className={`layout-splitter main-splitter ${
            activeResizeHandle === "main" ? "resizing" : ""
          }`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panels"
          title="Drag to resize Playground and side panels."
          onPointerDown={handleMainSplitterPointerDown}
        />

        <ConfigPanel
          activeMainTab={activeMainTab}
          onMainTabChange={setActiveMainTab}
          isChatLocked={isChatLocked}
          settingsTabProps={settingsTabProps}
          mcpServersTabProps={mcpServersTabProps}
        />
      </div>
    </main>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

async function readChatEventStreamPayload(
  response: Response,
  handlers: {
    onProgress: (message: string) => void;
    onMcpRpcRecord: (entry: McpRpcHistoryEntry) => void;
  },
): Promise<ChatApiResponse> {
  if (!response.body) {
    return {
      error: "The server returned an empty stream.",
    };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalPayload: ChatApiResponse = {};

  const readChunk = (chunk: string) => {
    buffer += chunk;
    buffer = buffer.replace(/\r\n/g, "\n");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex >= 0) {
      const block = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);

      const data = parseSseDataBlock(block);
      if (data) {
        const event = readChatStreamEvent(data);
        if (event) {
          if (event.type === "progress") {
            handlers.onProgress(event.message);
          } else if (event.type === "mcp_rpc") {
            handlers.onMcpRpcRecord(event.record);
          } else if (event.type === "final") {
            finalPayload = { message: event.message };
          } else if (event.type === "error") {
            finalPayload = {
              error: event.error,
              ...(event.errorCode ? { errorCode: event.errorCode } : {}),
            };
          }
        }
      }

      separatorIndex = buffer.indexOf("\n\n");
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    readChunk(decoder.decode(value, { stream: true }));
  }

  const tail = decoder.decode();
  if (tail) {
    readChunk(tail);
  }

  return finalPayload.message || finalPayload.error
    ? finalPayload
    : { error: "The server returned an empty stream response." };
}

export function parseSseDataBlock(block: string): string | null {
  const lines = block.split("\n");
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n").trim();
}

export function readChatStreamEvent(data: string): (
  | { type: "progress"; message: string }
  | { type: "final"; message: string }
  | { type: "error"; error: string; errorCode?: "azure_login_required" }
  | { type: "mcp_rpc"; record: McpRpcHistoryEntry }
) | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  if (parsed.type === "progress") {
    const message = typeof parsed.message === "string" ? parsed.message.trim() : "";
    if (!message) {
      return null;
    }
    return {
      type: "progress",
      message,
    };
  }

  if (parsed.type === "final") {
    const message = typeof parsed.message === "string" ? parsed.message : "";
    if (!message) {
      return null;
    }
    return {
      type: "final",
      message,
    };
  }

  if (parsed.type === "error") {
    const error = typeof parsed.error === "string" ? parsed.error : "Failed to send message.";
    return {
      type: "error",
      error,
      ...(parsed.errorCode === "azure_login_required"
        ? { errorCode: parsed.errorCode }
        : {}),
    };
  }

  if (parsed.type === "mcp_rpc") {
    const record = readMcpRpcHistoryEntryFromUnknown(parsed.record);
    if (!record) {
      return null;
    }

    return {
      type: "mcp_rpc",
      record,
    };
  }

  return null;
}

export function readMcpRpcHistoryEntryFromUnknown(value: unknown): McpRpcHistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const sequence = typeof value.sequence === "number" ? value.sequence : Number.NaN;
  const serverName = typeof value.serverName === "string" ? value.serverName.trim() : "";
  const method = typeof value.method === "string" ? value.method.trim() : "";
  const startedAt = typeof value.startedAt === "string" ? value.startedAt.trim() : "";
  const completedAt = typeof value.completedAt === "string" ? value.completedAt.trim() : "";
  const isError = value.isError === true;

  if (
    !id ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !serverName ||
    !method ||
    !startedAt ||
    !completedAt
  ) {
    return null;
  }

  return {
    id,
    sequence,
    serverName,
    method,
    startedAt,
    completedAt,
    request: "request" in value ? value.request : null,
    response: "response" in value ? value.response : null,
    isError,
    turnId: "",
  };
}

export function upsertMcpRpcHistoryEntry(
  current: McpRpcHistoryEntry[],
  entry: McpRpcHistoryEntry,
): McpRpcHistoryEntry[] {
  const filtered = current.filter((existing) => existing.id !== entry.id);
  const next = [...filtered, entry];
  next.sort((left, right) => {
    const timeOrder = left.startedAt.localeCompare(right.startedAt);
    if (timeOrder !== 0) {
      return timeOrder;
    }
    return left.sequence - right.sequence;
  });
  return next;
}

function buildMcpHistoryByTurnId(
  entries: McpRpcHistoryEntry[],
): Map<string, McpRpcHistoryEntry[]> {
  const byTurnId = new Map<string, McpRpcHistoryEntry[]>();
  for (const entry of entries) {
    if (!entry.turnId) {
      continue;
    }

    const current = byTurnId.get(entry.turnId) ?? [];
    current.push(entry);
    byTurnId.set(entry.turnId, current);
  }
  return byTurnId;
}

function appendProgressMessage(
  message: string,
  setMessages: Dispatch<SetStateAction<string[]>>,
): void {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }

  setMessages((current) => {
    if (current[current.length - 1] === trimmed) {
      return current;
    }

    const next = [...current, trimmed];
    return next.slice(-8);
  });
}

function renderTurnMcpLog(
  entries: McpRpcHistoryEntry[],
  isLive: boolean,
  onCopyText: (text: string) => void,
) {
  return (
    <details className="mcp-turn-log">
      <summary>
        <span>🧩 MCP Operation Log ({entries.length})</span>
        <CopyIconButton
          className="mcp-log-copy-btn"
          ariaLabel="Copy MCP operation log"
          title="Copy all MCP operation logs in this turn."
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onCopyText(
              formatJsonForDisplay(
                entries.map((entry) => buildMcpEntryCopyPayload(entry)),
              ),
            );
          }}
        />
      </summary>
      {entries.length === 0 ? (
        <p className="mcp-turn-log-empty">
          {isLive ? "Waiting for MCP operations..." : "No MCP operations in this turn."}
        </p>
      ) : (
        <div className="mcp-history-list">
          {entries.map((entry) => (
            <details key={entry.id} className="mcp-history-item">
              <summary>
                <span className="mcp-history-seq">#{entry.sequence}</span>
                <span className="mcp-history-method">{entry.method}</span>
                <span className="mcp-history-server">{entry.serverName}</span>
                <span className={`mcp-history-state ${entry.isError ? "error" : "ok"}`}>
                  {entry.isError ? "error" : "ok"}
                </span>
                <CopyIconButton
                  className="mcp-history-copy-btn"
                  ariaLabel="Copy MCP operation entry"
                  title="Copy this MCP operation entry."
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCopyText(formatJsonForDisplay(buildMcpEntryCopyPayload(entry)));
                  }}
                />
              </summary>
              <div className="mcp-history-body">
                <p className="mcp-history-time">
                  {entry.startedAt}
                  {" -> "}
                  {entry.completedAt}
                </p>
                <p className="mcp-history-label-row">
                  <span className="mcp-history-label">request</span>
                  <CopyIconButton
                    className="mcp-part-copy-btn"
                    ariaLabel="Copy MCP request payload"
                    title="Copy MCP request payload."
                    onClick={() => {
                      onCopyText(
                        formatJsonForDisplay({
                          request: entry.request ?? null,
                        }),
                      );
                    }}
                  />
                </p>
                {renderHighlightedJson(entry.request, "MCP request JSON", "compact")}
                <p className="mcp-history-label-row">
                  <span className="mcp-history-label">response</span>
                  <CopyIconButton
                    className="mcp-part-copy-btn"
                    ariaLabel="Copy MCP response payload"
                    title="Copy MCP response payload."
                    onClick={() => {
                      onCopyText(
                        formatJsonForDisplay({
                          response: entry.response ?? null,
                        }),
                      );
                    }}
                  />
                </p>
                {renderHighlightedJson(entry.response, "MCP response JSON", "compact")}
              </div>
            </details>
          ))}
        </div>
      )}
    </details>
  );
}

function renderHighlightedJson(
  value: unknown,
  ariaLabel: string,
  style: JsonHighlightStyle,
) {
  const formatted = formatJsonForDisplay(value);
  const tokens = tokenizeJson(formatted);
  return renderJsonTokens(tokens, ariaLabel, style);
}

function formatJsonForDisplay(value: unknown): string {
  const normalizedValue = normalizeJsonStringValue(value);
  try {
    return JSON.stringify(normalizedValue, null, 2);
  } catch {
    return String(normalizedValue);
  }
}

function normalizeJsonStringValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function createMessage(role: ChatRole, content: string, turnId: string): ChatMessage {
  const randomPart = Math.random().toString(36).slice(2);
  return {
    id: `${role}-${Date.now()}-${randomPart}`,
    role,
    content,
    turnId,
  };
}

const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["none", "low", "medium", "high"];
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function readTenantIdFromUnknown(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readAzureSelectionFromUnknown(
  value: unknown,
  expectedTenantId: string,
): AzureSelectionPreference | null {
  if (!isRecord(value)) {
    return null;
  }

  const tenantId = typeof value.tenantId === "string" ? value.tenantId.trim() : "";
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : "";
  const deploymentName = typeof value.deploymentName === "string" ? value.deploymentName.trim() : "";
  if (!tenantId || !projectId || !deploymentName) {
    return null;
  }

  if (expectedTenantId && tenantId !== expectedTenantId) {
    return null;
  }

  return {
    tenantId,
    projectId,
    deploymentName,
  };
}

function readAzureProjectList(value: unknown): AzureConnectionOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const projects: AzureConnectionOption[] = [];
  for (const entry of value) {
    const project = readAzureProjectFromUnknown(entry);
    if (!project) {
      continue;
    }

    projects.push(project);
  }

  return projects;
}

function readAzureProjectFromUnknown(value: unknown): AzureConnectionOption | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  const projectName = typeof value.projectName === "string" ? value.projectName.trim() : "";
  const baseUrl = typeof value.baseUrl === "string" ? value.baseUrl.trim() : "";
  const apiVersion = typeof value.apiVersion === "string" ? value.apiVersion.trim() : "";

  if (!id || !projectName || !baseUrl || !apiVersion) {
    return null;
  }

  return {
    id,
    projectName,
    baseUrl,
    apiVersion,
  };
}

function readAzureDeploymentList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStringsCaseInsensitive(
    value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean),
  );
}

function uniqueStringsCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(value);
  }

  return unique;
}

function buildMcpServerKey(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    const argsKey = server.args.join("\u0000");
    const cwdKey = (server.cwd ?? "").toLowerCase();
    const envKey = Object.entries(server.env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("\u0000");
    return `stdio:${server.command.toLowerCase()}:${argsKey}:${cwdKey}:${envKey}`;
  }

  const headersKey = buildHttpHeadersKey(server.headers);
  const authKey = server.useAzureAuth ? "azure-auth:on" : "azure-auth:off";
  const scopeKey = server.useAzureAuth ? server.azureAuthScope.toLowerCase() : "";
  return `${server.transport}:${server.url.toLowerCase()}:${headersKey}:${authKey}:${scopeKey}:${server.timeoutSeconds}`;
}

function parseStdioArgsInput(input: string): ParseResult<string[]> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: [] };
  }

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error: "Args must be space-separated text or a JSON string array.",
      };
    }

    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === "string")) {
      return {
        ok: false,
        error: "Args JSON must be an array of strings.",
      };
    }

    return { ok: true, value: parsed.map((entry) => entry.trim()).filter(Boolean) };
  }

  return {
    ok: true,
    value: trimmed.split(/\s+/).filter(Boolean),
  };
}

function parseStdioEnvInput(input: string): ParseResult<Record<string, string>> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  const env: Record<string, string> = {};
  const lines = input.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed) {
      continue;
    }

    const separatorIndex = lineTrimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return {
        ok: false,
        error: `ENV line ${index + 1} must use KEY=value format.`,
      };
    }

    const key = lineTrimmed.slice(0, separatorIndex).trim();
    const value = lineTrimmed.slice(separatorIndex + 1);

    if (!ENV_KEY_PATTERN.test(key)) {
      return {
        ok: false,
        error: `ENV line ${index + 1} has invalid key.`,
      };
    }

    env[key] = value;
  }

  return { ok: true, value: env };
}

export function parseHttpHeadersInput(input: string): ParseResult<Record<string, string>> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  const headers: Record<string, string> = {};
  const lines = input.split(/\r?\n/);
  let count = 0;

  for (const [index, line] of lines.entries()) {
    const lineTrimmed = line.trim();
    if (!lineTrimmed) {
      continue;
    }

    const separatorIndex = lineTrimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return {
        ok: false,
        error: `Header line ${index + 1} must use KEY=value format.`,
      };
    }

    const key = lineTrimmed.slice(0, separatorIndex).trim();
    const value = lineTrimmed.slice(separatorIndex + 1).trim();
    if (!HTTP_HEADER_NAME_PATTERN.test(key)) {
      return {
        ok: false,
        error: `Header line ${index + 1} has invalid key.`,
      };
    }

    if (key.toLowerCase() === "content-type") {
      return {
        ok: false,
        error: 'Header line cannot override "Content-Type". It is fixed to "application/json".',
      };
    }

    headers[key] = value;
    count += 1;
    if (count > MAX_MCP_HTTP_HEADERS) {
      return {
        ok: false,
        error: `Headers can include up to ${MAX_MCP_HTTP_HEADERS} entries.`,
      };
    }
  }

  return { ok: true, value: headers };
}

export function parseAzureAuthScopeInput(input: string): ParseResult<string> {
  const trimmed = input.trim();
  const scope = trimmed || DEFAULT_MCP_AZURE_AUTH_SCOPE;
  if (scope.length > MAX_MCP_AZURE_AUTH_SCOPE_LENGTH) {
    return {
      ok: false,
      error: `Azure auth scope must be ${MAX_MCP_AZURE_AUTH_SCOPE_LENGTH} characters or fewer.`,
    };
  }

  if (/\s/.test(scope)) {
    return {
      ok: false,
      error: "Azure auth scope must not include spaces.",
    };
  }

  return { ok: true, value: scope };
}

export function parseMcpTimeoutSecondsInput(input: string): ParseResult<number> {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: DEFAULT_MCP_TIMEOUT_SECONDS };
  }

  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    return {
      ok: false,
      error: "MCP timeout must be an integer number of seconds.",
    };
  }

  if (parsed < MIN_MCP_TIMEOUT_SECONDS || parsed > MAX_MCP_TIMEOUT_SECONDS) {
    return {
      ok: false,
      error: `MCP timeout must be between ${MIN_MCP_TIMEOUT_SECONDS} and ${MAX_MCP_TIMEOUT_SECONDS} seconds.`,
    };
  }

  return { ok: true, value: parsed };
}

function formatStdioArgsInput(args: string[]): string {
  if (args.length === 0) {
    return "";
  }
  return JSON.stringify(args);
}

function formatKeyValueLines(entries: Record<string, string>): string {
  return Object.entries(entries)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function readMcpServerList(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const servers: McpServerConfig[] = [];
  for (const entry of value) {
    const server = readMcpServerFromUnknown(entry);
    if (!server) {
      continue;
    }
    servers.push(server);
  }

  return servers;
}

function readMcpServerFromUnknown(value: unknown): McpServerConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!id) {
    return null;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    return null;
  }

  const transport = value.transport;
  if (transport === "stdio") {
    const command = typeof value.command === "string" ? value.command.trim() : "";
    if (!command) {
      return null;
    }

    if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) {
      return null;
    }

    const envValue = value.env;
    if (!isRecord(envValue) || !Object.values(envValue).every((entry) => typeof entry === "string")) {
      return null;
    }

    return {
      id,
      name,
      transport,
      command,
      args: value.args.map((arg) => arg.trim()).filter(Boolean),
      cwd: typeof value.cwd === "string" && value.cwd.trim() ? value.cwd.trim() : undefined,
      env: Object.fromEntries(
        Object.entries(envValue)
          .filter(([key, entry]) => ENV_KEY_PATTERN.test(key) && typeof entry === "string")
          .map(([key, entry]) => [key, entry as string]),
      ),
    };
  }

  if (transport !== "streamable_http" && transport !== "sse") {
    return null;
  }

  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url) {
    return null;
  }

  const headers = readHttpHeadersFromUnknown(value.headers);
  if (headers === null) {
    return null;
  }

  return {
    id,
    name,
    transport,
    url,
    headers,
    useAzureAuth: value.useAzureAuth === true,
    azureAuthScope: readAzureAuthScopeFromUnknown(value.azureAuthScope),
    timeoutSeconds: readMcpTimeoutSecondsFromUnknown(value.timeoutSeconds),
  };
}

function serializeMcpServerForSave(server: McpServerConfig): SaveMcpServerRequest {
  if (server.transport === "stdio") {
    return {
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      cwd: server.cwd,
      env: server.env,
    };
  }

  return {
    name: server.name,
    transport: server.transport,
    url: server.url,
    headers: server.headers,
    useAzureAuth: server.useAzureAuth,
    azureAuthScope: server.azureAuthScope,
    timeoutSeconds: server.timeoutSeconds,
  };
}

function upsertMcpServer(current: McpServerConfig[], profile: McpServerConfig): McpServerConfig[] {
  const existingIndex = current.findIndex((entry) => entry.id === profile.id);
  if (existingIndex < 0) {
    return [...current, profile];
  }

  return current.map((entry, index) => (index === existingIndex ? profile : entry));
}

function formatMcpServerOption(server: McpServerConfig): string {
  if (server.transport === "stdio") {
    return `${server.name} (stdio: ${server.command})`;
  }

  const headerCount = Object.keys(server.headers).length;
  const azureAuthLabel = server.useAzureAuth ? `, Azure auth (${server.azureAuthScope})` : "";
  const timeoutLabel = `, timeout ${server.timeoutSeconds}s`;
  if (headerCount > 0) {
    return `${server.name} (${server.transport}, +${headerCount} headers${azureAuthLabel}${timeoutLabel})`;
  }
  return `${server.name} (${server.transport}${azureAuthLabel}${timeoutLabel})`;
}

function buildHttpHeadersKey(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), value] as const)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\u0000");
}

function readHttpHeadersFromUnknown(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) {
    return {};
  }

  if (!isRecord(value)) {
    return null;
  }

  const headers: Record<string, string> = {};
  let count = 0;
  for (const [key, rawValue] of Object.entries(value)) {
    if (!HTTP_HEADER_NAME_PATTERN.test(key)) {
      return null;
    }
    if (key.toLowerCase() === "content-type") {
      continue;
    }
    if (typeof rawValue !== "string") {
      return null;
    }

    headers[key] = rawValue;
    count += 1;
    if (count > MAX_MCP_HTTP_HEADERS) {
      return null;
    }
  }

  return headers;
}

function readAzureAuthScopeFromUnknown(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_MCP_AZURE_AUTH_SCOPE;
  }

  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return DEFAULT_MCP_AZURE_AUTH_SCOPE;
  }

  if (trimmed.length > MAX_MCP_AZURE_AUTH_SCOPE_LENGTH) {
    return DEFAULT_MCP_AZURE_AUTH_SCOPE;
  }

  return trimmed;
}

function readMcpTimeoutSecondsFromUnknown(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_MCP_TIMEOUT_SECONDS;
  }

  if (value < MIN_MCP_TIMEOUT_SECONDS || value > MAX_MCP_TIMEOUT_SECONDS) {
    return DEFAULT_MCP_TIMEOUT_SECONDS;
  }

  return value;
}

export function resolveInstructionSourceFileName(loadedFileName: string | null): string | null {
  const loaded = (loadedFileName ?? "").trim();
  return loaded || null;
}

export function buildInstructionSuggestedFileName(
  sourceFileName: string | null,
  instruction: string,
): string {
  const resolvedExtension = resolveInstructionFormatExtension(sourceFileName, instruction);
  const normalizedSource = normalizeInstructionFileNameCandidate(sourceFileName);
  if (!normalizedSource) {
    return `instruction.${resolvedExtension}`;
  }

  const sourceExtension = getFileExtension(normalizedSource);
  if (ALLOWED_INSTRUCTION_EXTENSIONS.has(sourceExtension)) {
    return normalizedSource;
  }

  const stem = stripFileExtension(normalizedSource);
  return `${stem || "instruction"}.${resolvedExtension}`;
}

async function saveInstructionToClientFile(
  instruction: string,
  suggestedFileName: string,
): Promise<SaveInstructionToClientFileResult> {
  const savePickerWindow = window as WindowWithSaveFilePicker;
  if (typeof savePickerWindow.showSaveFilePicker === "function") {
    const fileHandle = await savePickerWindow.showSaveFilePicker({
      suggestedName: suggestedFileName,
      types: INSTRUCTION_SAVE_FILE_TYPES,
    });
    const writable = await fileHandle.createWritable();
    await writable.write(instruction);
    await writable.close();
    return {
      fileName: fileHandle.name || suggestedFileName,
      mode: "picker",
    };
  }

  downloadInstructionFile(instruction, suggestedFileName);
  return {
    fileName: suggestedFileName,
    mode: "download",
  };
}

function downloadInstructionFile(instruction: string, fileName: string): void {
  const blob = new Blob([instruction], {
    type: resolveInstructionMimeType(fileName),
  });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(downloadUrl);
}

function resolveInstructionMimeType(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (extension === "json") {
    return "application/json;charset=utf-8";
  }

  if (extension === "xml") {
    return "application/xml;charset=utf-8";
  }

  if (extension === "md") {
    return "text/markdown;charset=utf-8";
  }

  return "text/plain;charset=utf-8";
}

function isInstructionSaveCanceled(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return error.name === "AbortError";
}

function normalizeInstructionFileNameCandidate(fileName: string | null): string {
  const candidate = (fileName ?? "").trim();
  if (!candidate) {
    return "";
  }

  const normalized = candidate.replace(/\\/g, "/");
  const lastSegment = normalized.slice(normalized.lastIndexOf("/") + 1);
  if (!lastSegment) {
    return "";
  }

  return lastSegment
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

function stripFileExtension(fileName: string): string {
  const extension = getFileExtension(fileName);
  if (!extension) {
    return fileName;
  }

  return fileName.slice(0, -(extension.length + 1));
}

export function resolveInstructionFormatExtension(
  sourceFileName: string | null,
  instruction: string,
): string {
  const sourceExtension = getFileExtension(sourceFileName ?? "");
  if (ALLOWED_INSTRUCTION_EXTENSIONS.has(sourceExtension)) {
    return sourceExtension;
  }

  const trimmedInstruction = instruction.trim();
  if (!trimmedInstruction) {
    return DEFAULT_INSTRUCTION_EXTENSION;
  }

  if (
    (trimmedInstruction.startsWith("{") || trimmedInstruction.startsWith("[")) &&
    canParseJson(trimmedInstruction)
  ) {
    return "json";
  }

  if (looksLikeXmlDocument(trimmedInstruction)) {
    return "xml";
  }

  if (looksLikeMarkdownText(trimmedInstruction)) {
    return "md";
  }

  return DEFAULT_INSTRUCTION_EXTENSION;
}

export function detectInstructionLanguage(value: string): InstructionLanguage {
  const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(value);
  const hasEnglish = /[A-Za-z]/.test(value);
  if (hasJapanese && hasEnglish) {
    return "mixed";
  }
  if (hasJapanese) {
    return "japanese";
  }
  if (hasEnglish) {
    return "english";
  }
  return "unknown";
}

export function buildInstructionEnhanceMessage(options: {
  instruction: string;
  extension: string;
  language: InstructionLanguage;
}): string {
  const languageLabel = describeInstructionLanguage(options.language);
  return [
    "Improve the following agent instruction.",
    "Requirements:",
    "- Remove contradictions and ambiguity.",
    "- Keep original intent, guardrails, and constraints.",
    "- Preserve as much original information as possible; avoid deleting details unless necessary.",
    "- Do not omit, summarize, or truncate sections. Keep all important details and examples.",
    "- Do not add placeholder comments/markers such as '省略', 'omitted', 'same as original', or equivalent.",
    "- Normalize and improve formatting for readability.",
    `- Preserve the original language (${languageLabel}).`,
    `- Preserve the original file format style for .${options.extension}.`,
    "- Return only the revised instruction text.",
    "",
    "<instruction>",
    options.instruction,
    "</instruction>",
  ].join("\n");
}

export function normalizeEnhancedInstructionResponse(value: string): string {
  return unwrapCodeFence(value).trim();
}

export function validateEnhancedInstructionFormat(
  instruction: string,
  extension: string,
): ParseResult<true> {
  const normalizedExtension = extension.trim().toLowerCase();
  if (normalizedExtension === "json" && !canParseJson(instruction.trim())) {
    return {
      ok: false,
      error: "Enhanced instruction is not valid JSON. Please retry.",
    };
  }

  if (normalizedExtension === "xml" && !looksLikeXmlDocument(instruction.trim())) {
    return {
      ok: false,
      error: "Enhanced instruction is not valid XML-like content. Please retry.",
    };
  }

  return { ok: true, value: true };
}

export function validateInstructionLanguagePreserved(
  originalInstruction: string,
  enhancedInstruction: string,
): ParseResult<true> {
  const originalLanguage = detectInstructionLanguage(originalInstruction);
  if (originalLanguage === "unknown" || originalLanguage === "mixed") {
    return { ok: true, value: true };
  }

  const enhancedHasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(
    enhancedInstruction,
  );
  const enhancedHasEnglish = /[A-Za-z]/.test(enhancedInstruction);

  if (originalLanguage === "japanese" && !enhancedHasJapanese) {
    return {
      ok: false,
      error: "Enhanced instruction changed language unexpectedly. Please retry.",
    };
  }

  if (originalLanguage === "english" && !enhancedHasEnglish) {
    return {
      ok: false,
      error: "Enhanced instruction changed language unexpectedly. Please retry.",
    };
  }

  return { ok: true, value: true };
}

export function validateEnhancedInstructionCompleteness(
  enhancedInstruction: string,
): ParseResult<true> {
  const omissionMarkerPatterns: RegExp[] = [
    /<!--[\s\S]{0,240}(省略|omitted|omit|same as original|for brevity|truncated|原文どおり)[\s\S]*?-->/i,
    /\[[^\]]{0,180}(省略|omitted|same as original|for brevity|truncated|原文どおり)[^\]]{0,180}\]/i,
    /\([^)]{0,180}(省略|omitted|same as original|for brevity|truncated|原文どおり)[^)]{0,180}\)/i,
    /(?:以下|以降).{0,40}(?:省略|同様)/i,
    /same as (?:original|above)/i,
    /for brevity/i,
  ];

  for (const pattern of omissionMarkerPatterns) {
    if (pattern.test(enhancedInstruction)) {
      return {
        ok: false,
        error:
          "Enhanced instruction appears to omit original content with placeholders/comments. Please retry.",
      };
    }
  }

  return { ok: true, value: true };
}

function describeInstructionLanguage(language: InstructionLanguage): string {
  if (language === "japanese") {
    return "Japanese";
  }
  if (language === "english") {
    return "English";
  }
  if (language === "mixed") {
    return "mixed language";
  }
  return "same language as source";
}

function canParseJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function looksLikeXmlDocument(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) {
    return false;
  }

  if (/^<([A-Za-z_][A-Za-z0-9:_.-]*)(?:\s[^>]*)?\/>\s*$/.test(trimmed)) {
    return true;
  }

  const firstTag = trimmed.match(/^<([A-Za-z_][A-Za-z0-9:_.-]*)(?:\s[^>]*)?>/);
  if (!firstTag) {
    return false;
  }

  const rootTagName = firstTag[1];
  if (new RegExp(`<\\/${rootTagName}>\\s*$`).test(trimmed)) {
    return true;
  }

  return /\/>\s*$/.test(trimmed);
}

function looksLikeMarkdownText(value: string): boolean {
  if (/^(#{1,6})\s/m.test(value)) {
    return true;
  }
  if (/```/.test(value)) {
    return true;
  }
  return /^\s*[-*+]\s/m.test(value);
}

function unwrapCodeFence(value: string): string {
  const trimmed = value.trim();
  const fenced = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n```$/);
  if (fenced) {
    return fenced[1];
  }

  const fencedWithoutTrailingNewLine = trimmed.match(/^```[^\n]*\n([\s\S]*?)```$/);
  if (fencedWithoutTrailingNewLine) {
    return fencedWithoutTrailingNewLine[1];
  }

  return value;
}

export function buildInstructionDiffLines(
  originalInstruction: string,
  enhancedInstruction: string,
  options: {
    maxMatrixCells?: number;
  } = {},
): InstructionDiffLine[] {
  const originalLines = splitInstructionLines(originalInstruction);
  const enhancedLines = splitInstructionLines(enhancedInstruction);
  const maxMatrixCells = options.maxMatrixCells ?? MAX_INSTRUCTION_DIFF_MATRIX_CELLS;
  const operations = computeInstructionDiffOperations(
    originalLines,
    enhancedLines,
    maxMatrixCells,
  );

  let oldLineNumber = 0;
  let newLineNumber = 0;
  const diffLines: InstructionDiffLine[] = [];
  for (const operation of operations) {
    if (operation.type === "context") {
      oldLineNumber += 1;
      newLineNumber += 1;
      diffLines.push({
        type: "context",
        oldLineNumber,
        newLineNumber,
        content: operation.content,
      });
      continue;
    }

    if (operation.type === "removed") {
      oldLineNumber += 1;
      diffLines.push({
        type: "removed",
        oldLineNumber,
        newLineNumber: null,
        content: operation.content,
      });
      continue;
    }

    newLineNumber += 1;
    diffLines.push({
      type: "added",
      oldLineNumber: null,
      newLineNumber,
      content: operation.content,
    });
  }

  if (diffLines.length > 0) {
    return diffLines;
  }

  return [
    {
      type: "context",
      oldLineNumber: 1,
      newLineNumber: 1,
      content: "",
    },
  ];
}

type InstructionDiffOperation = {
  type: "context" | "added" | "removed";
  content: string;
};

function computeInstructionDiffOperations(
  originalLines: string[],
  enhancedLines: string[],
  maxMatrixCells: number,
): InstructionDiffOperation[] {
  const totalMatrixCells = originalLines.length * enhancedLines.length;
  if (totalMatrixCells <= 0) {
    if (originalLines.length === 0 && enhancedLines.length === 0) {
      return [];
    }

    return [
      ...originalLines.map((content) => ({ type: "removed", content }) as InstructionDiffOperation),
      ...enhancedLines.map((content) => ({ type: "added", content }) as InstructionDiffOperation),
    ];
  }

  if (totalMatrixCells > maxMatrixCells) {
    return computeInstructionDiffOperationsFast(originalLines, enhancedLines);
  }

  const matrix: number[][] = Array.from({ length: originalLines.length + 1 }, () =>
    Array.from({ length: enhancedLines.length + 1 }, () => 0),
  );

  for (let i = originalLines.length - 1; i >= 0; i -= 1) {
    for (let j = enhancedLines.length - 1; j >= 0; j -= 1) {
      if (originalLines[i] === enhancedLines[j]) {
        matrix[i][j] = matrix[i + 1][j + 1] + 1;
      } else {
        matrix[i][j] = Math.max(matrix[i + 1][j], matrix[i][j + 1]);
      }
    }
  }

  const operations: InstructionDiffOperation[] = [];
  let oldCursor = 0;
  let newCursor = 0;
  while (oldCursor < originalLines.length && newCursor < enhancedLines.length) {
    if (originalLines[oldCursor] === enhancedLines[newCursor]) {
      operations.push({
        type: "context",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
      newCursor += 1;
      continue;
    }

    if (matrix[oldCursor + 1][newCursor] >= matrix[oldCursor][newCursor + 1]) {
      operations.push({
        type: "removed",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
      continue;
    }

    operations.push({
      type: "added",
      content: enhancedLines[newCursor],
    });
    newCursor += 1;
  }

  while (oldCursor < originalLines.length) {
    operations.push({
      type: "removed",
      content: originalLines[oldCursor],
    });
    oldCursor += 1;
  }

  while (newCursor < enhancedLines.length) {
    operations.push({
      type: "added",
      content: enhancedLines[newCursor],
    });
    newCursor += 1;
  }

  return operations;
}

function computeInstructionDiffOperationsFast(
  originalLines: string[],
  enhancedLines: string[],
): InstructionDiffOperation[] {
  const operations: InstructionDiffOperation[] = [];
  let oldCursor = 0;
  let newCursor = 0;
  while (oldCursor < originalLines.length || newCursor < enhancedLines.length) {
    const hasOld = oldCursor < originalLines.length;
    const hasNew = newCursor < enhancedLines.length;
    if (hasOld && hasNew && originalLines[oldCursor] === enhancedLines[newCursor]) {
      operations.push({
        type: "context",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
      newCursor += 1;
      continue;
    }

    if (hasOld) {
      operations.push({
        type: "removed",
        content: originalLines[oldCursor],
      });
      oldCursor += 1;
    }

    if (hasNew) {
      operations.push({
        type: "added",
        content: enhancedLines[newCursor],
      });
      newCursor += 1;
    }
  }

  return operations;
}

function splitInstructionLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, "\n");
  if (!normalized) {
    return [];
  }

  return normalized.split("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`;
}

function buildMcpEntryCopyPayload(entry: McpRpcHistoryEntry): Record<string, unknown> {
  return {
    id: entry.id,
    sequence: entry.sequence,
    serverName: entry.serverName,
    method: entry.method,
    startedAt: entry.startedAt,
    completedAt: entry.completedAt,
    request: entry.request ?? null,
    response: entry.response ?? null,
    isError: entry.isError,
    turnId: entry.turnId,
  };
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  if (typeof document === "undefined") {
    throw new Error("Clipboard API is not available.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) {
    throw new Error("Failed to copy text.");
  }
}

function renderMessageContent(message: ChatMessage) {
  if (message.role !== "assistant") {
    return <p>{message.content}</p>;
  }

  const jsonTokens = parseJsonMessageTokens(message.content);
  if (!jsonTokens) {
    return (
      <div className="markdown-message">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
            code: ({ className, children, ...props }) => {
              const isJsonCode = isJsonCodeClassName(className);
              if (!isJsonCode) {
                return (
                  <code className={className} {...props}>
                    {children}
                  </code>
                );
              }

              const rawText = String(children).replace(/\n$/, "");
              const tokens = parseJsonMessageTokens(rawText) ?? tokenizeJson(rawText);
              return (
                <code className={className} {...props}>
                  {tokens.map((token, index) => (
                    <span
                      key={`${token.type}-${index}`}
                      className={token.type === "plain" ? undefined : `json-token ${token.type}`}
                    >
                      {token.value}
                    </span>
                  ))}
                </code>
              );
            },
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    );
  }

  return renderJsonTokens(jsonTokens, "JSON response", "default");
}

function parseJsonMessageTokens(content: string): JsonToken[] | null {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  const formatted = JSON.stringify(parsed, null, 2);
  return tokenizeJson(formatted);
}

function renderJsonTokens(
  tokens: JsonToken[],
  ariaLabel: string,
  style: JsonHighlightStyle,
) {
  const className = style === "compact" ? "json-message mcp-history-json" : "json-message";
  return (
    <pre className={className} aria-label={ariaLabel}>
      {tokens.map((token, index) => (
        <span
          key={`${token.type}-${index}`}
          className={token.type === "plain" ? undefined : `json-token ${token.type}`}
        >
          {token.value}
        </span>
      ))}
    </pre>
  );
}

function isJsonCodeClassName(className: string | undefined): boolean {
  if (!className) {
    return false;
  }

  return /\blanguage-json\b/i.test(className) || /\blanguage-jsonc\b/i.test(className);
}

function tokenizeJson(input: string): JsonToken[] {
  const pattern =
    /"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}[\],:]/g;
  const tokens: JsonToken[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(pattern)) {
    const tokenIndex = match.index ?? 0;
    const tokenValue = match[0];

    if (tokenIndex > lastIndex) {
      tokens.push({
        value: input.slice(lastIndex, tokenIndex),
        type: "plain",
      });
    }

    tokens.push({
      value: tokenValue,
      type: classifyJsonToken(input, tokenIndex, tokenValue),
    });

    lastIndex = tokenIndex + tokenValue.length;
  }

  if (lastIndex < input.length) {
    tokens.push({
      value: input.slice(lastIndex),
      type: "plain",
    });
  }

  return tokens;
}

function classifyJsonToken(
  source: string,
  tokenIndex: number,
  tokenValue: string,
): JsonTokenType {
  if (tokenValue === "true" || tokenValue === "false") {
    return "boolean";
  }
  if (tokenValue === "null") {
    return "null";
  }
  if (/^-?\d/.test(tokenValue)) {
    return "number";
  }
  if (/^[\[\]{}:,]$/.test(tokenValue)) {
    return "punctuation";
  }
  if (tokenValue.startsWith('"')) {
    return isJsonKeyToken(source, tokenIndex, tokenValue.length) ? "key" : "string";
  }
  return "plain";
}

function isJsonKeyToken(source: string, tokenIndex: number, tokenLength: number): boolean {
  let cursor = tokenIndex + tokenLength;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }
  return source[cursor] === ":";
}
