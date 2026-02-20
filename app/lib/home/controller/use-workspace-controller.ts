import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { MainViewTab, McpTransport, ReasoningEffort } from "~/lib/home/shared/view-types";
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
  HOME_DEFAULT_THREAD_REQUEST_STATE,
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
import { buildMcpHistoryByTurnId } from "~/lib/home/chat/history";
import type { DraftChatAttachment } from "~/lib/home/chat/attachments";
import { formatChatAttachmentSize, readFileAsDataUrl } from "~/lib/home/chat/attachments";
import type { ChatMessage } from "~/lib/home/chat/messages";
import { createMessage } from "~/lib/home/chat/messages";
import type { ChatApiResponse, McpRpcHistoryEntry } from "~/lib/home/chat/stream";
import {
  readChatEventStreamPayload,
  upsertMcpRpcHistoryEntry,
} from "~/lib/home/chat/stream";
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
import {
  installGlobalClientErrorLogging,
  reportClientError,
  reportClientWarning,
} from "~/lib/home/observability/app-event-log-client";
import {
  buildThreadSummary,
  readThreadSnapshotFromUnknown,
  readThreadSnapshotList,
} from "~/lib/home/thread/parsers";
import {
  buildThreadSaveSignature,
  cloneMcpRpcHistory,
  cloneMcpServers,
  cloneMessages,
  upsertThreadSnapshot,
} from "~/lib/home/thread/snapshot-state";
import type { ThreadSnapshot, ThreadSummary } from "~/lib/home/thread/types";
import { copyTextToClipboard } from "~/lib/home/shared/clipboard";
import { getFileExtension } from "~/lib/home/shared/files";
import { createId } from "~/lib/home/shared/ids";
import { clampNumber } from "~/lib/home/shared/numbers";
import {
  type AzureActionApiResponse,
  type AzureConnectionsApiResponse,
  type AzureSelectionApiResponse,
  type InstructionEnhanceComparison,
  type McpServersApiResponse,
  type ThreadRequestState,
  type ThreadsApiResponse,
} from "~/lib/home/controller/types";

export function useWorkspaceController() {
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
  const [threadRequestStateById, setThreadRequestStateById] = useState<
    Record<string, ThreadRequestState>
  >({});
  const [isComposing, setIsComposing] = useState(false);
  const [uiError, setUiError] = useState<string | null>(null);
  const [systemNotice, setSystemNotice] = useState<string | null>(null);
  const [isStartingAzureLogin, setIsStartingAzureLogin] = useState(false);
  const [isStartingAzureLogout, setIsStartingAzureLogout] = useState(false);
  const [azureLoginError, setAzureLoginError] = useState<string | null>(null);
  const [azureLogoutError, setAzureLogoutError] = useState<string | null>(null);
  const [mcpRpcHistory, setMcpRpcHistory] = useState<McpRpcHistoryEntry[]>([]);
  const [threads, setThreads] = useState<ThreadSnapshot[]>([]);
  const [activeThreadId, setActiveThreadId] = useState("");
  const [activeThreadNameInput, setActiveThreadNameInput] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState("");
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
  const activeMainTabRef = useRef<MainViewTab>("threads");
  const selectedAzureConnectionIdRef = useRef("");
  const selectedAzureDeploymentNameRef = useRef("");
  const isApplyingThreadStateRef = useRef(false);
  const isThreadsReadyRef = useRef(false);
  const threadNameSaveTimeoutRef = useRef<number | null>(null);
  const threadSaveTimeoutRef = useRef<number | null>(null);
  const threadLoadRequestSeqRef = useRef(0);
  const threadSaveRequestSeqRef = useRef(0);
  const threadSaveSignatureByIdRef = useRef(new Map<string, string>());
  const threadRequestStateByIdRef = useRef<Record<string, ThreadRequestState>>({});
  const threadsRef = useRef<ThreadSnapshot[]>([]);
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
  const activeThreadRequestState =
    threadRequestStateById[activeThreadId] ?? HOME_DEFAULT_THREAD_REQUEST_STATE;
  const isSending = activeThreadRequestState.isSending;
  const sendProgressMessages = activeThreadRequestState.sendProgressMessages;
  const activeTurnId = activeThreadRequestState.activeTurnId;
  const lastErrorTurnId = activeThreadRequestState.lastErrorTurnId;
  const error = uiError ?? activeThreadRequestState.error;
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

  function buildRuntimeLogContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      activeMainTab: activeMainTabRef.current,
      activeThreadId: activeThreadIdRef.current,
      selectedAzureConnectionId: selectedAzureConnectionIdRef.current,
      selectedAzureDeploymentName: selectedAzureDeploymentNameRef.current,
      tenantId: activeAzureTenantIdRef.current,
      principalId: activeAzurePrincipalIdRef.current,
      ...extra,
    };
  }

  function logHomeError(
    eventName: string,
    error: unknown,
    options: {
      category?: string;
      location?: string;
      action?: string;
      statusCode?: number;
      context?: Record<string, unknown>;
    } = {},
  ): void {
    reportClientError(eventName, error, {
      category: options.category ?? "frontend",
      location: options.location ?? "home",
      action: options.action,
      ...(options.statusCode !== undefined ? { statusCode: options.statusCode } : {}),
      threadId: activeThreadIdRef.current || undefined,
      context: buildRuntimeLogContext(options.context),
    });
  }

  function logHomeWarning(
    eventName: string,
    message: string,
    options: {
      category?: string;
      location?: string;
      action?: string;
      context?: Record<string, unknown>;
    } = {},
  ): void {
    reportClientWarning(eventName, message, {
      category: options.category ?? "frontend",
      location: options.location ?? "home",
      action: options.action,
      threadId: activeThreadIdRef.current || undefined,
      context: buildRuntimeLogContext(options.context),
    });
  }

  useEffect(() => {
    activeMainTabRef.current = activeMainTab;
  }, [activeMainTab]);

  useEffect(() => {
    selectedAzureConnectionIdRef.current = selectedAzureConnectionId;
  }, [selectedAzureConnectionId]);

  useEffect(() => {
    selectedAzureDeploymentNameRef.current = selectedAzureDeploymentName;
  }, [selectedAzureDeploymentName]);

  useEffect(() => {
    return installGlobalClientErrorLogging(() =>
      buildRuntimeLogContext({
        source: "home",
      }),
    );
  }, []);

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
          setUiError(null);
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
    threadRequestStateByIdRef.current = threadRequestStateById;
  }, [threadRequestStateById]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

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

    const baseThread = threadsRef.current.find((thread) => thread.id === currentThreadId);
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

    const baseThread = threadsRef.current.find((thread) => thread.id === currentThreadId);
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
      logHomeError("load_saved_mcp_servers_failed", loadError, {
        action: "load_saved_mcp_servers",
        statusCode: 500,
      });
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

  function setThreadsState(nextThreads: ThreadSnapshot[]): void {
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
  }

  function updateThreadsState(
    updater: (current: ThreadSnapshot[]) => ThreadSnapshot[],
  ): ThreadSnapshot[] {
    const nextThreads = updater(threadsRef.current);
    threadsRef.current = nextThreads;
    setThreads(nextThreads);
    return nextThreads;
  }

  function clearThreadsState(nextError: string | null = null) {
    clearThreadNameSaveTimeout();
    clearThreadSaveTimeout();
    isThreadsReadyRef.current = false;
    activeThreadIdRef.current = "";
    isApplyingThreadStateRef.current = false;
    threadSaveSignatureByIdRef.current.clear();
    setThreadsState([]);
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
    setUiError(null);
    setSystemNotice(null);
    setThreadRequestStateById({});
    setIsComposing(false);
  }

  function readThreadRequestState(threadId: string): ThreadRequestState {
    if (!threadId) {
      return HOME_DEFAULT_THREAD_REQUEST_STATE;
    }

    return threadRequestStateByIdRef.current[threadId] ?? HOME_DEFAULT_THREAD_REQUEST_STATE;
  }

  function updateThreadRequestState(
    threadId: string,
    updater: (current: ThreadRequestState) => ThreadRequestState,
  ): void {
    if (!threadId) {
      return;
    }

    setThreadRequestStateById((current) => {
      const base = current[threadId] ?? HOME_DEFAULT_THREAD_REQUEST_STATE;
      const next = updater(base);
      return {
        ...current,
        [threadId]: next,
      };
    });
  }

  function appendThreadProgressMessage(threadId: string, message: string): void {
    const trimmed = message.trim();
    if (!threadId || !trimmed) {
      return;
    }

    updateThreadRequestState(threadId, (current) => {
      if (current.sendProgressMessages[current.sendProgressMessages.length - 1] === trimmed) {
        return current;
      }

      const nextMessages = [...current.sendProgressMessages, trimmed].slice(-8);
      return {
        ...current,
        sendProgressMessages: nextMessages,
      };
    });
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

  function setThreadSaveSignatures(nextThreads: ThreadSnapshot[]) {
    const signatureMap = threadSaveSignatureByIdRef.current;
    signatureMap.clear();
    for (const thread of nextThreads) {
      signatureMap.set(thread.id, buildThreadSaveSignature(thread));
    }
  }

  function updateThreadSnapshotById(
    threadId: string,
    updater: (current: ThreadSnapshot) => ThreadSnapshot,
  ): void {
    if (!threadId) {
      return;
    }

    updateThreadsState((current) => {
      const index = current.findIndex((thread) => thread.id === threadId);
      if (index < 0) {
        return current;
      }

      const base = current[index];
      const updatedThread = updater(base);
      const normalizedUpdatedThread = {
        ...updatedThread,
        updatedAt: updatedThread.updatedAt || new Date().toISOString(),
      };
      return upsertThreadSnapshot(current, normalizedUpdatedThread);
    });
  }

  function appendMessageToThreadState(threadId: string, message: ChatMessage): void {
    const clonedMessage: ChatMessage = {
      ...message,
      attachments: message.attachments.map((attachment) => ({ ...attachment })),
    };

    updateThreadSnapshotById(threadId, (thread) => ({
      ...thread,
      updatedAt: new Date().toISOString(),
      messages: [...thread.messages, clonedMessage],
    }));

    if (activeThreadIdRef.current === threadId) {
      setMessages((current) => [...current, clonedMessage]);
    }
  }

  function appendMcpRpcLogToThreadState(threadId: string, entry: McpRpcHistoryEntry): void {
    const clonedEntry: McpRpcHistoryEntry = { ...entry };

    updateThreadSnapshotById(threadId, (thread) => ({
      ...thread,
      updatedAt: new Date().toISOString(),
      mcpRpcHistory: upsertMcpRpcHistoryEntry(thread.mcpRpcHistory, clonedEntry),
    }));

    if (activeThreadIdRef.current === threadId) {
      setMcpRpcHistory((current) => upsertMcpRpcHistoryEntry(current, clonedEntry));
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
    setUiError(null);
    setSystemNotice(null);
    setIsComposing(false);

    window.setTimeout(() => {
      isApplyingThreadStateRef.current = false;
    }, 0);
  }

  async function saveThreadSnapshotToDatabase(
    snapshot: ThreadSnapshot,
    signature: string,
    options: {
      showBusy?: boolean;
      reportError?: boolean;
    } = {},
  ): Promise<boolean> {
    const showBusy = options.showBusy !== false;
    const reportError = options.reportError !== false;
    const expectedUserKey = activeThreadsUserKeyRef.current.trim();
    if (!expectedUserKey) {
      return false;
    }

    const expectedThreadId = snapshot.id;
    const requestSeq = threadSaveRequestSeqRef.current + 1;
    threadSaveRequestSeqRef.current = requestSeq;
    if (showBusy) {
      setIsSavingThread(true);
    }

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
          if (reportError) {
            setThreadError("Azure login is required. Open Settings and sign in to continue.");
          }
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

      updateThreadsState((current) => upsertThreadSnapshot(current, savedThread));
      threadSaveSignatureByIdRef.current.set(savedThread.id, signature);
      if (savedThread.id === activeThreadIdRef.current) {
        setActiveThreadNameInput(savedThread.name);
      }
      return true;
    } catch (saveError) {
      logHomeError("save_thread_snapshot_failed", saveError, {
        action: "save_thread_snapshot",
        statusCode: 500,
        context: {
          threadId: expectedThreadId,
        },
      });
      if (reportError) {
        setThreadError(saveError instanceof Error ? saveError.message : "Failed to save thread.");
      }
      return false;
    } finally {
      if (showBusy && requestSeq === threadSaveRequestSeqRef.current) {
        setIsSavingThread(false);
      }
    }
  }

  async function saveThreadSnapshotSilentlyIfNeeded(threadId: string): Promise<void> {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) {
      return;
    }

    const snapshot = threadsRef.current.find((thread) => thread.id === normalizedThreadId);
    if (!snapshot) {
      return;
    }

    const signature = buildThreadSaveSignature(snapshot);
    const savedSignature = threadSaveSignatureByIdRef.current.get(normalizedThreadId);
    if (savedSignature === signature) {
      return;
    }

    await saveThreadSnapshotToDatabase(snapshot, signature, {
      showBusy: false,
      reportError: false,
    });
  }

  async function flushActiveThreadSnapshot(): Promise<boolean> {
    const currentThreadId = activeThreadIdRef.current.trim();
    if (!currentThreadId) {
      return true;
    }

    clearThreadNameSaveTimeout();

    const baseThread = threadsRef.current.find((thread) => thread.id === currentThreadId);
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

    const baseThread = threadsRef.current.find((thread) => thread.id === normalizedThreadId);
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

      const parsedThreads = readThreadSnapshotList(payload.threads, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      if (parsedThreads.length === 0) {
        throw new Error("No threads were returned from the server.");
      }

      setThreadSaveSignatures(parsedThreads);
      setThreadsState(parsedThreads);
      setThreadRequestStateById((current) => {
        const next: Record<string, ThreadRequestState> = {};
        const validIds = new Set(parsedThreads.map((thread) => thread.id));
        for (const [threadId, state] of Object.entries(current)) {
          if (validIds.has(threadId)) {
            next[threadId] = state;
          }
        }
        return next;
      });
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

      logHomeError("load_threads_failed", loadError, {
        action: "load_threads",
        statusCode: 500,
      });
      setThreadError(loadError instanceof Error ? loadError.message : "Failed to load threads.");
    } finally {
      if (requestSeq === threadLoadRequestSeqRef.current) {
        setIsLoadingThreads(false);
      }
    }
  }

  async function createThreadAndSwitch(options: {
    name?: string;
  } = {}): Promise<boolean> {
    if (isLoadingThreads || isSwitchingThread || isCreatingThread) {
      return false;
    }

    setThreadError(null);
    setIsCreatingThread(true);

    try {
      const currentThreadId = activeThreadIdRef.current.trim();
      if (!readThreadRequestState(currentThreadId).isSending) {
        const saved = await flushActiveThreadSnapshot();
        if (!saved) {
          return false;
        }
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
      updateThreadsState((current) => upsertThreadSnapshot(current, createdThread));
      isThreadsReadyRef.current = true;
      applyThreadSnapshotToState(createdThread);
      return true;
    } catch (createError) {
      logHomeError("create_thread_failed", createError, {
        action: "create_thread",
        statusCode: 500,
      });
      setThreadError(createError instanceof Error ? createError.message : "Failed to create thread.");
      return false;
    } finally {
      setIsCreatingThread(false);
    }
  }

  async function handleCreateThreadFromPlaygroundHeader() {
    await createThreadAndSwitch({
      name: "",
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

    const nextThread = threadsRef.current.find((thread) => thread.id === nextThreadId);
    if (!nextThread) {
      setSelectedThreadId(activeThreadIdRef.current);
      setThreadError("Selected thread is not available.");
      return;
    }

    setSelectedThreadId(nextThreadId);
    setIsSwitchingThread(true);
    try {
      const currentThreadId = activeThreadIdRef.current.trim();
      if (!readThreadRequestState(currentThreadId).isSending) {
        const saved = await flushActiveThreadSnapshot();
        if (!saved) {
          setSelectedThreadId(activeThreadIdRef.current);
          return;
        }
      }

      applyThreadSnapshotToState(nextThread);
    } finally {
      setIsSwitchingThread(false);
    }
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
    } catch (selectionError) {
      logHomeError("load_azure_selection_failed", selectionError, {
        action: "load_azure_selection",
      });
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
    } catch (selectionSaveError) {
      logHomeError("save_azure_selection_failed", selectionSaveError, {
        action: "save_azure_selection",
      });
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
      logHomeError("load_azure_connections_failed", loadError, {
        action: "load_azure_connections",
      });
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

      logHomeError("load_azure_deployments_failed", loadError, {
        action: "load_azure_deployments",
        context: {
          projectId,
        },
      });
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
    const threadId = activeThreadIdRef.current.trim();
    const content = draft.trim();
    if (!content) {
      return;
    }

    if (!threadId) {
      setThreadError("Select or create a thread before sending.");
      setActiveMainTab("threads");
      return;
    }

    if (readThreadRequestState(threadId).isSending) {
      return;
    }

    if (isLoadingThreads || isSwitchingThread) {
      setThreadError("Thread state is updating. Please wait.");
      setActiveMainTab("threads");
      return;
    }

    if (isChatLocked) {
      setActiveMainTab("settings");
      setUiError("Playground is unavailable while logged out. Open ⚙️ Settings and sign in.");
      return;
    }

    if (!activeAzureConnection) {
      setUiError(
        isAzureAuthRequired
          ? "Azure login is required. Click Project or Deployment and sign in."
          : "No Azure project is available. Check your Azure account permissions.",
      );
      return;
    }

    const deploymentName = selectedAzureDeploymentName.trim();
    if (isLoadingAzureDeployments) {
      setUiError("Deployment list is loading. Please wait.");
      return;
    }

    if (!deploymentName || !azureDeployments.includes(deploymentName)) {
      setUiError("Select an Azure deployment before sending.");
      return;
    }

    const turnId = createId("turn");
    const requestAttachments = draftAttachments.map(
      ({ id: _id, ...attachment }) => attachment,
    );
    const requestMcpServers = cloneMcpServers(mcpServers);
    const requestAgentInstruction = agentInstruction;
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

    appendMessageToThreadState(threadId, userMessage);
    setDraft("");
    setDraftAttachments([]);
    setChatAttachmentError(null);
    setUiError(null);
    setSystemNotice(null);
    setAzureLoginError(null);
    updateThreadRequestState(threadId, (current) => ({
      ...current,
      isSending: true,
      sendProgressMessages: ["Preparing request..."],
      activeTurnId: turnId,
      lastErrorTurnId: null,
      error: null,
    }));

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
          agentInstruction: requestAgentInstruction,
          mcpServers: requestMcpServers.map((server) =>
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
            appendThreadProgressMessage(threadId, message);
          },
          onMcpRpcRecord: (entry) => {
            appendMcpRpcLogToThreadState(threadId, {
              ...entry,
              turnId,
            });
          },
        });
      } else {
        payload = (await response.json()) as ChatApiResponse;
      }

      if (!response.ok || payload.error) {
        if (payload.errorCode === "azure_login_required") {
          setIsAzureAuthRequired(true);
        }
        throw new Error(payload.error || "Failed to send message.");
      }

      if (!payload.message) {
        throw new Error("The server returned an empty message.");
      }

      const assistantMessage = createMessage("assistant", payload.message, turnId);
      appendMessageToThreadState(threadId, assistantMessage);
      updateThreadRequestState(threadId, (current) => ({
        ...current,
        isSending: false,
        sendProgressMessages: [],
        activeTurnId: null,
        lastErrorTurnId: null,
        error: null,
      }));
    } catch (sendError) {
      logHomeError("send_message_failed", sendError, {
        action: "send_message",
        context: {
          threadId,
          turnId,
          messageLength: content.length,
          attachmentCount: requestAttachments.length,
        },
      });
      updateThreadRequestState(threadId, (current) => ({
        ...current,
        isSending: false,
        sendProgressMessages: [],
        activeTurnId: null,
        lastErrorTurnId: turnId,
        error: sendError instanceof Error ? sendError.message : "Could not reach the server.",
      }));
    } finally {
      window.setTimeout(() => {
        void saveThreadSnapshotSilentlyIfNeeded(threadId);
      }, 0);
    }
  }

  async function handleAzureLogin() {
    if (isStartingAzureLogin) {
      return;
    }

    setAzureLoginError(null);
    setSystemNotice(null);
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

      setSystemNotice(payload.message || "Azure login started. Sign in and reload Azure connections.");
      setAzureConnectionError(null);
    } catch (loginError) {
      logHomeError("azure_login_flow_failed", loginError, {
        action: "azure_login",
      });
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
    setSystemNotice(null);
    setIsStartingAzureLogout(true);
    try {
      const response = await fetch("/api/azure-logout", {
        method: "POST",
      });
      const payload = (await response.json()) as AzureActionApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to run Azure logout.");
      }

      setSystemNotice(payload.message || "Azure logout completed.");
      setAzureDeploymentError(null);
      await loadAzureConnections();
    } catch (logoutError) {
      logHomeError("azure_logout_flow_failed", logoutError, {
        action: "azure_logout",
      });
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
      } catch (readAttachmentError) {
        logHomeError("read_attachment_failed", readAttachmentError, {
          action: "read_chat_attachment",
          context: {
            fileName: normalizedName,
            fileSize: file.size,
          },
        });
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
    setUiError(null);
  }

  function handleChatDeploymentChange(nextDeploymentNameRaw: string) {
    const nextDeploymentName = nextDeploymentNameRaw.trim();
    setSelectedAzureDeploymentName(nextDeploymentName);
    setUiError(null);

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
    } catch (readInstructionError) {
      logHomeError("read_instruction_file_failed", readInstructionError, {
        action: "load_instruction_file",
        context: {
          fileName: file.name,
          fileSize: file.size,
        },
      });
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
      logHomeError("save_instruction_file_failed", saveError, {
        action: "save_instruction_file",
      });
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
      logHomeError("enhance_instruction_failed", enhanceError, {
        action: "enhance_instruction",
      });
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
      logHomeError("save_mcp_server_failed", saveError, {
        action: "save_mcp_server",
      });
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
      const warningToShow = saveWarning ?? fallbackLocalWarning;
      setMcpFormWarning(warningToShow);
      logHomeWarning("mcp_server_duplicate_warning", warningToShow, {
        action: "save_mcp_server",
        context: {
          existingServerName,
          savedProfileName,
          transport: serverToAdd.transport,
        },
      });
    } else {
      setMcpFormWarning(saveWarning);
      if (saveWarning) {
        logHomeWarning("mcp_server_save_warning", saveWarning, {
          action: "save_mcp_server",
          context: {
            savedProfileName,
            transport: serverToAdd.transport,
          },
        });
      }
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

    setUiError(null);
    setSystemNotice(null);
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
      setUiError("Failed to copy message to clipboard.");
    });
  };

  const handleCopyMcpLog = (text: string) => {
    void copyTextToClipboard(text).catch(() => {
      setUiError("Failed to copy MCP log to clipboard.");
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
    onClearMcpFormWarning: () => {
      setMcpFormWarning(null);
    },
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
      onClearInstructionSaveSuccess: () => {
        setInstructionSaveSuccess(null);
      },
      onClearInstructionEnhanceSuccess: () => {
        setInstructionEnhanceSuccess(null);
      },
      onAgentInstructionChange: handleAgentInstructionChange,
      onInstructionFileChange: handleInstructionFileChange,
      onSaveInstructionPrompt: handleSaveInstructionPrompt,
      onEnhanceInstruction: handleEnhanceInstruction,
      onClearInstruction: handleClearInstruction,
      onAdoptEnhancedInstruction: handleAdoptEnhancedInstruction,
      onAdoptOriginalInstruction: handleAdoptOriginalInstruction,
    },
    threadOptions: threadSummaries.map((thread) => {
      const isActiveThread = thread.id === activeThreadId;
      return {
        id: thread.id,
        name: isActiveThread ? activeThreadNameInput : thread.name,
        updatedAt: thread.updatedAt,
        messageCount: thread.messageCount,
        mcpServerCount: thread.mcpServerCount,
        isAwaitingResponse:
          (threadRequestStateById[thread.id] ?? HOME_DEFAULT_THREAD_REQUEST_STATE).isSending,
      };
    }),
    activeThreadId: selectedThreadId || activeThreadId,
    isLoadingThreads,
    isSwitchingThread,
    threadError,
    onActiveThreadChange: (threadId: string) => {
      void handleThreadChange(threadId);
    },
  };

  const playgroundPanelProps = {
    messages,
    mcpHistoryByTurnId,
    isSending,
    isUpdatingThread: isCreatingThread || isSwitchingThread || isLoadingThreads,
    activeThreadNameInput,
    onActiveThreadNameChange: handleActiveThreadNameInputChange,
    onCreateThread: handleCreateThreadFromPlaygroundHeader,
    onCopyMessage: handleCopyMessage,
    onCopyMcpLog: handleCopyMcpLog,
    sendProgressMessages,
    activeTurnMcpHistory,
    errorTurnMcpHistory,
    endOfMessagesRef,
    systemNotice,
    onClearSystemNotice: () => {
      setSystemNotice(null);
    },
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

  return {
    layoutRef,
    rightPaneWidth,
    isMainSplitterResizing: activeResizeHandle === "main",
    onMainSplitterPointerDown: handleMainSplitterPointerDown,
    configPanelProps: {
      activeMainTab,
      onMainTabChange: setActiveMainTab,
      isChatLocked,
      settingsTabProps,
      mcpServersTabProps,
      threadsTabProps,
    },
    playgroundPanelProps,
  };
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
