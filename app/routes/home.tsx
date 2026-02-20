import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ConfigPanel } from "~/components/home/config/ConfigPanel";
import { PlaygroundPanel } from "~/components/home/playground/PlaygroundPanel";
import { CopyIconButton } from "~/components/home/shared/CopyIconButton";
import type { MainViewTab, McpTransport, ReasoningEffort } from "~/components/home/shared/types";
import {
  CHAT_ATTACHMENT_ALLOWED_EXTENSIONS,
  CHAT_ATTACHMENT_MAX_FILE_NAME_LENGTH,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_NON_PDF_FILE_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_PDF_FILE_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_PDF_TOTAL_SIZE_BYTES,
  CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES,
  DEFAULT_AGENT_INSTRUCTION,
  HOME_CHAT_INPUT_MAX_HEIGHT_PX,
  HOME_CHAT_INPUT_MIN_HEIGHT_PX,
  HOME_DEFAULT_MCP_TRANSPORT,
  HOME_INITIAL_MESSAGES,
  HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX,
  HOME_THREAD_NAME_MAX_LENGTH,
  HOME_REASONING_EFFORT_OPTIONS,
  INSTRUCTION_ALLOWED_EXTENSIONS,
  INSTRUCTION_ENHANCE_SYSTEM_PROMPT,
  INSTRUCTION_MAX_FILE_SIZE_BYTES,
  INSTRUCTION_MAX_FILE_SIZE_LABEL,
  MCP_DEFAULT_AZURE_AUTH_SCOPE,
  MCP_DEFAULT_TIMEOUT_SECONDS,
  MCP_TIMEOUT_SECONDS_MAX,
  MCP_TIMEOUT_SECONDS_MIN,
} from "~/lib/constants";
import type {
  AzureConnectionOption,
  AzureSelectionPreference,
} from "~/lib/home/azure/parsers";
import {
  readAzureDeploymentList,
  readPrincipalIdFromUnknown,
  readAzureProjectList,
  readAzureSelectionFromUnknown,
  readTenantIdFromUnknown,
} from "~/lib/home/azure/parsers";
import { buildMcpEntryCopyPayload, buildMcpHistoryByTurnId } from "~/lib/home/chat/history";
import type { DraftChatAttachment } from "~/lib/home/chat/attachments";
import { formatChatAttachmentSize, readFileAsDataUrl } from "~/lib/home/chat/attachments";
import type { ChatMessage } from "~/lib/home/chat/messages";
import { createMessage } from "~/lib/home/chat/messages";
import type { JsonToken } from "~/lib/home/chat/json-highlighting";
import {
  formatJsonForDisplay,
  isJsonCodeClassName,
  parseJsonMessageTokens,
  tokenizeJson,
} from "~/lib/home/chat/json-highlighting";
import type { ChatApiResponse, McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import {
  appendProgressMessage,
  readChatEventStreamPayload,
  upsertMcpRpcHistoryEntry,
} from "~/lib/home/chat/stream";
import type { InstructionLanguage } from "~/lib/home/instruction/helpers";
import {
  applyInstructionUnifiedDiffPatch,
  buildInstructionEnhanceMessage,
  buildInstructionSuggestedFileName,
  describeInstructionLanguage,
  detectInstructionLanguage,
  isInstructionSaveCanceled,
  normalizeInstructionDiffPatchResponse,
  resolveInstructionFormatExtension,
  resolveInstructionSourceFileName,
  saveInstructionToClientFile,
  validateEnhancedInstructionFormat,
} from "~/lib/home/instruction/helpers";
import { resolveMainSplitterMaxRightWidth } from "~/lib/home/layout/main-splitter";
import {
  parseAzureAuthScopeInput,
  parseHttpHeadersInput,
  parseMcpTimeoutSecondsInput,
} from "~/lib/home/mcp/http-inputs";
import type { McpServerConfig } from "~/lib/home/mcp/profile";
import {
  buildMcpServerKey,
  formatMcpServerOption,
  readMcpServerFromUnknown,
  readMcpServerList,
  serializeMcpServerForSave,
  upsertMcpServer,
} from "~/lib/home/mcp/profile";
import {
  parseStdioArgsInput,
  parseStdioEnvInput,
} from "~/lib/home/mcp/stdio-inputs";
import {
  isMcpServersAuthRequired,
  shouldScheduleSavedMcpLoginRetry,
} from "~/lib/home/mcp/saved-profiles";
import { buildThreadSummary, readThreadSnapshotFromUnknown } from "~/lib/home/thread/parsers";
import type { ThreadSnapshot, ThreadSummary } from "~/lib/home/thread/types";
import { copyTextToClipboard } from "~/lib/home/shared/clipboard";
import { getFileExtension } from "~/lib/home/shared/files";
import { createId } from "~/lib/home/shared/ids";
import { clampNumber } from "~/lib/home/shared/numbers";
import type { Route } from "./+types/home";

type InstructionEnhanceComparison = {
  original: string;
  enhanced: string;
  extension: string;
  language: InstructionLanguage;
  diffPatch: string;
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
  principalId?: unknown;
  authRequired?: boolean;
  error?: string;
};
type AzureSelectionApiResponse = {
  selection?: unknown;
  error?: string;
};

type McpServersApiResponse = {
  profile?: unknown;
  profiles?: unknown;
  warning?: string;
  authRequired?: boolean;
  error?: string;
};

type ThreadsApiResponse = {
  threads?: unknown;
  thread?: unknown;
  authRequired?: boolean;
  error?: string;
};

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Local Playground" },
    { name: "description", content: "Local desktop playground with OpenAI backend." },
  ];
}

export default function Home() {
  const [azureConnections, setAzureConnections] = useState<AzureConnectionOption[]>([]);
  const [azureDeployments, setAzureDeployments] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([...HOME_INITIAL_MESSAGES]);
  const [draft, setDraft] = useState("");
  const [draftAttachments, setDraftAttachments] = useState<DraftChatAttachment[]>([]);
  const [chatAttachmentError, setChatAttachmentError] = useState<string | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<MainViewTab>("threads");
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
    MCP_DEFAULT_AZURE_AUTH_SCOPE,
  );
  const [mcpTimeoutSecondsInput, setMcpTimeoutSecondsInput] = useState(
    String(MCP_DEFAULT_TIMEOUT_SECONDS),
  );
  const [mcpTransport, setMcpTransport] = useState<McpTransport>(HOME_DEFAULT_MCP_TRANSPORT);
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [mcpFormWarning, setMcpFormWarning] = useState<string | null>(null);
  const [savedMcpError, setSavedMcpError] = useState<string | null>(null);
  const [isLoadingSavedMcpServers, setIsLoadingSavedMcpServers] = useState(false);
  const [isSavingMcpServer, setIsSavingMcpServer] = useState(false);
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
  const [threads, setThreads] = useState<ThreadSnapshot[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [activeThreadNameInput, setActiveThreadNameInput] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
  const [newThreadNameInput, setNewThreadNameInput] = useState("");
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isSavingThread, setIsSavingThread] = useState(false);
  const [isSwitchingThread, setIsSwitchingThread] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [rightPaneWidth, setRightPaneWidth] = useState(420);
  const [activeResizeHandle, setActiveResizeHandle] = useState<"main" | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const instructionFileInputRef = useRef<HTMLInputElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const azureDeploymentRequestSeqRef = useRef(0);
  const activeAzureTenantIdRef = useRef("");
  const activeAzurePrincipalIdRef = useRef("");
  const activeSavedMcpUserKeyRef = useRef("");
  const activeThreadsUserKeyRef = useRef("");
  const savedMcpLoginRetryTimeoutRef = useRef<number | null>(null);
  const savedMcpRequestSeqRef = useRef(0);
  const preferredAzureSelectionRef = useRef<AzureSelectionPreference | null>(null);
  const activeThreadIdRef = useRef("");
  const isApplyingThreadStateRef = useRef(false);
  const isThreadsReadyRef = useRef(false);
  const threadNameSaveTimeoutRef = useRef<number | null>(null);
  const threadSaveTimeoutRef = useRef<number | null>(null);
  const threadLoadRequestSeqRef = useRef(0);
  const threadSaveRequestSeqRef = useRef(0);
  const threadSaveSignatureByIdRef = useRef(new Map<string, string>());
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
  const reasoningEffortOptions: ReasoningEffort[] = [...HOME_REASONING_EFFORT_OPTIONS];
  const mcpHistoryByTurnId = buildMcpHistoryByTurnId(mcpRpcHistory);
  const activeTurnMcpHistory = activeTurnId ? (mcpHistoryByTurnId.get(activeTurnId) ?? []) : [];
  const errorTurnMcpHistory = lastErrorTurnId ? (mcpHistoryByTurnId.get(lastErrorTurnId) ?? []) : [];
  const savedMcpServerOptions = savedMcpServers.map((server) => ({
    id: server.id,
    label: formatMcpServerOption(server),
  }));
  const draftAttachmentTotalSizeBytes = draftAttachments.reduce(
    (sum, attachment) => sum + attachment.sizeBytes,
    0,
  );
  const draftPdfAttachmentTotalSizeBytes = draftAttachments.reduce(
    (sum, attachment) =>
      sum + (getFileExtension(attachment.name) === "pdf" ? attachment.sizeBytes : 0),
    0,
  );
  const chatAttachmentAccept = [
    ...Array.from(CHAT_ATTACHMENT_ALLOWED_EXTENSIONS, (extension) => `.${extension}`),
  ].join(",");
  const chatAttachmentFormatHint = "Code Interpreter supported files (.pdf, .csv, .xlsx, .docx, .png, ...)";
  const threadSummaries: ThreadSummary[] = threads.map((thread) => buildThreadSummary(thread));
  const canSendMessage =
    !isSending &&
    !isSwitchingThread &&
    !isLoadingThreads &&
    !isChatLocked &&
    !isLoadingAzureConnections &&
    !isLoadingAzureDeployments &&
    !!activeThreadId.trim() &&
    !!activeAzureConnection &&
    !!selectedAzureDeploymentName.trim() &&
    draft.trim().length > 0;

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
    const principalId = activeAzurePrincipalIdRef.current.trim();
    const projectId = selectedAzureConnectionId.trim();
    const deploymentName = selectedAzureDeploymentName.trim();
    if (!tenantId || !principalId || !projectId || !deploymentName) {
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
      preferred.principalId === principalId &&
      preferred.projectId === projectId &&
      preferred.deploymentName === deploymentName
    ) {
      return;
    }

    void saveAzureSelectionPreference({ tenantId, principalId, projectId, deploymentName });
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
        const maxRightWidth = resolveMainSplitterMaxRightWidth(rect.width);
        setRightPaneWidth((current) =>
          clampNumber(current, HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX, maxRightWidth),
        );
      }

    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    return () => {
      clearSavedMcpLoginRetryTimeout();
    };
  }, []);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    return () => {
      clearThreadNameSaveTimeout();
      clearThreadSaveTimeout();
    };
  }, []);

  useEffect(() => {
    if (!isThreadsReadyRef.current || isApplyingThreadStateRef.current) {
      return;
    }
    if (isSending || isSwitchingThread || isLoadingThreads) {
      return;
    }

    const currentThreadId = activeThreadIdRef.current.trim();
    if (!currentThreadId) {
      return;
    }

    const baseThread = threads.find((thread) => thread.id === currentThreadId);
    if (!baseThread) {
      return;
    }

    const snapshot = buildThreadSnapshotFromCurrentState(baseThread);
    const signature = buildThreadSaveSignature(snapshot);
    const savedSignature = threadSaveSignatureByIdRef.current.get(snapshot.id);
    if (savedSignature === signature) {
      return;
    }

    clearThreadSaveTimeout();
    threadSaveTimeoutRef.current = window.setTimeout(() => {
      threadSaveTimeoutRef.current = null;
      void saveThreadSnapshotToDatabase(snapshot, signature);
    }, 450);

    return () => {
      clearThreadSaveTimeout();
    };
  }, [
    activeThreadId,
    agentInstruction,
    messages,
    mcpServers,
    mcpRpcHistory,
    threads,
    isSending,
    isSwitchingThread,
    isLoadingThreads,
  ]);

  useEffect(() => {
    if (!isThreadsReadyRef.current || isApplyingThreadStateRef.current) {
      return;
    }
    if (isSending || isLoadingThreads || isSwitchingThread || isCreatingThread) {
      return;
    }

    const currentThreadId = activeThreadIdRef.current.trim();
    if (!currentThreadId) {
      return;
    }

    const baseThread = threads.find((thread) => thread.id === currentThreadId);
    if (!baseThread) {
      return;
    }

    const trimmedName = activeThreadNameInput.trim().slice(0, HOME_THREAD_NAME_MAX_LENGTH);
    const nextName = trimmedName || baseThread.name;
    if (nextName === baseThread.name) {
      return;
    }

    clearThreadNameSaveTimeout();
    threadNameSaveTimeoutRef.current = window.setTimeout(() => {
      threadNameSaveTimeoutRef.current = null;
      void saveActiveThreadNameInBackground(currentThreadId, nextName);
    }, 3000);

    return () => {
      clearThreadNameSaveTimeout();
    };
  }, [
    activeThreadId,
    activeThreadNameInput,
    threads,
    isSending,
    isLoadingThreads,
    isSwitchingThread,
    isCreatingThread,
  ]);

  async function loadSavedMcpServers() {
    const expectedUserKey = activeSavedMcpUserKeyRef.current.trim();
    if (!expectedUserKey) {
      clearSavedMcpServersState();
      return;
    }

    const requestSeq = savedMcpRequestSeqRef.current + 1;
    savedMcpRequestSeqRef.current = requestSeq;
    setIsLoadingSavedMcpServers(true);

    try {
      const response = await fetch("/api/mcp-servers", {
        method: "GET",
      });

      const payload = (await response.json()) as McpServersApiResponse;
      if (requestSeq !== savedMcpRequestSeqRef.current) {
        return;
      }
      if (expectedUserKey !== activeSavedMcpUserKeyRef.current.trim()) {
        return;
      }

      if (!response.ok) {
        const authRequired = isMcpServersAuthRequired(response.status, payload);
        if (authRequired) {
          setIsAzureAuthRequired(true);
          clearSavedMcpServersState(
            "Azure login is required. Open Settings and sign in to load MCP servers.",
          );
          return;
        }
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
      if (requestSeq !== savedMcpRequestSeqRef.current) {
        return;
      }
      if (expectedUserKey !== activeSavedMcpUserKeyRef.current.trim()) {
        return;
      }
      setSavedMcpError(
        loadError instanceof Error ? loadError.message : "Failed to load saved MCP servers.",
      );
    } finally {
      if (
        requestSeq === savedMcpRequestSeqRef.current &&
        expectedUserKey === activeSavedMcpUserKeyRef.current.trim()
      ) {
        setIsLoadingSavedMcpServers(false);
      }
    }
  }

  function clearSavedMcpLoginRetryTimeout() {
    const timeoutId = savedMcpLoginRetryTimeoutRef.current;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      savedMcpLoginRetryTimeoutRef.current = null;
    }
  }

  function scheduleSavedMcpLoginRetry(expectedUserKey: string) {
    clearSavedMcpLoginRetryTimeout();
    savedMcpLoginRetryTimeoutRef.current = window.setTimeout(() => {
      savedMcpLoginRetryTimeoutRef.current = null;
      if (activeSavedMcpUserKeyRef.current === expectedUserKey) {
        void loadSavedMcpServers();
      }
    }, 1200);
  }

  function clearSavedMcpServersState(nextError: string | null = null) {
    clearSavedMcpLoginRetryTimeout();
    setSavedMcpServers([]);
    setSelectedSavedMcpServerId("");
    setSavedMcpError(nextError);
    setIsLoadingSavedMcpServers(false);
  }

  function clearThreadNameSaveTimeout() {
    const timeoutId = threadNameSaveTimeoutRef.current;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      threadNameSaveTimeoutRef.current = null;
    }
  }

  function clearThreadSaveTimeout() {
    const timeoutId = threadSaveTimeoutRef.current;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      threadSaveTimeoutRef.current = null;
    }
  }

  function clearThreadsState(nextError: string | null = null) {
    clearThreadNameSaveTimeout();
    clearThreadSaveTimeout();
    isThreadsReadyRef.current = false;
    activeThreadIdRef.current = "";
    isApplyingThreadStateRef.current = false;
    threadSaveSignatureByIdRef.current.clear();
    setThreads([]);
    setActiveThreadId("");
    setActiveThreadNameInput("");
    setSelectedThreadId("");
    setThreadError(nextError);
    setIsLoadingThreads(false);
    setIsSwitchingThread(false);
    setIsCreatingThread(false);
    setIsSavingThread(false);
    setMessages([...HOME_INITIAL_MESSAGES]);
    setMcpRpcHistory([]);
    setMcpServers([]);
    setAgentInstruction(DEFAULT_AGENT_INSTRUCTION);
    setLoadedInstructionFileName(null);
    setInstructionFileError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceError(null);
    setInstructionEnhanceSuccess(null);
    setInstructionEnhanceComparison(null);
    setDraft("");
    setDraftAttachments([]);
    setChatAttachmentError(null);
    setActiveTurnId(null);
    setLastErrorTurnId(null);
    setSendProgressMessages([]);
    setIsComposing(false);
  }

  function cloneMessages(value: ChatMessage[]): ChatMessage[] {
    return value.map((message) => ({
      ...message,
      attachments: message.attachments.map((attachment) => ({ ...attachment })),
    }));
  }

  function cloneMcpServers(value: McpServerConfig[]): McpServerConfig[] {
    return value.map((server) =>
      server.transport === "stdio"
        ? {
            ...server,
            args: [...server.args],
            env: { ...server.env },
          }
        : {
            ...server,
            headers: { ...server.headers },
          },
    );
  }

  function cloneMcpRpcHistory(value: McpRpcHistoryEntry[]): McpRpcHistoryEntry[] {
    return value.map((entry) => ({
      ...entry,
    }));
  }

  function resolveThreadNameForSave(baseName: string, includeDraftName: boolean): string {
    if (!includeDraftName) {
      return baseName;
    }

    const draftName = activeThreadNameInput.trim();
    if (!draftName) {
      return baseName;
    }

    return draftName.slice(0, HOME_THREAD_NAME_MAX_LENGTH);
  }

  function buildThreadSnapshotFromCurrentState(
    base: ThreadSnapshot,
    options: {
      includeDraftName?: boolean;
    } = {},
  ): ThreadSnapshot {
    const includeDraftName = options.includeDraftName === true;
    return {
      ...base,
      name: resolveThreadNameForSave(base.name, includeDraftName),
      updatedAt: new Date().toISOString(),
      agentInstruction,
      messages: cloneMessages(messages),
      mcpServers: cloneMcpServers(mcpServers),
      mcpRpcHistory: cloneMcpRpcHistory(mcpRpcHistory),
    };
  }

  function buildThreadSaveSignature(snapshot: ThreadSnapshot): string {
    return JSON.stringify({
      name: snapshot.name,
      agentInstruction: snapshot.agentInstruction,
      messages: snapshot.messages,
      mcpServers: snapshot.mcpServers,
      mcpRpcHistory: snapshot.mcpRpcHistory,
    });
  }

  function upsertThreadSnapshot(
    current: ThreadSnapshot[],
    next: ThreadSnapshot,
  ): ThreadSnapshot[] {
    const existingIndex = current.findIndex((thread) => thread.id === next.id);
    if (existingIndex < 0) {
      return [next, ...current].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    const updated = current.map((thread, index) => (index === existingIndex ? next : thread));
    return updated.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  function setThreadSaveSignatures(nextThreads: ThreadSnapshot[]) {
    const signatureMap = threadSaveSignatureByIdRef.current;
    signatureMap.clear();
    for (const thread of nextThreads) {
      signatureMap.set(thread.id, buildThreadSaveSignature(thread));
    }
  }

  function applyThreadSnapshotToState(thread: ThreadSnapshot) {
    isApplyingThreadStateRef.current = true;

    const clonedMessages = cloneMessages(thread.messages);
    const clonedMcpServers = cloneMcpServers(thread.mcpServers);
    const clonedMcpRpcHistory = cloneMcpRpcHistory(thread.mcpRpcHistory);

    activeThreadIdRef.current = thread.id;
    setActiveThreadId(thread.id);
    setActiveThreadNameInput(thread.name);
    setSelectedThreadId(thread.id);
    setMessages(clonedMessages);
    setMcpServers(clonedMcpServers);
    setMcpRpcHistory(clonedMcpRpcHistory);
    setAgentInstruction(thread.agentInstruction);
    setLoadedInstructionFileName(null);
    setInstructionFileError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceError(null);
    setInstructionEnhanceSuccess(null);
    setInstructionEnhanceComparison(null);
    setDraft("");
    setDraftAttachments([]);
    setChatAttachmentError(null);
    setError(null);
    setActiveTurnId(null);
    setLastErrorTurnId(null);
    setSendProgressMessages([]);
    setIsComposing(false);

    window.setTimeout(() => {
      isApplyingThreadStateRef.current = false;
    }, 0);
  }

  function readThreadListFromApiPayload(payload: ThreadsApiResponse): ThreadSnapshot[] {
    if (!Array.isArray(payload.threads)) {
      return [];
    }

    const result: ThreadSnapshot[] = [];
    const seenIds = new Set<string>();
    for (const entry of payload.threads) {
      const parsed = readThreadSnapshotFromUnknown(entry, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      if (!parsed || seenIds.has(parsed.id)) {
        continue;
      }

      seenIds.add(parsed.id);
      result.push(parsed);
    }

    return result;
  }

  async function saveThreadSnapshotToDatabase(
    snapshot: ThreadSnapshot,
    signature: string,
  ): Promise<boolean> {
    const expectedUserKey = activeThreadsUserKeyRef.current.trim();
    if (!expectedUserKey) {
      return false;
    }

    const expectedThreadId = snapshot.id;
    const requestSeq = threadSaveRequestSeqRef.current + 1;
    threadSaveRequestSeqRef.current = requestSeq;
    setIsSavingThread(true);

    try {
      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "save",
          thread: snapshot,
        }),
      });

      const payload = (await response.json()) as ThreadsApiResponse;
      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        if (authRequired) {
          setIsAzureAuthRequired(true);
          setThreadError("Azure login is required. Open Settings and sign in to continue.");
          return false;
        }

        throw new Error(payload.error || "Failed to save thread.");
      }

      const savedThread = readThreadSnapshotFromUnknown(payload.thread, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      if (!savedThread) {
        throw new Error("Saved thread payload is invalid.");
      }
      if (expectedUserKey !== activeThreadsUserKeyRef.current.trim()) {
        return false;
      }

      if (expectedThreadId !== savedThread.id) {
        return false;
      }

      setThreads((current) => upsertThreadSnapshot(current, savedThread));
      threadSaveSignatureByIdRef.current.set(savedThread.id, signature);
      if (savedThread.id === activeThreadIdRef.current) {
        setActiveThreadNameInput(savedThread.name);
      }
      return true;
    } catch (saveError) {
      setThreadError(saveError instanceof Error ? saveError.message : "Failed to save thread.");
      return false;
    } finally {
      if (requestSeq === threadSaveRequestSeqRef.current) {
        setIsSavingThread(false);
      }
    }
  }

  async function flushActiveThreadSnapshot(): Promise<boolean> {
    const currentThreadId = activeThreadIdRef.current.trim();
    if (!currentThreadId) {
      return true;
    }

    clearThreadNameSaveTimeout();

    const baseThread = threads.find((thread) => thread.id === currentThreadId);
    if (!baseThread) {
      return true;
    }

    const snapshot = buildThreadSnapshotFromCurrentState(baseThread, {
      includeDraftName: true,
    });
    const signature = buildThreadSaveSignature(snapshot);
    const savedSignature = threadSaveSignatureByIdRef.current.get(currentThreadId);
    if (savedSignature === signature) {
      return true;
    }

    clearThreadSaveTimeout();
    return await saveThreadSnapshotToDatabase(snapshot, signature);
  }

  async function saveActiveThreadNameInBackground(
    threadId: string,
    name: string,
  ): Promise<void> {
    const normalizedThreadId = threadId.trim();
    const normalizedName = name.trim().slice(0, HOME_THREAD_NAME_MAX_LENGTH);
    if (!normalizedThreadId || !normalizedName) {
      return;
    }
    if (normalizedThreadId !== activeThreadIdRef.current.trim()) {
      return;
    }

    const baseThread = threads.find((thread) => thread.id === normalizedThreadId);
    if (!baseThread || baseThread.name === normalizedName) {
      return;
    }

    const snapshot = buildThreadSnapshotFromCurrentState(baseThread, {
      includeDraftName: true,
    });
    snapshot.name = normalizedName;

    const signature = buildThreadSaveSignature(snapshot);
    const savedSignature = threadSaveSignatureByIdRef.current.get(normalizedThreadId);
    if (savedSignature === signature) {
      return;
    }

    await saveThreadSnapshotToDatabase(snapshot, signature);
  }

  async function loadThreads(): Promise<void> {
    const expectedUserKey = activeThreadsUserKeyRef.current.trim();
    if (!expectedUserKey) {
      clearThreadsState();
      return;
    }

    const requestSeq = threadLoadRequestSeqRef.current + 1;
    threadLoadRequestSeqRef.current = requestSeq;
    setIsLoadingThreads(true);
    setThreadError(null);

    try {
      const response = await fetch("/api/threads", {
        method: "GET",
      });
      const payload = (await response.json()) as ThreadsApiResponse;
      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        if (authRequired) {
          setIsAzureAuthRequired(true);
          clearThreadsState("Azure login is required. Open Settings and sign in to load threads.");
          return;
        }

        throw new Error(payload.error || "Failed to load threads.");
      }

      if (requestSeq !== threadLoadRequestSeqRef.current) {
        return;
      }
      if (expectedUserKey !== activeThreadsUserKeyRef.current.trim()) {
        return;
      }

      const parsedThreads = readThreadListFromApiPayload(payload);
      if (parsedThreads.length === 0) {
        throw new Error("No threads were returned from the server.");
      }

      setThreadSaveSignatures(parsedThreads);
      setThreads(parsedThreads);
      isThreadsReadyRef.current = true;
      setThreadError(null);

      const preferredThreadId = activeThreadIdRef.current.trim();
      const nextThread =
        parsedThreads.find((thread) => thread.id === preferredThreadId) ?? parsedThreads[0];
      if (!nextThread) {
        throw new Error("No thread is available.");
      }

      applyThreadSnapshotToState(nextThread);
    } catch (loadError) {
      if (requestSeq !== threadLoadRequestSeqRef.current) {
        return;
      }
      if (expectedUserKey !== activeThreadsUserKeyRef.current.trim()) {
        return;
      }

      setThreadError(loadError instanceof Error ? loadError.message : "Failed to load threads.");
    } finally {
      if (requestSeq === threadLoadRequestSeqRef.current) {
        setIsLoadingThreads(false);
      }
    }
  }

  async function createThreadAndSwitch(options: {
    name?: string;
    openThreadsTab?: boolean;
    clearNameInput?: boolean;
  } = {}): Promise<boolean> {
    if (isSending || isLoadingThreads || isSwitchingThread || isCreatingThread) {
      return false;
    }

    setThreadError(null);
    setIsCreatingThread(true);

    try {
      const saved = await flushActiveThreadSnapshot();
      if (!saved) {
        return false;
      }

      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "create",
          name: options.name ?? "",
        }),
      });
      const payload = (await response.json()) as ThreadsApiResponse;
      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        if (authRequired) {
          setIsAzureAuthRequired(true);
          throw new Error("Azure login is required. Open Settings and sign in to continue.");
        }

        throw new Error(payload.error || "Failed to create thread.");
      }

      const createdThread = readThreadSnapshotFromUnknown(payload.thread, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      if (!createdThread) {
        throw new Error("Created thread payload is invalid.");
      }

      const createdSignature = buildThreadSaveSignature(createdThread);
      threadSaveSignatureByIdRef.current.set(createdThread.id, createdSignature);
      setThreads((current) => upsertThreadSnapshot(current, createdThread));
      isThreadsReadyRef.current = true;
      if (options.clearNameInput === true) {
        setNewThreadNameInput("");
      }
      applyThreadSnapshotToState(createdThread);
      if (options.openThreadsTab === true) {
        setActiveMainTab("threads");
      }
      return true;
    } catch (createError) {
      setThreadError(createError instanceof Error ? createError.message : "Failed to create thread.");
      return false;
    } finally {
      setIsCreatingThread(false);
    }
  }

  async function handleCreateThread() {
    await createThreadAndSwitch({
      name: newThreadNameInput,
      openThreadsTab: true,
      clearNameInput: true,
    });
  }

  async function handleCreateThreadFromPlaygroundHeader() {
    await createThreadAndSwitch({
      name: "",
      openThreadsTab: false,
      clearNameInput: false,
    });
  }

  function handleActiveThreadNameInputChange(value: string) {
    const normalized = value.slice(0, HOME_THREAD_NAME_MAX_LENGTH);
    setActiveThreadNameInput(normalized);
    setThreadError(null);
  }

  async function handleThreadChange(nextThreadIdRaw: string) {
    const nextThreadId = nextThreadIdRaw.trim();
    setThreadError(null);
    if (!nextThreadId || nextThreadId === activeThreadIdRef.current) {
      setSelectedThreadId(activeThreadIdRef.current);
      return;
    }

    if (isSending) {
      setSelectedThreadId(activeThreadIdRef.current);
      setThreadError("Cannot switch threads while a message is being sent.");
      return;
    }

    const nextThread = threads.find((thread) => thread.id === nextThreadId);
    if (!nextThread) {
      setSelectedThreadId(activeThreadIdRef.current);
      setThreadError("Selected thread is not available.");
      return;
    }

    setSelectedThreadId(nextThreadId);
    setIsSwitchingThread(true);
    try {
      const saved = await flushActiveThreadSnapshot();
      if (!saved) {
        setSelectedThreadId(activeThreadIdRef.current);
        return;
      }

      applyThreadSnapshotToState(nextThread);
    } finally {
      setIsSwitchingThread(false);
    }
  }

  function handleReloadThreads() {
    if (isSending || isSwitchingThread) {
      return;
    }

    void loadThreads();
  }

  async function loadAzureSelectionPreference(
    tenantId: string,
    principalId: string,
  ): Promise<AzureSelectionPreference | null> {
    const normalizedTenantId = tenantId.trim();
    const normalizedPrincipalId = principalId.trim();
    if (!normalizedTenantId || !normalizedPrincipalId) {
      return null;
    }

    try {
      const response = await fetch("/api/azure-selection", {
        method: "GET",
      });
      const payload = (await response.json()) as AzureSelectionApiResponse;
      if (!response.ok) {
        return null;
      }

      return readAzureSelectionFromUnknown(
        payload.selection,
        normalizedTenantId,
        normalizedPrincipalId,
      );
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
        body: JSON.stringify({
          projectId: selection.projectId,
          deploymentName: selection.deploymentName,
        }),
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
        activeAzurePrincipalIdRef.current = "";
        activeSavedMcpUserKeyRef.current = "";
        activeThreadsUserKeyRef.current = "";
        preferredAzureSelectionRef.current = null;
        clearSavedMcpServersState();
        clearThreadsState(
          authRequired
            ? "Azure login is required. Open Settings and sign in to load threads."
            : null,
        );
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
      const principalId = readPrincipalIdFromUnknown(payload.principalId);
      activeAzureTenantIdRef.current = tenantId;
      activeAzurePrincipalIdRef.current = principalId;
      const nextSavedMcpUserKey =
        tenantId && principalId ? `${tenantId}::${principalId}` : "";
      if (!nextSavedMcpUserKey) {
        activeSavedMcpUserKeyRef.current = "";
        activeThreadsUserKeyRef.current = "";
        clearSavedMcpServersState();
        clearThreadsState();
      } else if (activeSavedMcpUserKeyRef.current !== nextSavedMcpUserKey) {
        activeSavedMcpUserKeyRef.current = nextSavedMcpUserKey;
        void loadSavedMcpServers();
      }
      if (!nextSavedMcpUserKey) {
        activeThreadsUserKeyRef.current = "";
      } else if (activeThreadsUserKeyRef.current !== nextSavedMcpUserKey) {
        activeThreadsUserKeyRef.current = nextSavedMcpUserKey;
        void loadThreads();
      } else if (!isThreadsReadyRef.current && !isLoadingThreads) {
        void loadThreads();
      }
      if (shouldScheduleSavedMcpLoginRetry(isAzureAuthRequired, nextSavedMcpUserKey)) {
        // After login completes, token propagation can briefly lag for MCP route auth.
        scheduleSavedMcpLoginRetry(nextSavedMcpUserKey);
      } else {
        clearSavedMcpLoginRetryTimeout();
      }
      const preferredSelection =
        tenantId && principalId
          ? await loadAzureSelectionPreference(tenantId, principalId)
          : null;
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
      activeAzurePrincipalIdRef.current = "";
      activeSavedMcpUserKeyRef.current = "";
      activeThreadsUserKeyRef.current = "";
      preferredAzureSelectionRef.current = null;
      clearSavedMcpServersState();
      clearThreadsState();
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
        if (authRequired) {
          activeAzureTenantIdRef.current = "";
          activeAzurePrincipalIdRef.current = "";
          activeSavedMcpUserKeyRef.current = "";
          activeThreadsUserKeyRef.current = "";
          preferredAzureSelectionRef.current = null;
          clearSavedMcpServersState();
          clearThreadsState("Azure login is required. Open Settings and sign in to load threads.");
        }
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
      const principalIdFromPayload = readPrincipalIdFromUnknown(payload.principalId);
      if (tenantIdFromPayload) {
        activeAzureTenantIdRef.current = tenantIdFromPayload;
      }
      if (principalIdFromPayload) {
        activeAzurePrincipalIdRef.current = principalIdFromPayload;
      }

      const preferredSelection = preferredAzureSelectionRef.current;
      const preferredDeploymentName =
        preferredSelection &&
        preferredSelection.tenantId === activeAzureTenantIdRef.current &&
        preferredSelection.principalId === activeAzurePrincipalIdRef.current &&
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
      const authRequired = isMcpServersAuthRequired(response.status, payload);
      if (authRequired) {
        setIsAzureAuthRequired(true);
        throw new Error("Azure login is required. Open Settings and sign in to save MCP servers.");
      }
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

  function connectMcpServerToAgent(serverToConnect: McpServerConfig) {
    setMcpServers((current) => {
      const existingIndex = current.findIndex(
        (server) => buildMcpServerKey(server) === buildMcpServerKey(serverToConnect),
      );
      if (existingIndex >= 0) {
        return current.map((server, index) =>
          index === existingIndex ? { ...server, name: serverToConnect.name } : server,
        );
      }

      return [...current, serverToConnect];
    });
  }

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isSending) {
      return;
    }

    if (isLoadingThreads || isSwitchingThread) {
      setThreadError("Thread state is updating. Please wait.");
      setActiveMainTab("threads");
      return;
    }

    if (!activeThreadIdRef.current.trim()) {
      setThreadError("Select or create a thread before sending.");
      setActiveMainTab("threads");
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
    const requestAttachments = draftAttachments.map(
      ({ id: _id, ...attachment }) => attachment,
    );
    const userMessage: ChatMessage = createMessage(
      "user",
      content,
      turnId,
      requestAttachments,
    );
    const history = messages
      .map(({ role, content: previousContent, attachments }) => {
        if (role === "user" && attachments.length > 0) {
          return {
            role,
            content: previousContent,
            attachments,
          };
        }

        return {
          role,
          content: previousContent,
        };
      });

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setDraftAttachments([]);
    setChatAttachmentError(null);
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
          attachments: requestAttachments,
          history,
          azureConfig: {
            projectName: activeAzureConnection.projectName,
            baseUrl: activeAzureConnection.baseUrl,
            apiVersion: activeAzureConnection.apiVersion,
            deploymentName,
          },
          reasoningEffort,
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

  function handleReloadSavedMcpServers() {
    setSavedMcpError(null);
    void loadSavedMcpServers();
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
    setChatAttachmentError(null);
    resizeChatInput(event.currentTarget);
  }

  function handleOpenChatAttachmentPicker() {
    if (isSending || isChatLocked) {
      return;
    }

    chatAttachmentInputRef.current?.click();
  }

  async function handleChatAttachmentFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.currentTarget;
    const selectedFiles = input.files ? Array.from(input.files) : [];
    if (selectedFiles.length === 0) {
      input.value = "";
      return;
    }

    setChatAttachmentError(null);

    const availableSlots = CHAT_ATTACHMENT_MAX_FILES - draftAttachments.length;
    if (availableSlots <= 0) {
      setChatAttachmentError(`You can attach up to ${CHAT_ATTACHMENT_MAX_FILES} files.`);
      input.value = "";
      return;
    }

    const filesToProcess = selectedFiles.slice(0, availableSlots);
    const nextAttachments: DraftChatAttachment[] = [];
    let nextTotalSize = draftAttachmentTotalSizeBytes;
    let nextPdfTotalSize = draftPdfAttachmentTotalSizeBytes;
    let validationError: string | null = null;

    for (const file of filesToProcess) {
      const normalizedName = file.name.trim() || "attachment";
      if (normalizedName.length > CHAT_ATTACHMENT_MAX_FILE_NAME_LENGTH) {
        validationError = `Attachment file names must be ${CHAT_ATTACHMENT_MAX_FILE_NAME_LENGTH} characters or fewer.`;
        break;
      }

      const extension = getFileExtension(normalizedName);
      if (!CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.has(extension)) {
        validationError = `Attachment "${normalizedName}" is not supported. Only ${chatAttachmentFormatHint} files can be attached.`;
        break;
      }

      const normalizedMimeType = file.type.trim().toLowerCase();

      if (file.size <= 0) {
        validationError = `Attachment "${normalizedName}" is empty.`;
        break;
      }

      const maxFileSizeBytes =
        extension === "pdf"
          ? CHAT_ATTACHMENT_MAX_PDF_FILE_SIZE_BYTES
          : CHAT_ATTACHMENT_MAX_NON_PDF_FILE_SIZE_BYTES;
      if (file.size > maxFileSizeBytes) {
        validationError = `Attachment "${normalizedName}" is too large. Max size is ${formatChatAttachmentSize(maxFileSizeBytes)} for .${extension} files.`;
        break;
      }

      if (nextTotalSize + file.size > CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES) {
        validationError = `Total attachment size cannot exceed ${formatChatAttachmentSize(CHAT_ATTACHMENT_MAX_TOTAL_SIZE_BYTES)}.`;
        break;
      }
      if (
        extension === "pdf" &&
        nextPdfTotalSize + file.size > CHAT_ATTACHMENT_MAX_PDF_TOTAL_SIZE_BYTES
      ) {
        validationError = `Total PDF attachment size cannot exceed ${formatChatAttachmentSize(CHAT_ATTACHMENT_MAX_PDF_TOTAL_SIZE_BYTES)}.`;
        break;
      }

      try {
        const dataUrl = await readFileAsDataUrl(file);
        nextAttachments.push({
          id: createId("attachment"),
          name: normalizedName,
          mimeType: normalizedMimeType || "application/octet-stream",
          sizeBytes: file.size,
          dataUrl,
        });
        nextTotalSize += file.size;
        if (extension === "pdf") {
          nextPdfTotalSize += file.size;
        }
      } catch {
        validationError = `Failed to read "${normalizedName}".`;
        break;
      }
    }

    if (!validationError && selectedFiles.length > filesToProcess.length) {
      validationError = `You can attach up to ${CHAT_ATTACHMENT_MAX_FILES} files.`;
    }

    if (nextAttachments.length > 0) {
      setDraftAttachments((current) => [...current, ...nextAttachments]);
    }

    setChatAttachmentError(validationError);
    input.value = "";
  }

  function handleRemoveDraftAttachment(id: string) {
    setDraftAttachments((current) => current.filter((attachment) => attachment.id !== id));
    setChatAttachmentError(null);
  }

  function resizeChatInput(input: HTMLTextAreaElement) {
    input.style.height = "auto";
    const boundedHeight = Math.max(
      HOME_CHAT_INPUT_MIN_HEIGHT_PX,
      Math.min(input.scrollHeight, HOME_CHAT_INPUT_MAX_HEIGHT_PX),
    );
    input.style.height = `${boundedHeight}px`;
    input.style.overflowY = input.scrollHeight > HOME_CHAT_INPUT_MAX_HEIGHT_PX ? "auto" : "hidden";
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
    const principalId = activeAzurePrincipalIdRef.current.trim();
    const projectId = (activeAzureConnection?.id ?? "").trim();
    if (!tenantId || !principalId || !projectId || !nextDeploymentName) {
      return;
    }

    if (!azureDeployments.includes(nextDeploymentName)) {
      return;
    }

    void saveAzureSelectionPreference({
      tenantId,
      principalId,
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
    if (!INSTRUCTION_ALLOWED_EXTENSIONS.has(extension)) {
      setInstructionFileError("Only .md, .txt, .xml, and .json files are supported.");
      input.value = "";
      return;
    }

    if (file.size > INSTRUCTION_MAX_FILE_SIZE_BYTES) {
      setInstructionFileError(
        `Instruction file is too large. Max ${INSTRUCTION_MAX_FILE_SIZE_LABEL}.`,
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
      const response = await fetch("/api/instruction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message: enhanceRequestMessage,
          azureConfig: {
            projectName: activeAzureConnection.projectName,
            baseUrl: activeAzureConnection.baseUrl,
            apiVersion: activeAzureConnection.apiVersion,
            deploymentName,
          },
          enhanceAgentInstruction: INSTRUCTION_ENHANCE_SYSTEM_PROMPT,
        }),
      });

      const payload = (await response.json()) as ChatApiResponse;
      if (!response.ok || payload.error) {
        if (payload.errorCode === "azure_login_required") {
          setIsAzureAuthRequired(true);
        }

        throw new Error(payload.error || "Failed to enhance instruction.");
      }

      const rawInstructionPatch =
        typeof payload.message === "string" ? payload.message : "";
      const normalizedInstructionPatch = normalizeInstructionDiffPatchResponse(
        rawInstructionPatch,
      );
      if (!normalizedInstructionPatch) {
        setInstructionEnhanceSuccess("No changes were suggested.");
        return;
      }

      const patchApplyResult = applyInstructionUnifiedDiffPatch(
        currentInstruction,
        normalizedInstructionPatch,
      );
      if (!patchApplyResult.ok) {
        throw new Error(patchApplyResult.error);
      }
      const normalizedEnhancedInstruction = patchApplyResult.value;
      const formatValidation = validateEnhancedInstructionFormat(
        normalizedEnhancedInstruction,
        instructionExtension,
      );
      if (!formatValidation.ok) {
        throw new Error(formatValidation.error);
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
        diffPatch: normalizedInstructionPatch,
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

      let azureAuthScope = MCP_DEFAULT_AZURE_AUTH_SCOPE;
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

      connectMcpServerToAgent({ ...serverToAdd, name: savedProfileName });

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
    setMcpAzureAuthScopeInput(MCP_DEFAULT_AZURE_AUTH_SCOPE);
    setMcpTimeoutSecondsInput(String(MCP_DEFAULT_TIMEOUT_SECONDS));
    setMcpTransport(HOME_DEFAULT_MCP_TRANSPORT);
  }

  function handleConnectSelectedMcpServer() {
    if (!selectedSavedMcpServerId) {
      setSavedMcpError("Select an MCP server first.");
      return;
    }

    const selected = savedMcpServers.find((server) => server.id === selectedSavedMcpServerId);
    if (!selected) {
      setSavedMcpError("Selected MCP server is not available.");
      return;
    }

    connectMcpServerToAgent(selected);
    setSavedMcpError(null);
  }

  function handleRemoveMcpServer(id: string) {
    setMcpServers((current) => current.filter((server) => server.id !== id));
  }

  function handleMainSplitterPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const layoutElement = layoutRef.current;
    if (!layoutElement) {
      return;
    }

    const rect = layoutElement.getBoundingClientRect();
    const maxRightWidth = resolveMainSplitterMaxRightWidth(rect.width);
    setActiveResizeHandle("main");

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextRightWidth = rect.right - moveEvent.clientX;
      setRightPaneWidth(
        clampNumber(nextRightWidth, HOME_MAIN_SPLITTER_MIN_RIGHT_WIDTH_PX, maxRightWidth),
      );
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

    if (isAzureAuthRequired || isLikelyChatAzureAuthError(azureConnectionError)) {
      setIsAzureAuthRequired(true);
      setActiveMainTab("settings");
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
    onConnectSelectedMcpServer: handleConnectSelectedMcpServer,
    onReloadSavedMcpServers: handleReloadSavedMcpServers,
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
        setMcpAzureAuthScopeInput(MCP_DEFAULT_AZURE_AUTH_SCOPE);
      }
    },
    mcpAzureAuthScopeInput,
    onMcpAzureAuthScopeInputChange: setMcpAzureAuthScopeInput,
    mcpTimeoutSecondsInput,
    onMcpTimeoutSecondsInputChange: setMcpTimeoutSecondsInput,
    defaultMcpAzureAuthScope: MCP_DEFAULT_AZURE_AUTH_SCOPE,
    defaultMcpTimeoutSeconds: MCP_DEFAULT_TIMEOUT_SECONDS,
    minMcpTimeoutSeconds: MCP_TIMEOUT_SECONDS_MIN,
    maxMcpTimeoutSeconds: MCP_TIMEOUT_SECONDS_MAX,
    onAddMcpServer: handleAddMcpServer,
    isSavingMcpServer,
    mcpFormError,
    mcpFormWarning,
  };

  const threadsTabProps = {
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
    threadOptions: threadSummaries.map((thread) => ({
      id: thread.id,
      name: thread.name,
      updatedAt: thread.updatedAt,
      messageCount: thread.messageCount,
      mcpServerCount: thread.mcpServerCount,
    })),
    activeThreadId: selectedThreadId || activeThreadId,
    newThreadNameInput,
    isSending: isSending || isSavingThread,
    isLoadingThreads,
    isSwitchingThread,
    isCreatingThread,
    threadError,
    onActiveThreadChange: (threadId: string) => {
      void handleThreadChange(threadId);
    },
    onNewThreadNameInputChange: setNewThreadNameInput,
    onCreateThread: handleCreateThread,
    onReloadThreads: handleReloadThreads,
  };

  const playgroundPanelProps = {
    messages,
    mcpHistoryByTurnId,
    isSending,
    isUpdatingThread: isCreatingThread || isSwitchingThread || isLoadingThreads,
    activeThreadNameInput,
    onActiveThreadNameChange: handleActiveThreadNameInputChange,
    onCreateThread: handleCreateThreadFromPlaygroundHeader,
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
    chatAttachmentInputRef,
    chatAttachmentAccept,
    chatAttachmentFormatHint,
    draft,
    chatAttachments: draftAttachments,
    chatAttachmentError,
    onDraftChange: handleDraftChange,
    onOpenChatAttachmentPicker: handleOpenChatAttachmentPicker,
    onChatAttachmentFileChange: handleChatAttachmentFileChange,
    onRemoveChatAttachment: handleRemoveDraftAttachment,
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
    reasoningEffortOptions,
    onReasoningEffortChange: setReasoningEffort,
    maxChatAttachmentFiles: CHAT_ATTACHMENT_MAX_FILES,
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
          threadsTabProps={threadsTabProps}
        />
      </div>
    </main>
  );
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

function isLikelyChatAzureAuthError(message: string | null): boolean {
  if (!message) {
    return false;
  }

  const normalizedMessage = message.toLowerCase();
  return [
    "azure login is required",
    "az login",
    "defaultazurecredential",
    "credential",
    "authentication",
    "authorization",
    "unauthorized",
    "forbidden",
    "access token",
    "aadsts",
  ].some((pattern) => normalizedMessage.includes(pattern));
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

function renderMessageContent(message: ChatMessage) {
  if (message.role !== "assistant") {
    return (
      <div className="user-message-body">
        <p>{message.content}</p>
        {message.attachments.length > 0 ? (
          <ul className="user-message-attachments" aria-label="Attached files">
            {message.attachments.map((attachment, index) => (
              <li key={`${message.id}-attachment-${index}`}>
                <span className="user-message-attachment-name">{attachment.name}</span>
                <span className="user-message-attachment-size">
                  {formatChatAttachmentSize(attachment.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
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
