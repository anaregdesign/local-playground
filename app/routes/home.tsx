import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import * as FluentUIComponents from "@fluentui/react-components";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Route } from "./+types/home";

function resolveFluentUIExports<T extends object>(moduleExports: T): T {
  const maybeDefault = Reflect.get(moduleExports, "default");
  if (maybeDefault && typeof maybeDefault === "object") {
    return maybeDefault as T;
  }

  return moduleExports;
}

const FluentUI = resolveFluentUIExports(FluentUIComponents);
const {
  Button,
  Checkbox,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Select,
  SpinButton,
  Spinner,
  Tab,
  TabList,
  Textarea,
  Tooltip,
} = FluentUI;

type ChatRole = "user" | "assistant";
type ReasoningEffort = "none" | "low" | "medium" | "high";
type McpTransport = "streamable_http" | "sse" | "stdio";
type MainViewTab = "settings" | "mcp";

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
type SaveInstructionPromptApiResponse = {
  fileName?: unknown;
  savedPath?: unknown;
  error?: string;
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
  const [instructionSaveFileNameInput, setInstructionSaveFileNameInput] = useState("");
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
    instructionSaveFileNameInput.trim().length > 0 ||
    loadedInstructionFileName !== null ||
    instructionFileError !== null;
  const canSaveAgentInstructionPrompt = agentInstruction.trim().length > 0;
  const canEnhanceAgentInstruction = agentInstruction.trim().length > 0;
  const mcpHistoryByTurnId = buildMcpHistoryByTurnId(mcpRpcHistory);
  const activeTurnMcpHistory = activeTurnId ? (mcpHistoryByTurnId.get(activeTurnId) ?? []) : [];
  const errorTurnMcpHistory = lastErrorTurnId ? (mcpHistoryByTurnId.get(lastErrorTurnId) ?? []) : [];

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

  function resizeChatInput(input: HTMLTextAreaElement) {
    input.style.height = "auto";
    const boundedHeight = Math.max(
      CHAT_INPUT_MIN_HEIGHT_PX,
      Math.min(input.scrollHeight, CHAT_INPUT_MAX_HEIGHT_PX),
    );
    input.style.height = `${boundedHeight}px`;
    input.style.overflowY = input.scrollHeight > CHAT_INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
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
      setInstructionSaveFileNameInput(file.name);
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
      const response = await fetch("/api/instruction-prompts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          instruction: agentInstruction,
          fileName: instructionSaveFileNameInput,
          sourceFileName: loadedInstructionFileName,
        }),
      });

      const payload = (await response.json()) as SaveInstructionPromptApiResponse;
      if (!response.ok) {
        const errorMessage =
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error
            : "Failed to save instruction prompt.";
        throw new Error(errorMessage);
      }

      const savedPath =
        typeof payload.savedPath === "string" && payload.savedPath.trim()
          ? payload.savedPath.trim()
          : "";
      if (savedPath) {
        setInstructionSaveSuccess(`Saved to ${savedPath}`);
      } else {
        setInstructionSaveSuccess("Saved instruction prompt.");
      }
    } catch (saveError) {
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

    const sourceFileName = resolveInstructionSourceFileName(
      loadedInstructionFileName,
      instructionSaveFileNameInput,
    );
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

  function renderUnifiedTooltipContent(title: string, lines: ReactNode[] = []) {
    return (
      <div className="app-tooltip-content">
        <p className="app-tooltip-title">{title}</p>
        {lines.map((line, index) => (
          <p key={`${title}-${index}`} className="app-tooltip-line">
            {line}
          </p>
        ))}
      </div>
    );
  }

  function renderUnifiedTooltip(
    title: string,
    lines: ReactNode[],
    child: ReactNode,
    className = "chat-tooltip-target",
  ) {
    return (
      <Tooltip
        relationship="description"
        showDelay={0}
        positioning="above-start"
        content={renderUnifiedTooltipContent(title, lines)}
      >
        <div className={className}>{child}</div>
      </Tooltip>
    );
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

  function handleChatAzureSelectorActionKeyDown(
    event: ReactKeyboardEvent<HTMLSelectElement>,
    target: "project" | "deployment",
  ) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    handleChatAzureSelectorAction(target);
  }

  function renderChatAzureActionSelect(
    target: "project" | "deployment",
    label: string,
    text: string,
    title: string,
  ) {
    const elementId =
      target === "project" ? "chat-azure-project-action" : "chat-azure-deployment-action";

    return (
      <Select
        id={elementId}
        aria-label={label}
        value=""
        onMouseDown={(event) => {
          event.preventDefault();
          handleChatAzureSelectorAction(target);
        }}
        onClick={(event) => {
          event.preventDefault();
          handleChatAzureSelectorAction(target);
        }}
        onKeyDown={(event) => {
          handleChatAzureSelectorActionKeyDown(event, target);
        }}
        disabled={isSending || isStartingAzureLogin || isStartingAzureLogout}
        title={title}
      >
        <option value="">{text}</option>
      </Select>
    );
  }

  function renderAddedMcpServersBubbles() {
    if (mcpServers.length === 0) {
      return null;
    }

    return (
      <section className="chat-mcp-strip" aria-label="Added MCP Servers">
        <div className="chat-mcp-bubbles">
          {mcpServers.map((server) => (
            <div key={server.id} className="chat-mcp-bubble-item">
              <Tooltip
                relationship="description"
                showDelay={0}
                positioning="above-start"
                content={renderUnifiedTooltipContent(
                  server.name,
                  server.transport === "stdio"
                    ? [
                        "Transport: stdio",
                        `Command: ${server.command}${server.args.length > 0 ? ` ${server.args.join(" ")}` : ""}`,
                        ...(server.cwd ? [`Working directory: ${server.cwd}`] : []),
                        `Environment variables: ${Object.keys(server.env).length}`,
                      ]
                    : [
                        `Transport: ${server.transport}`,
                        `URL: ${server.url}`,
                        `Custom headers: ${Object.keys(server.headers).length}`,
                        `Timeout: ${server.timeoutSeconds}s`,
                        `Azure auth: ${
                          server.useAzureAuth ? `enabled (${server.azureAuthScope})` : "disabled"
                        }`,
                      ],
                )}
              >
                <span className="chat-tooltip-target">
                  <span className="chat-mcp-bubble">
                    <span className="chat-mcp-bubble-name">{server.name}</span>
                    <Button
                      type="button"
                      appearance="subtle"
                      size="small"
                      className="chat-mcp-bubble-remove"
                      onClick={() => handleRemoveMcpServer(server.id)}
                      disabled={isSending}
                      aria-label={`Remove MCP server ${server.name}`}
                      title={`Remove ${server.name}`}
                    >
                      ×
                    </Button>
                  </span>
                </span>
              </Tooltip>
            </div>
          ))}
        </div>
      </section>
    );
  }

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
        <section className="chat-shell main-panel" aria-label="Playground">
          <header className="chat-header">
            <div className="chat-header-row">
              <div className="chat-header-main">
                <div className="chat-header-title">
                  <img
                    className="chat-header-symbol"
                    src="/foundry-symbol.svg"
                    alt=""
                    aria-hidden="true"
                  />
                  <h1>Local Playground</h1>
                </div>
              </div>
              <Button
                type="button"
                appearance="secondary"
                size="small"
                className="chat-reset-btn"
                onClick={handleResetThread}
                disabled={isSending}
                title="Clear all messages in the current thread."
              >
                🧹 Reset Thread
              </Button>
            </div>
          </header>

          <div className="chat-log" aria-live="polite">
            {messages.map((message) => {
              const turnMcpHistory = mcpHistoryByTurnId.get(message.turnId) ?? [];
              const shouldRenderTurnMcpLog =
                message.role === "assistant" && turnMcpHistory.length > 0;

              return (
                <Fragment key={message.id}>
                  <article
                    className={`message-row ${message.role === "user" ? "user" : "assistant"}`}
                  >
                    <div className="message-content">
                      {renderMessageContent(message)}
                    </div>
                    <Button
                      type="button"
                      appearance="transparent"
                      size="small"
                      className="copy-symbol-btn message-copy-btn"
                      aria-label="Copy message"
                      title="Copy this message."
                      onClick={() => {
                        void copyTextToClipboard(message.content).catch(() => {
                          setError("Failed to copy message to clipboard.");
                        });
                      }}
                    >
                      ⎘
                    </Button>
                  </article>
                  {shouldRenderTurnMcpLog ? (
                    <article className="mcp-turn-log-row">
                      {renderTurnMcpLog(turnMcpHistory, false, (text) => {
                        void copyTextToClipboard(text).catch(() => {
                          setError("Failed to copy MCP log to clipboard.");
                        });
                      })}
                    </article>
                  ) : null}
                </Fragment>
              );
            })}

            {isSending ? (
              <article className="message-row assistant progress-row">
                <div className="typing-progress" role="status" aria-live="polite">
                  {sendProgressMessages.length > 0 ? (
                    <ul className="typing-progress-list">
                      {sendProgressMessages.map((status, index) => (
                        <li
                          key={`${index}-${status}`}
                          className={index === sendProgressMessages.length - 1 ? "active" : ""}
                        >
                          {status}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="typing">Thinking...</p>
                  )}
                </div>
              </article>
            ) : null}
            {isSending && activeTurnMcpHistory.length > 0 ? (
              <article className="mcp-turn-log-row">
                {renderTurnMcpLog(
                  activeTurnMcpHistory,
                  true,
                  (text) => {
                    void copyTextToClipboard(text).catch(() => {
                      setError("Failed to copy MCP log to clipboard.");
                    });
                  },
                )}
              </article>
            ) : null}
            {!isSending && errorTurnMcpHistory.length > 0 ? (
              <article className="mcp-turn-log-row">
                {renderTurnMcpLog(errorTurnMcpHistory, false, (text) => {
                  void copyTextToClipboard(text).catch(() => {
                    setError("Failed to copy MCP log to clipboard.");
                  });
                })}
              </article>
            ) : null}
            <div ref={endOfMessagesRef} />
          </div>

          <footer className="chat-footer">
            {error ? (
              <div className="chat-error-stack">
                <MessageBar intent="error">
                  <MessageBarBody>
                    <MessageBarTitle>Request failed</MessageBarTitle>
                    {error}
                  </MessageBarBody>
                </MessageBar>
                {azureLoginError ? (
                  <MessageBar intent="error">
                    <MessageBarBody>{azureLoginError}</MessageBarBody>
                  </MessageBar>
                ) : null}
              </div>
            ) : null}
            <form className="chat-form" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="chat-input">
                Message
              </label>
              <div className="chat-composer">
                <Textarea
                  id="chat-input"
                  name="message"
                  rows={2}
                  resize="none"
                  ref={chatInputRef}
                  className="chat-composer-input"
                  placeholder="Type a message..."
                  title="Message input. Enter sends, Shift+Enter inserts a new line."
                  value={draft}
                  onChange={(event, data) => {
                    setDraft(data.value);
                    resizeChatInput(event.currentTarget);
                  }}
                  onKeyDown={handleInputKeyDown}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  disabled={isSending || isChatLocked}
                />
                <div className="chat-composer-actions">
                  <div className="chat-quick-controls">
                    {renderUnifiedTooltip(
                      "Project",
                      [
                        isLoadingAzureConnections
                          ? "Loading project names from Azure..."
                          : isAzureAuthRequired
                            ? "Click the selector to start Azure login."
                            : azureConnections.length === 0
                              ? "No projects loaded. Click the selector to reload."
                              : "Used for this chat request.",
                      ],
                      <div className="chat-quick-control">
                        {isLoadingAzureConnections ? (
                          <span
                            className="chat-control-loader chat-control-loader-project"
                            role="status"
                            aria-live="polite"
                          >
                            <Spinner size="tiny" />
                            Loading projects...
                          </span>
                        ) : isAzureAuthRequired || azureConnections.length === 0 ? (
                          renderChatAzureActionSelect(
                            "project",
                            "Project",
                            isAzureAuthRequired ? "Project" : "Reload projects",
                            isAzureAuthRequired
                              ? "Click to sign in with Azure and load projects."
                              : "Click to reload Azure projects.",
                          )
                        ) : (
                          <Select
                            id="chat-azure-project"
                            aria-label="Project"
                            title="Azure project used for this chat."
                            value={activeAzureConnection?.id ?? ""}
                            onChange={(event) => {
                              setSelectedAzureConnectionId(event.target.value);
                              setSelectedAzureDeploymentName("");
                              setAzureDeploymentError(null);
                              setError(null);
                            }}
                            disabled={isSending}
                          >
                            <optgroup label="Project name">
                              {azureConnections.map((connection) => (
                                <option key={connection.id} value={connection.id}>
                                  {connection.projectName}
                                </option>
                              ))}
                            </optgroup>
                          </Select>
                        )}
                      </div>,
                    )}
                    {renderUnifiedTooltip(
                      "Deployment",
                      [
                        isLoadingAzureConnections || isLoadingAzureDeployments
                          ? "Loading deployment names for the selected project..."
                          : isAzureAuthRequired
                            ? "Click the selector to start Azure login."
                            : !activeAzureConnection || azureDeployments.length === 0
                              ? "No deployments loaded. Click the selector to reload."
                              : "Used to run the model.",
                      ],
                      <div className="chat-quick-control">
                        {isLoadingAzureConnections || isLoadingAzureDeployments ? (
                          <span
                            className="chat-control-loader chat-control-loader-deployment"
                            role="status"
                            aria-live="polite"
                          >
                            <Spinner size="tiny" />
                            Loading deployments...
                          </span>
                        ) : isAzureAuthRequired || !activeAzureConnection || azureDeployments.length === 0 ? (
                          renderChatAzureActionSelect(
                            "deployment",
                            "Deployment",
                            isAzureAuthRequired ? "Deployment" : "Reload deployments",
                            isAzureAuthRequired
                              ? "Click to sign in with Azure and load deployments."
                              : "Click to reload deployments for the selected project.",
                          )
                        ) : (
                          <Select
                            id="chat-azure-deployment"
                            aria-label="Deployment"
                            title="Azure deployment used to run the model."
                            value={selectedAzureDeploymentName}
                            onChange={(event) => {
                              const nextDeploymentName = event.target.value.trim();
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
                            }}
                            disabled={isSending}
                          >
                            <optgroup label="Deployment name">
                              {azureDeployments.map((deployment) => (
                                <option key={deployment} value={deployment}>
                                  {deployment}
                                </option>
                              ))}
                            </optgroup>
                          </Select>
                        )}
                      </div>,
                    )}
                    {renderUnifiedTooltip(
                      "Reasoning Effort",
                      ["Controls how much internal reasoning the model uses."],
                      <div className="chat-quick-control">
                        <Select
                          id="chat-reasoning-effort"
                          aria-label="Reasoning Effort"
                          title="Reasoning effort level for the model."
                          value={reasoningEffort}
                          onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                          disabled={isSending}
                        >
                          <optgroup label="Reasoning effort">
                            {REASONING_EFFORT_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </optgroup>
                        </Select>
                      </div>,
                    )}
                    {renderUnifiedTooltip(
                      "Context Window",
                      ["Number of recent messages included in the request."],
                      <div className="chat-quick-control chat-quick-control-context">
                        <SpinButton
                          id="chat-context-window-size"
                          aria-label="Context Window"
                          title="Number of recent messages included in the request."
                          min={MIN_CONTEXT_WINDOW_SIZE}
                          max={MAX_CONTEXT_WINDOW_SIZE}
                          step={1}
                          value={contextWindowValidation.value}
                          displayValue={contextWindowInput}
                          onChange={(_, data) => {
                            if (typeof data.displayValue === "string") {
                              setContextWindowInput(data.displayValue);
                              return;
                            }
                            if (typeof data.value === "number" && Number.isFinite(data.value)) {
                              setContextWindowInput(String(Math.trunc(data.value)));
                              return;
                            }
                            setContextWindowInput("");
                          }}
                          disabled={isSending}
                          aria-invalid={!contextWindowValidation.isValid}
                        />
                      </div>,
                    )}
                  </div>
                  {renderUnifiedTooltip(
                    "Send",
                    ["Send current message."],
                    <Button
                      type="submit"
                      appearance="subtle"
                      className="chat-send-btn"
                      aria-label="Send message"
                      title="Send current message."
                      disabled={
                        isSending ||
                        isChatLocked ||
                        isLoadingAzureConnections ||
                        isLoadingAzureDeployments ||
                        !activeAzureConnection ||
                        !selectedAzureDeploymentName.trim() ||
                        draft.trim().length === 0 ||
                        !contextWindowValidation.isValid
                      }
                    >
                      ↑
                    </Button>,
                    "chat-tooltip-target chat-send-tooltip-target",
                  )}
                </div>
              </div>
            </form>
            {renderAddedMcpServersBubbles()}
          </footer>
        </section>

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

        <aside className="side-shell main-panel" aria-label="Configuration panels">
          <div className="side-shell-header">
            <TabList
              className="main-tabs"
              aria-label="Side panels"
              appearance="subtle"
              size="small"
              title="Switch side panel content."
              selectedValue={activeMainTab}
              onTabSelect={(_, data) => {
                const nextTab = String(data.value);
                if (nextTab === "settings" || nextTab === "mcp") {
                  setActiveMainTab(nextTab);
                }
              }}
            >
              {MAIN_VIEW_TAB_OPTIONS.map((tab) => (
                <Tab
                  key={tab.id}
                  value={tab.id}
                  id={`tab-${tab.id}`}
                  aria-controls={`panel-${tab.id}`}
                  className="main-tab-btn"
                  title={tab.id === "settings" ? "Open Settings panel." : "Open MCP Servers panel."}
                >
                  {tab.label}
                </Tab>
              ))}
            </TabList>
            {isChatLocked ? (
              <MessageBar intent="warning" className="tab-guidance-bar">
                <MessageBarBody>
                  🔒 Playground is locked. Open Settings and sign in to Azure.
                </MessageBarBody>
              </MessageBar>
            ) : null}
          </div>
          <div className="side-shell-body">
            <div className="side-top-panel">
            <section
              className="settings-shell"
              aria-label="Playground settings"
              id="panel-settings"
              role="tabpanel"
              aria-labelledby="tab-settings"
              hidden={activeMainTab !== "settings"}
            >
          <div className="settings-content">
            <section className="setting-group setting-group-azure-connection">
              <div className="setting-group-header">
                <h3>Azure Connection 🔐</h3>
                <p>Sign in/out for Playground access.</p>
              </div>
              {isAzureAuthRequired ? (
                <Button
                  type="button"
                  appearance="primary"
                  className="azure-login-btn"
                  title="Start Azure login in your browser."
                  onClick={() => {
                    void handleAzureLogin();
                  }}
                  disabled={isSending || isStartingAzureLogin}
                >
                  {isStartingAzureLogin ? "🔐 Starting Azure Login..." : "🔐 Azure Login"}
                </Button>
              ) : (
                <>
                  {isLoadingAzureConnections || isLoadingAzureDeployments ? (
                    <p className="azure-loading-notice" role="status" aria-live="polite">
                      <Spinner size="tiny" />
                      {isLoadingAzureConnections
                        ? "Loading projects from Azure..."
                        : "Loading deployments for the selected project..."}
                    </p>
                  ) : null}
                  {activeAzureConnection ? (
                    <dl className="azure-connection-summary" aria-label="Active Azure connection details">
                      <div className="azure-connection-summary-row">
                        <dt>Project</dt>
                        <dd>{activeAzureConnection.projectName}</dd>
                      </div>
                      <div className="azure-connection-summary-row">
                        <dt>Deployment</dt>
                        <dd>{selectedAzureDeploymentName || "Not selected"}</dd>
                      </div>
                      <div className="azure-connection-summary-row">
                        <dt>Endpoint</dt>
                        <dd>{activeAzureConnection.baseUrl}</dd>
                      </div>
                      <div className="azure-connection-summary-row">
                        <dt>API version</dt>
                        <dd>{activeAzureConnection.apiVersion}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="field-hint">No active Azure project.</p>
                  )}
                  <div className="azure-connection-actions">
                    <Button
                      type="button"
                      appearance="outline"
                      className="azure-logout-btn"
                      title="Sign out from Azure for this app."
                      onClick={() => {
                        void handleAzureLogout();
                      }}
                      disabled={isSending || isLoadingAzureConnections || isStartingAzureLogout}
                    >
                      {isStartingAzureLogout ? "🚪 Logging Out..." : "🚪 Logout"}
                    </Button>
                  </div>
                  {azureDeploymentError ? (
                    <MessageBar intent="error" className="setting-message-bar">
                      <MessageBarBody>{azureDeploymentError}</MessageBarBody>
                    </MessageBar>
                  ) : null}
                  {azureLogoutError ? (
                    <MessageBar intent="error" className="setting-message-bar">
                      <MessageBarBody>{azureLogoutError}</MessageBarBody>
                    </MessageBar>
                  ) : null}
                  {azureConnectionError ? (
                    <MessageBar intent="error" className="setting-message-bar">
                      <MessageBarBody>{azureConnectionError}</MessageBarBody>
                    </MessageBar>
                  ) : null}
                </>
              )}
            </section>

            <section className="setting-group setting-group-agent-instruction">
              <div className="setting-group-header">
                <h3>Agent Instruction 🧾</h3>
                <p>System instruction used for the agent.</p>
              </div>
              {instructionEnhanceComparison ? (
                <section className="instruction-diff-panel" aria-label="Instruction diff review">
                  <div className="instruction-diff-header">
                    <p className="instruction-diff-title">🔀 Enhanced Diff Preview</p>
                    <div className="instruction-diff-actions">
                      <Button
                        type="button"
                        appearance="primary"
                        size="small"
                        title="Use the enhanced instruction text."
                        onClick={handleAdoptEnhancedInstruction}
                        disabled={isSending || isEnhancingInstruction}
                      >
                        ✅ Adopt Enhanced
                      </Button>
                      <Button
                        type="button"
                        appearance="secondary"
                        size="small"
                        title="Keep the original instruction text."
                        onClick={handleAdoptOriginalInstruction}
                        disabled={isSending || isEnhancingInstruction}
                      >
                        ↩️ Keep Original
                      </Button>
                    </div>
                  </div>
                  <p className="instruction-diff-meta">
                    Format: .{instructionEnhanceComparison.extension} | Language:{" "}
                    {describeInstructionLanguage(instructionEnhanceComparison.language)}
                  </p>
                  <div className="instruction-diff-table" role="table" aria-label="Instruction diff">
                    {instructionEnhanceComparison.diffLines.map((line, index) => (
                      <div
                        key={`instruction-diff-${index}-${line.oldLineNumber ?? "n"}-${line.newLineNumber ?? "n"}`}
                        className={`instruction-diff-row ${line.type}`}
                        role="row"
                      >
                        <span className="instruction-diff-line-number old" aria-hidden="true">
                          {line.oldLineNumber ?? ""}
                        </span>
                        <span className="instruction-diff-line-number new" aria-hidden="true">
                          {line.newLineNumber ?? ""}
                        </span>
                        <span className={`instruction-diff-sign ${line.type}`} aria-hidden="true">
                          {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                        </span>
                        <code className="instruction-diff-content">
                          {line.content.length > 0 ? line.content : " "}
                        </code>
                      </div>
                    ))}
                  </div>
                </section>
              ) : (
                <>
                  <Textarea
                    id="agent-instruction"
                    rows={6}
                    title="System instruction text sent to the agent."
                    value={agentInstruction}
                    onChange={(_, data) => {
                      setAgentInstruction(data.value);
                      setInstructionSaveError(null);
                      setInstructionSaveSuccess(null);
                      setInstructionEnhanceError(null);
                      setInstructionEnhanceSuccess(null);
                      setInstructionEnhanceComparison(null);
                    }}
                    disabled={isSending || isEnhancingInstruction}
                    placeholder="System instruction for the agent"
                  />
                  {isEnhancingInstruction ? (
                    <div className="instruction-enhancing-state" role="status" aria-live="polite">
                      <div className="instruction-enhancing-head">
                        <Spinner size="tiny" />
                        <span>Enhancing instruction with the selected Azure model...</span>
                      </div>
                      <div className="instruction-enhancing-track" aria-hidden="true">
                        <span className="instruction-enhancing-bar" />
                      </div>
                    </div>
                  ) : null}
                  <Field label="📝 Save file name (optional)">
                    <Input
                      id="agent-instruction-save-file-name"
                      placeholder="instruction.md"
                      title="Optional file name used when saving the instruction."
                      value={instructionSaveFileNameInput}
                      onChange={(_, data) => {
                        setInstructionSaveFileNameInput(data.value);
                        setInstructionSaveError(null);
                        setInstructionSaveSuccess(null);
                        setInstructionEnhanceError(null);
                        setInstructionEnhanceSuccess(null);
                      }}
                      disabled={isSending || isSavingInstructionPrompt || isEnhancingInstruction}
                    />
                  </Field>
                  <div className="file-picker-row">
                    <input
                      id="agent-instruction-file"
                      ref={instructionFileInputRef}
                      className="file-input-hidden"
                      type="file"
                      accept=".md,.txt,.xml,.json,text/plain,text/markdown,application/json,application/xml,text/xml"
                      onChange={(event) => {
                        void handleInstructionFileChange(event);
                      }}
                      disabled={isSending || isEnhancingInstruction}
                    />
                    <Button
                      type="button"
                      appearance="secondary"
                      size="small"
                      title="Load instruction content from a local file."
                      onClick={() => instructionFileInputRef.current?.click()}
                      disabled={isSending || isEnhancingInstruction}
                    >
                      📂 Load File
                    </Button>
                    <Button
                      type="button"
                      appearance="secondary"
                      size="small"
                      title="Save current instruction to the prompt directory."
                      onClick={() => {
                        void handleSaveInstructionPrompt();
                      }}
                      disabled={
                        isSending ||
                        isSavingInstructionPrompt ||
                        isEnhancingInstruction ||
                        !canSaveAgentInstructionPrompt
                      }
                    >
                      {isSavingInstructionPrompt ? "💾 Saving..." : "💾 Save"}
                    </Button>
                    <Button
                      type="button"
                      appearance="primary"
                      size="small"
                      title="Enhance the instruction using the selected Azure model."
                      onClick={() => {
                        void handleEnhanceInstruction();
                      }}
                      disabled={isSending || isEnhancingInstruction || !canEnhanceAgentInstruction}
                    >
                      {isEnhancingInstruction ? "✨ Enhancing..." : "✨ Enhance"}
                    </Button>
                    <Button
                      type="button"
                      appearance="secondary"
                      size="small"
                      title="Clear instruction text and related form values."
                      onClick={() => {
                        setAgentInstruction("");
                        setInstructionSaveFileNameInput("");
                        setLoadedInstructionFileName(null);
                        setInstructionFileError(null);
                        setInstructionSaveError(null);
                        setInstructionSaveSuccess(null);
                        setInstructionEnhanceError(null);
                        setInstructionEnhanceSuccess(null);
                        setInstructionEnhanceComparison(null);
                      }}
                      disabled={isSending || isEnhancingInstruction || !canClearAgentInstruction}
                    >
                      🧹 Clear
                    </Button>
                    <span className="file-picker-name">
                      {loadedInstructionFileName ?? "No file loaded"}
                    </span>
                  </div>
                  <p className="field-hint">Supported: .md, .txt, .xml, .json (max 1MB)</p>
                </>
              )}
              {instructionFileError ? (
                <MessageBar intent="error" className="setting-message-bar">
                  <MessageBarBody>{instructionFileError}</MessageBarBody>
                </MessageBar>
              ) : null}
              {instructionSaveError ? (
                <MessageBar intent="error" className="setting-message-bar">
                  <MessageBarBody>{instructionSaveError}</MessageBarBody>
                </MessageBar>
              ) : null}
              {instructionSaveSuccess ? (
                <MessageBar intent="success" className="setting-message-bar">
                  <MessageBarBody>{instructionSaveSuccess}</MessageBarBody>
                </MessageBar>
              ) : null}
              {instructionEnhanceError ? (
                <MessageBar intent="error" className="setting-message-bar">
                  <MessageBarBody>{instructionEnhanceError}</MessageBarBody>
                </MessageBar>
              ) : null}
              {instructionEnhanceSuccess ? (
                <MessageBar intent="success" className="setting-message-bar">
                  <MessageBarBody>{instructionEnhanceSuccess}</MessageBarBody>
                </MessageBar>
              ) : null}
            </section>
          </div>
            </section>

            <section
              className="mcp-shell"
              aria-label="MCP server settings"
              id="panel-mcp"
              role="tabpanel"
              aria-labelledby="tab-mcp"
              hidden={activeMainTab !== "mcp"}
            >
          <div className="mcp-content">
            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Saved Configs 💾</h3>
              </div>
              <Field label="💾 Saved config">
                <Select
                  id="mcp-saved-config"
                  title="Choose a saved MCP server configuration."
                  value={selectedSavedMcpServerId}
                  onChange={(event) => {
                    setSelectedSavedMcpServerId(event.target.value);
                    setSavedMcpError(null);
                  }}
                  disabled={isSending || isLoadingSavedMcpServers || savedMcpServers.length === 0}
                >
                  {savedMcpServers.length === 0 ? (
                    <option value="">No saved MCP servers</option>
                  ) : null}
                  {savedMcpServers.map((server) => (
                    <option key={server.id} value={server.id}>
                      {formatMcpServerOption(server)}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="mcp-action-row">
                <Button
                  type="button"
                  appearance="secondary"
                  title="Load the selected saved MCP config into the form."
                  onClick={handleLoadSavedMcpServerToForm}
                  disabled={
                    isSending ||
                    isLoadingSavedMcpServers ||
                    savedMcpServers.length === 0 ||
                    !selectedSavedMcpServerId
                  }
                >
                  📥 Load Selected
                </Button>
                <Button
                  type="button"
                  appearance="secondary"
                  title="Reload saved MCP configs from disk."
                  onClick={() => {
                    void loadSavedMcpServers();
                  }}
                  disabled={isSending || isLoadingSavedMcpServers}
                >
                  {isLoadingSavedMcpServers ? "🔄 Loading..." : "🔄 Reload"}
                </Button>
              </div>
              {savedMcpError ? (
                <MessageBar intent="error" className="setting-message-bar">
                  <MessageBarBody>{savedMcpError}</MessageBarBody>
                </MessageBar>
              ) : null}
            </section>

            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Add MCP Server ➕</h3>
              </div>
              <Field label="🏷️ Server name (optional)">
                <Input
                  id="mcp-server-name"
                  placeholder="Server name (optional)"
                  title="Optional display name for this MCP server."
                  value={mcpNameInput}
                  onChange={(_, data) => setMcpNameInput(data.value)}
                  disabled={isSending}
                />
              </Field>
              <Field label="🚚 Transport">
                <Select
                  id="mcp-transport"
                  title="Select MCP transport type."
                  value={mcpTransport}
                  onChange={(event) => {
                    setMcpTransport(event.target.value as McpTransport);
                    setMcpFormError(null);
                  }}
                  disabled={isSending}
                >
                  <option value="streamable_http">streamable_http</option>
                  <option value="sse">sse</option>
                  <option value="stdio">stdio</option>
                </Select>
              </Field>
              {mcpTransport === "stdio" ? (
                <>
                  <Field label="⚙️ Command">
                    <Input
                      id="mcp-command"
                      placeholder="Command (e.g. npx)"
                      title="Command used to start the stdio MCP server."
                      value={mcpCommandInput}
                      onChange={(_, data) => setMcpCommandInput(data.value)}
                      disabled={isSending}
                    />
                  </Field>
                  <Field label="🧩 Arguments">
                    <Input
                      id="mcp-args"
                      placeholder='Args (space-separated or JSON array)'
                      title="Arguments passed to the MCP command."
                      value={mcpArgsInput}
                      onChange={(_, data) => setMcpArgsInput(data.value)}
                      disabled={isSending}
                    />
                  </Field>
                  <Field label="📂 Working directory (optional)">
                    <Input
                      id="mcp-cwd"
                      placeholder="Working directory (optional)"
                      title="Optional working directory for the command."
                      value={mcpCwdInput}
                      onChange={(_, data) => setMcpCwdInput(data.value)}
                      disabled={isSending}
                    />
                  </Field>
                  <Field label="🌿 Environment variables (optional)">
                    <Textarea
                      id="mcp-env"
                      rows={3}
                      placeholder={"Environment variables (optional)\nKEY=value"}
                      title="Environment variables for stdio MCP (KEY=value)."
                      value={mcpEnvInput}
                      onChange={(_, data) => setMcpEnvInput(data.value)}
                      disabled={isSending}
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="🔗 Endpoint URL">
                    <Input
                      id="mcp-url"
                      placeholder="https://example.com/mcp"
                      title="HTTP/SSE endpoint URL for the MCP server."
                      value={mcpUrlInput}
                      onChange={(_, data) => setMcpUrlInput(data.value)}
                      disabled={isSending}
                    />
                  </Field>
                  <Field label="🧾 Additional HTTP headers (optional)">
                    <Textarea
                      id="mcp-headers"
                      rows={3}
                      placeholder={"Additional HTTP headers (optional)\nAuthorization=Bearer <token>\nX-Api-Key=<key>"}
                      title="Additional HTTP headers (one per line: Name=Value)."
                      value={mcpHeadersInput}
                      onChange={(_, data) => setMcpHeadersInput(data.value)}
                      disabled={isSending}
                    />
                  </Field>
                  <Field label="🔐 Azure authentication">
                    <div className="field-with-info">
                      <Checkbox
                        className="field-checkbox"
                        title="Attach Azure Bearer token from DefaultAzureCredential."
                        checked={mcpUseAzureAuthInput}
                        onChange={(_, data) => {
                          const checked = data.checked === true;
                          setMcpUseAzureAuthInput(checked);
                          if (checked && !mcpAzureAuthScopeInput.trim()) {
                            setMcpAzureAuthScopeInput(DEFAULT_MCP_AZURE_AUTH_SCOPE);
                          }
                        }}
                        disabled={isSending}
                        label="Use Azure Bearer token from DefaultAzureCredential"
                      />
                      <Popover withArrow positioning="below-end">
                        <PopoverTrigger disableButtonEnhancement>
                          <Button
                            type="button"
                            appearance="subtle"
                            size="small"
                            className="field-info-btn"
                            aria-label="Show Azure authentication behavior details"
                            title="Show Azure authentication behavior details."
                          >
                            ⓘ
                          </Button>
                        </PopoverTrigger>
                        <PopoverSurface className="field-info-popover">
                          <p className="field-info-title">Azure auth behavior</p>
                          <ul className="field-info-list">
                            <li>
                              Applies to HTTP MCP transports (<code>streamable_http</code> and{" "}
                              <code>sse</code>).
                            </li>
                            <li>
                              <code>Content-Type: application/json</code> is always included.
                            </li>
                            <li>
                              At connect time, the app calls{" "}
                              <code>DefaultAzureCredential.getToken(scope)</code>.
                            </li>
                            <li>
                              The resulting <code>Authorization: Bearer &lt;token&gt;</code> header
                              is added after custom headers and takes precedence.
                            </li>
                            <li>
                              Only <code>useAzureAuth</code> and <code>scope</code> are stored in
                              config; token values are never persisted.
                            </li>
                            <li>
                              If token acquisition fails, server connection fails and the error appears
                              in MCP Operation Log.
                            </li>
                          </ul>
                        </PopoverSurface>
                      </Popover>
                    </div>
                  </Field>
                  {mcpUseAzureAuthInput ? (
                    <Field label="🎯 Token scope">
                      <Input
                        id="mcp-azure-auth-scope"
                        placeholder={DEFAULT_MCP_AZURE_AUTH_SCOPE}
                        title="Azure token scope used to acquire Bearer token."
                        value={mcpAzureAuthScopeInput}
                        onChange={(_, data) => setMcpAzureAuthScopeInput(data.value)}
                        disabled={isSending}
                      />
                    </Field>
                  ) : null}
                  <Field label="⏱️ Timeout (seconds)">
                    <Input
                      id="mcp-timeout-seconds"
                      placeholder={String(DEFAULT_MCP_TIMEOUT_SECONDS)}
                      title="Request timeout in seconds (1-600)."
                      value={mcpTimeoutSecondsInput}
                      onChange={(_, data) => setMcpTimeoutSecondsInput(data.value)}
                      disabled={isSending}
                    />
                  </Field>
                  <p className="field-hint">
                    Timeout (seconds): integer from {MIN_MCP_TIMEOUT_SECONDS} to {MAX_MCP_TIMEOUT_SECONDS}.
                  </p>
                  <p className="field-hint">Content-Type: application/json is always included.</p>
                </>
              )}
              <Button
                type="button"
                appearance="primary"
                title="Add this MCP server to the active chat session."
                onClick={() => {
                  void handleAddMcpServer();
                }}
                disabled={isSending || isSavingMcpServer}
              >
                ➕ Add Server
              </Button>
              {mcpFormError ? (
                <MessageBar intent="error" className="setting-message-bar">
                  <MessageBarBody>{mcpFormError}</MessageBarBody>
                </MessageBar>
              ) : null}
              {mcpFormWarning ? (
                <MessageBar intent="warning" className="setting-message-bar">
                  <MessageBarBody>{mcpFormWarning}</MessageBarBody>
                </MessageBar>
              ) : null}
            </section>

          </div>
            </section>
            </div>

          </div>
        </aside>
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
        <Button
          type="button"
          appearance="subtle"
          size="small"
          className="copy-symbol-btn mcp-log-copy-btn"
          aria-label="Copy MCP operation log"
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
        >
          ⎘
        </Button>
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
                <Button
                  type="button"
                  appearance="subtle"
                  size="small"
                  className="copy-symbol-btn mcp-history-copy-btn"
                  aria-label="Copy MCP operation entry"
                  title="Copy this MCP operation entry."
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onCopyText(formatJsonForDisplay(buildMcpEntryCopyPayload(entry)));
                  }}
                >
                  ⎘
                </Button>
              </summary>
              <div className="mcp-history-body">
                <p className="mcp-history-time">
                  {entry.startedAt}
                  {" -> "}
                  {entry.completedAt}
                </p>
                <p className="mcp-history-label-row">
                  <span className="mcp-history-label">request</span>
                  <Button
                    type="button"
                    appearance="subtle"
                    size="small"
                    className="copy-symbol-btn mcp-part-copy-btn"
                    aria-label="Copy MCP request payload"
                    title="Copy MCP request payload."
                    onClick={() => {
                      onCopyText(
                        formatJsonForDisplay({
                          request: entry.request ?? null,
                        }),
                      );
                    }}
                  >
                    ⎘
                  </Button>
                </p>
                {renderHighlightedJson(entry.request, "MCP request JSON", "compact")}
                <p className="mcp-history-label-row">
                  <span className="mcp-history-label">response</span>
                  <Button
                    type="button"
                    appearance="subtle"
                    size="small"
                    className="copy-symbol-btn mcp-part-copy-btn"
                    aria-label="Copy MCP response payload"
                    title="Copy MCP response payload."
                    onClick={() => {
                      onCopyText(
                        formatJsonForDisplay({
                          response: entry.response ?? null,
                        }),
                      );
                    }}
                  >
                    ⎘
                  </Button>
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

const MAIN_VIEW_TAB_OPTIONS: Array<{ id: MainViewTab; label: string }> = [
  { id: "settings", label: "⚙️ Settings" },
  { id: "mcp", label: "🧩 MCP Servers" },
];

const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["none", "low", "medium", "high"];
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateContextWindowInput(input: string): {
  isValid: boolean;
  value: number | null;
  message: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      isValid: false,
      value: null,
      message: `Enter an integer between ${MIN_CONTEXT_WINDOW_SIZE} and ${MAX_CONTEXT_WINDOW_SIZE}.`,
    };
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      isValid: false,
      value: null,
      message: "Context window must be an integer.",
    };
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_CONTEXT_WINDOW_SIZE ||
    parsed > MAX_CONTEXT_WINDOW_SIZE
  ) {
    return {
      isValid: false,
      value: null,
      message: `Context window must be between ${MIN_CONTEXT_WINDOW_SIZE} and ${MAX_CONTEXT_WINDOW_SIZE}.`,
    };
  }

  return {
    isValid: true,
    value: parsed,
    message: null,
  };
}

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

export function resolveInstructionSourceFileName(
  loadedFileName: string | null,
  saveFileNameInput: string,
): string | null {
  const loaded = (loadedFileName ?? "").trim();
  if (loaded) {
    return loaded;
  }

  const saveInput = saveFileNameInput.trim();
  return saveInput || null;
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
