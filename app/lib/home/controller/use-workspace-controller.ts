/**
 * Home controller runtime module.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
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
  HOME_DEFAULT_REASONING_EFFORT,
  HOME_DEFAULT_UTILITY_REASONING_EFFORT,
  HOME_DEFAULT_WEB_SEARCH_ENABLED,
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
  THREAD_DEFAULT_NAME,
} from "~/lib/constants";
import type {
  AzureConnectionOption,
  AzurePrincipalProfile,
  AzureSelectionPreference,
} from "~/lib/home/azure/parsers";
import {
  readAzureDeploymentList,
  readAzurePrincipalProfileFromUnknown,
  readPrincipalIdFromUnknown,
  readAzureProjectList,
  readAzureSelectionFromUnknown,
  readTenantIdFromUnknown,
} from "~/lib/home/azure/parsers";
import { isLikelyChatAzureAuthError } from "~/lib/home/azure/errors";
import { buildMcpHistoryByTurnId } from "~/lib/home/chat/history";
import type { DraftChatAttachment } from "~/lib/home/chat/attachments";
import { formatChatAttachmentSize, readFileAsDataUrl } from "~/lib/home/chat/attachments";
import {
  readChatCommandMatchAtCursor,
  replaceChatCommandToken,
} from "~/lib/home/chat/commands";
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
  buildSavedMcpServerOptions,
  countSelectedSavedMcpServerOptions,
  isMcpServersAuthRequired,
  shouldScheduleSavedMcpLoginRetry,
} from "~/lib/home/mcp/saved-profiles";
import {
  installGlobalClientErrorLogging,
  reportClientEvent,
  reportClientError,
  reportClientWarning,
} from "~/lib/home/observability/app-event-log-client";
import {
  buildThreadSummary,
  readThreadSnapshotFromUnknown,
  readThreadSnapshotList,
} from "~/lib/home/thread/parsers";
import {
  cloneThreadEnvironment,
  buildThreadSaveSignature,
  cloneMcpRpcHistory,
  cloneMcpServers,
  cloneMessages,
  cloneThreadSkillSelections,
  hasThreadInteraction,
  hasThreadPersistableState,
  isThreadArchivedById,
  isThreadSnapshotArchived,
  upsertThreadSnapshot,
} from "~/lib/home/thread/snapshot-state";
import { readThreadEnvironmentFromUnknown } from "~/lib/home/thread/environment";
import {
  buildThreadAutoTitlePlaygroundContent,
  normalizeThreadAutoTitle,
} from "~/lib/home/thread/title";
import type { ThreadSnapshot, ThreadSummary } from "~/lib/home/thread/types";
import { readSkillCatalogList, readSkillRegistryCatalogList } from "~/lib/home/skills/parsers";
import {
  readSkillRegistryOptionById,
  readSkillRegistryLabelFromSkillLocation,
  SKILL_REGISTRY_OPTIONS,
  type SkillRegistryId,
} from "~/lib/home/skills/registry";
import type {
  SkillCatalogEntry,
  SkillRegistryCatalog,
  ThreadSkillSelection,
} from "~/lib/home/skills/types";
import { copyTextToClipboard } from "~/lib/home/shared/clipboard";
import { readStringList } from "~/lib/home/shared/collections";
import { getFileExtension } from "~/lib/home/shared/files";
import { createId } from "~/lib/home/shared/ids";
import { clampNumber } from "~/lib/home/shared/numbers";
import {
  getDefaultDesktopUpdaterStatus,
  readDesktopApi,
  readDesktopUpdaterStatusFromUnknown,
} from "~/lib/home/controller/desktop-updater";
import { readJsonPayload } from "~/lib/home/controller/http";
import {
  type AzureActionApiResponse,
  type AzureConnectionsApiResponse,
  type AzureSelectionApiResponse,
  type InstructionEnhanceComparison,
  type McpServersApiResponse,
  type SkillsApiResponse,
  type ThreadRequestState,
  type ThreadTitleApiResponse,
  type ThreadsApiResponse,
} from "~/lib/home/controller/types";

type ChatCommandSuggestion = {
  id: string;
  label: string;
  description: string;
  detail: string;
  isSelected: boolean;
  isAvailable: boolean;
};

type ChatCommandProvider = {
  keyword: string;
  emptyHint: string;
  readSuggestions: (query: string) => ChatCommandSuggestion[];
  applySuggestion: (suggestion: ChatCommandSuggestion) => void;
};

/**
 * Home runtime controller.
 * Owns interactive state for Playground/Threads/MCP/Settings and orchestrates server API calls.
 * This hook intentionally keeps state ownership centralized while delegating pure transforms
 * to modules under `~/lib/home/*`.
 */
export function useWorkspaceController() {
  // Primary runtime state for Home.
  const [azureConnections, setAzureConnections] = useState<AzureConnectionOption[]>([]);
  const [playgroundAzureDeployments, setPlaygroundAzureDeployments] = useState<string[]>([]);
  const [utilityAzureDeployments, setUtilityAzureDeployments] = useState<string[]>([]);
  const [activeAzurePrincipal, setActiveAzurePrincipal] = useState<AzurePrincipalProfile | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([...HOME_INITIAL_MESSAGES]);
  const [draft, setDraft] = useState("");
  const [chatComposerCursorIndex, setChatComposerCursorIndex] = useState(0);
  const [chatCommandHighlightedIndex, setChatCommandHighlightedIndex] = useState(0);
  const [draftAttachments, setDraftAttachments] = useState<DraftChatAttachment[]>([]);
  const [chatAttachmentError, setChatAttachmentError] = useState<string | null>(null);
  const [activeMainTab, setActiveMainTab] = useState<MainViewTab>("threads");
  const [selectedPlaygroundAzureConnectionId, setSelectedPlaygroundAzureConnectionId] = useState("");
  const [selectedPlaygroundAzureDeploymentName, setSelectedPlaygroundAzureDeploymentName] =
    useState("");
  const [selectedUtilityAzureConnectionId, setSelectedUtilityAzureConnectionId] = useState("");
  const [selectedUtilityAzureDeploymentName, setSelectedUtilityAzureDeploymentName] = useState("");
  const [isLoadingAzureConnections, setIsLoadingAzureConnections] = useState(false);
  const [isLoadingPlaygroundAzureDeployments, setIsLoadingPlaygroundAzureDeployments] =
    useState(false);
  const [isLoadingUtilityAzureDeployments, setIsLoadingUtilityAzureDeployments] = useState(false);
  const [azureConnectionError, setAzureConnectionError] = useState<string | null>(null);
  const [playgroundAzureDeploymentError, setPlaygroundAzureDeploymentError] =
    useState<string | null>(null);
  const [utilityAzureDeploymentError, setUtilityAzureDeploymentError] = useState<string | null>(
    null,
  );
  const [isAzureAuthRequired, setIsAzureAuthRequired] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    HOME_DEFAULT_REASONING_EFFORT,
  );
  const [webSearchEnabled, setWebSearchEnabled] = useState(HOME_DEFAULT_WEB_SEARCH_ENABLED);
  const [utilityReasoningEffort, setUtilityReasoningEffort] = useState<ReasoningEffort>(
    HOME_DEFAULT_UTILITY_REASONING_EFFORT,
  );
  const [agentInstruction, setAgentInstruction] = useState(DEFAULT_AGENT_INSTRUCTION);
  const [loadedInstructionFileName, setLoadedInstructionFileName] = useState<string | null>(null);
  const [instructionFileError, setInstructionFileError] = useState<string | null>(null);
  const [instructionSaveError, setInstructionSaveError] = useState<string | null>(null);
  const [instructionSaveSuccess, setInstructionSaveSuccess] = useState<string | null>(null);
  const [isSavingInstructionPrompt, setIsSavingInstructionPrompt] = useState(false);
  const [instructionEnhanceError, setInstructionEnhanceError] = useState<string | null>(null);
  const [instructionEnhanceSuccess, setInstructionEnhanceSuccess] = useState<string | null>(null);
  const [isEnhancingInstruction, setIsEnhancingInstruction] = useState(false);
  const [instructionEnhancingThreadId, setInstructionEnhancingThreadId] = useState("");
  const [instructionEnhanceComparison, setInstructionEnhanceComparison] =
    useState<InstructionEnhanceComparison | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [savedMcpServers, setSavedMcpServers] = useState<McpServerConfig[]>([]);
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
  const [editingMcpServerId, setEditingMcpServerId] = useState("");
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [mcpFormWarning, setMcpFormWarning] = useState<string | null>(null);
  const [savedMcpError, setSavedMcpError] = useState<string | null>(null);
  const [isLoadingSavedMcpServers, setIsLoadingSavedMcpServers] = useState(false);
  const [isSavingMcpServer, setIsSavingMcpServer] = useState(false);
  const [isDeletingSavedMcpServer, setIsDeletingSavedMcpServer] = useState(false);
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
  const [isLoadingThreads, setIsLoadingThreads] = useState(false);
  const [isSavingThread, setIsSavingThread] = useState(false);
  const [isSwitchingThread, setIsSwitchingThread] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isDeletingThread, setIsDeletingThread] = useState(false);
  const [isRestoringThread, setIsRestoringThread] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);
  const [availableSkills, setAvailableSkills] = useState<SkillCatalogEntry[]>([]);
  const [selectedThreadSkills, setSelectedThreadSkills] = useState<ThreadSkillSelection[]>([]);
  const [selectedDialogueSkills, setSelectedDialogueSkills] = useState<ThreadSkillSelection[]>([]);
  const [skillRegistryCatalogs, setSkillRegistryCatalogs] = useState<SkillRegistryCatalog[]>([]);
  const [isMutatingSkillRegistries, setIsMutatingSkillRegistries] = useState(false);
  const [skillRegistryError, setSkillRegistryError] = useState<string | null>(null);
  const [skillRegistryWarning, setSkillRegistryWarning] = useState<string | null>(null);
  const [skillRegistrySuccess, setSkillRegistrySuccess] = useState<string | null>(null);
  const [isLoadingSkills, setIsLoadingSkills] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillsWarning, setSkillsWarning] = useState<string | null>(null);
  const [desktopUpdaterStatus, setDesktopUpdaterStatus] = useState(
    getDefaultDesktopUpdaterStatus,
  );
  const [isApplyingDesktopUpdate, setIsApplyingDesktopUpdate] = useState(false);
  const [rightPaneWidth, setRightPaneWidth] = useState(420);
  const [activeResizeHandle, setActiveResizeHandle] = useState<"main" | null>(null);

  // Mutable refs for request sequencing, optimistic state, and debounce timers.
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingChatCommandCursorIndexRef = useRef<number | null>(null);
  const chatAttachmentInputRef = useRef<HTMLInputElement | null>(null);
  const instructionFileInputRef = useRef<HTMLInputElement | null>(null);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const azureConnectionsRequestSeqRef = useRef(0);
  const playgroundAzureDeploymentRequestSeqRef = useRef(0);
  const utilityAzureDeploymentRequestSeqRef = useRef(0);
  const activeAzureTenantIdRef = useRef("");
  const activeAzurePrincipalIdRef = useRef("");
  const activeWorkspaceUserKeyRef = useRef("");
  const savedMcpLoginRetryTimeoutRef = useRef<number | null>(null);
  const savedMcpRequestSeqRef = useRef(0);
  const preferredAzureSelectionRef = useRef<AzureSelectionPreference | null>(null);
  const activeThreadIdRef = useRef("");
  const activeMainTabRef = useRef<MainViewTab>("threads");
  const selectedPlaygroundAzureConnectionIdRef = useRef("");
  const selectedPlaygroundAzureDeploymentNameRef = useRef("");
  const selectedUtilityAzureConnectionIdRef = useRef("");
  const selectedUtilityAzureDeploymentNameRef = useRef("");
  const activeThreadNameInputRef = useRef("");
  const isApplyingThreadStateRef = useRef(false);
  const isThreadsReadyRef = useRef(false);
  const threadNameSaveTimeoutRef = useRef<number | null>(null);
  const threadSaveTimeoutRef = useRef<number | null>(null);
  const threadTitleRefreshTimeoutRef = useRef<number | null>(null);
  const threadLoadRequestSeqRef = useRef(0);
  const threadSaveRequestSeqRef = useRef(0);
  const threadSaveSignatureByIdRef = useRef(new Map<string, string>());
  const threadRequestStateByIdRef = useRef<Record<string, ThreadRequestState>>({});
  const threadsRef = useRef<ThreadSnapshot[]>([]);

  // Derived UI state and view models consumed by panel props.
  const isChatLocked = isAzureAuthRequired;
  const activePlaygroundAzureConnection =
    azureConnections.find((connection) => connection.id === selectedPlaygroundAzureConnectionId) ??
    azureConnections[0] ??
    null;
  const activeUtilityAzureConnection =
    azureConnections.find((connection) => connection.id === selectedUtilityAzureConnectionId) ??
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
  const mcpHistoryByTurnId = useMemo(
    () => buildMcpHistoryByTurnId(mcpRpcHistory),
    [mcpRpcHistory],
  );
  const activeTurnMcpHistory = useMemo(
    () => (activeTurnId ? (mcpHistoryByTurnId.get(activeTurnId) ?? []) : []),
    [activeTurnId, mcpHistoryByTurnId],
  );
  const errorTurnMcpHistory = useMemo(
    () => (lastErrorTurnId ? (mcpHistoryByTurnId.get(lastErrorTurnId) ?? []) : []),
    [lastErrorTurnId, mcpHistoryByTurnId],
  );
  const savedMcpServerOptions = useMemo(
    () => buildSavedMcpServerOptions(savedMcpServers, mcpServers),
    [savedMcpServers, mcpServers],
  );
  const editingMcpServer =
    editingMcpServerId.trim().length > 0
      ? savedMcpServers.find((server) => server.id === editingMcpServerId) ?? null
      : null;
  const isEditingMcpServer = editingMcpServer !== null;
  const editingMcpServerName = editingMcpServer?.name ?? null;
  const isMutatingSavedMcpServers = isSavingMcpServer || isDeletingSavedMcpServer;
  const selectedSavedMcpServerCount = useMemo(
    () => countSelectedSavedMcpServerOptions(savedMcpServerOptions),
    [savedMcpServerOptions],
  );
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
  const activeThreadSnapshot =
    threads.find((thread) => thread.id === activeThreadId) ?? null;
  const isActiveThreadArchived = isThreadSnapshotArchived(activeThreadSnapshot);
  const isEnhancingInstructionForActiveThread =
    isEnhancingInstruction &&
    instructionEnhancingThreadId.length > 0 &&
    instructionEnhancingThreadId === activeThreadId;
  const activeThreadSummaries = threadSummaries.filter((thread) => thread.deletedAt === null);
  const archivedThreadSummaries = threadSummaries.filter((thread) => thread.deletedAt !== null);
  const availableSkillByLocation = useMemo(
    () => new Map(availableSkills.map((skill) => [skill.location, skill] as const)),
    [availableSkills],
  );
  const threadSkillOptions = useMemo(() => {
    const selectedThreadSkillLocationSet = new Set(
      selectedThreadSkills.map((selection) => selection.location),
    );
    return [
      ...availableSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        location: skill.location,
        source: skill.source,
        badge: resolveSkillBadgeLabel(skill.source, skill.location),
        isSelected: selectedThreadSkillLocationSet.has(skill.location),
        isAvailable: true,
      })),
      ...selectedThreadSkills
        .filter((selection) => !availableSkillByLocation.has(selection.location))
        .map((selection) => ({
          name: selection.name,
          description: "Saved for this thread, but the SKILL.md file is currently unavailable.",
          location: selection.location,
          source: "app_data" as const,
          badge: resolveSkillBadgeLabel("app_data", selection.location),
          isSelected: true,
          isAvailable: false,
        })),
    ].sort((left, right) => {
      if (left.isSelected !== right.isSelected) {
        return left.isSelected ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }, [availableSkillByLocation, availableSkills, selectedThreadSkills]);
  const dialogueSkillOptions = useMemo(() => {
    const selectedDialogueSkillLocationSet = new Set(
      selectedDialogueSkills.map((selection) => selection.location),
    );
    return [
      ...availableSkills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        location: skill.location,
        source: skill.source,
        badge: resolveSkillBadgeLabel(skill.source, skill.location),
        isSelected: selectedDialogueSkillLocationSet.has(skill.location),
        isAvailable: true,
      })),
      ...selectedDialogueSkills
        .filter((selection) => !availableSkillByLocation.has(selection.location))
        .map((selection) => ({
          name: selection.name,
          description:
            "Added for this dialogue, but the SKILL.md file is currently unavailable.",
          location: selection.location,
          source: "app_data" as const,
          badge: resolveSkillBadgeLabel("app_data", selection.location),
          isSelected: true,
          isAvailable: false,
        })),
    ].sort((left, right) => {
      if (left.isSelected !== right.isSelected) {
        return left.isSelected ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
  }, [availableSkillByLocation, availableSkills, selectedDialogueSkills]);
  const chatCommandProviders: ChatCommandProvider[] = [
    {
      keyword: "$",
      emptyHint: "No matching Skills.",
      readSuggestions: (query) => readSkillCommandSuggestions(dialogueSkillOptions, query),
      applySuggestion: (suggestion) => {
        if (!suggestion.isAvailable) {
          return;
        }

        handleAddDialogueSkill(suggestion.id);
      },
    },
  ];
  const chatCommandKeywords = chatCommandProviders.map((provider) => provider.keyword);
  const effectiveChatComposerCursorIndex =
    chatInputRef.current?.selectionStart ?? chatComposerCursorIndex;
  const activeChatCommandMatch = readChatCommandMatchAtCursor({
    value: draft,
    cursorIndex: effectiveChatComposerCursorIndex,
    keywords: chatCommandKeywords,
  });
  const activeChatCommandProvider = activeChatCommandMatch
    ? (chatCommandProviders.find((provider) => provider.keyword === activeChatCommandMatch.keyword) ??
      null)
    : null;
  const activeChatCommandSuggestions =
    activeChatCommandMatch && activeChatCommandProvider
      ? activeChatCommandProvider.readSuggestions(activeChatCommandMatch.query)
      : [];
  const activeChatCommandHighlightIndex =
    activeChatCommandSuggestions.length > 0
      ? clampNumber(chatCommandHighlightedIndex, 0, activeChatCommandSuggestions.length - 1)
      : 0;
  const activeChatCommandMenu =
    activeChatCommandMatch && activeChatCommandProvider
      ? {
          keyword: activeChatCommandMatch.keyword,
          query: activeChatCommandMatch.query,
          emptyHint: activeChatCommandProvider.emptyHint,
          highlightedIndex: activeChatCommandHighlightIndex,
          suggestions: activeChatCommandSuggestions,
        }
      : null;
  const skillRegistryGroups = useMemo(() => {
    if (skillRegistryCatalogs.length > 0) {
      return skillRegistryCatalogs.map((registry) => ({
        registryUrl:
          readSkillRegistryOptionById(registry.registryId)?.sourceUrl ??
          registry.repositoryUrl,
        registryId: registry.registryId,
        label: registry.registryLabel,
        description: registry.registryDescription,
        skillCount: registry.skills.length,
        installedCount: registry.skills.filter((skill) => skill.isInstalled).length,
        skills: [...registry.skills]
          .sort((left, right) => {
            if (left.isInstalled !== right.isInstalled) {
              return left.isInstalled ? -1 : 1;
            }

            const byTag = (left.tag ?? "").localeCompare(right.tag ?? "");
            if (byTag !== 0) {
              return byTag;
            }

            return left.name.localeCompare(right.name);
          })
          .map((skill) => ({
            id: skill.id,
            name: skill.name,
            description: skill.description,
            detail: skill.isInstalled
              ? `${skill.tag ? `Tag: ${skill.tag} · ` : ""}Installed: ${skill.installLocation}`
              : `${skill.tag ? `Tag: ${skill.tag} · ` : ""}Source: ${skill.remotePath}`,
            isInstalled: skill.isInstalled,
          })),
      }));
    }

    return SKILL_REGISTRY_OPTIONS.map((registry) => ({
      registryUrl: registry.sourceUrl,
      registryId: registry.id,
      label: registry.label,
      description: registry.description,
      skillCount: 0,
      installedCount: 0,
      skills: [],
    }));
  }, [skillRegistryCatalogs]);
  const canSendMessage =
    !isSending &&
    !isSwitchingThread &&
    !isDeletingThread &&
    !isRestoringThread &&
    !isActiveThreadArchived &&
    !isLoadingThreads &&
    !isChatLocked &&
    !isLoadingAzureConnections &&
    !isLoadingPlaygroundAzureDeployments &&
    !!activeThreadId.trim() &&
    !!activePlaygroundAzureConnection &&
    !!selectedPlaygroundAzureDeploymentName.trim() &&
    draft.trim().length > 0;

  // Observability helpers for Home runtime events.
  function buildRuntimeLogContext(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      activeMainTab: activeMainTabRef.current,
      activeThreadId: activeThreadIdRef.current,
      selectedPlaygroundAzureConnectionId: selectedPlaygroundAzureConnectionIdRef.current,
      selectedPlaygroundAzureDeploymentName: selectedPlaygroundAzureDeploymentNameRef.current,
      selectedUtilityAzureConnectionId: selectedUtilityAzureConnectionIdRef.current,
      selectedUtilityAzureDeploymentName: selectedUtilityAzureDeploymentNameRef.current,
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

  function logHomeInfo(
    eventName: string,
    message: string,
    options: {
      category?: string;
      location?: string;
      action?: string;
      context?: Record<string, unknown>;
    } = {},
  ): void {
    reportClientEvent({
      level: "info",
      category: options.category ?? "frontend",
      eventName,
      message,
      location: options.location ?? "home",
      ...(options.action ? { action: options.action } : {}),
      ...(activeThreadIdRef.current ? { threadId: activeThreadIdRef.current } : {}),
      context: buildRuntimeLogContext(options.context),
    });
  }

  // Keep refs synchronized with state to avoid stale closures in async handlers.
  useEffect(() => {
    activeMainTabRef.current = activeMainTab;
  }, [activeMainTab]);

  useEffect(() => {
    selectedPlaygroundAzureConnectionIdRef.current = selectedPlaygroundAzureConnectionId;
  }, [selectedPlaygroundAzureConnectionId]);

  useEffect(() => {
    selectedPlaygroundAzureDeploymentNameRef.current = selectedPlaygroundAzureDeploymentName;
  }, [selectedPlaygroundAzureDeploymentName]);

  useEffect(() => {
    selectedUtilityAzureConnectionIdRef.current = selectedUtilityAzureConnectionId;
  }, [selectedUtilityAzureConnectionId]);

  useEffect(() => {
    selectedUtilityAzureDeploymentNameRef.current = selectedUtilityAzureDeploymentName;
  }, [selectedUtilityAzureDeploymentName]);

  useEffect(() => {
    return installGlobalClientErrorLogging(() =>
      buildRuntimeLogContext({
        source: "home",
      }),
    );
  }, []);

  useEffect(() => {
    const desktopApi = readDesktopApi();
    if (!desktopApi) {
      setDesktopUpdaterStatus(getDefaultDesktopUpdaterStatus());
      return;
    }

    let isActive = true;

    const applyStatusPayload = (payload: unknown) => {
      const parsed = readDesktopUpdaterStatusFromUnknown(payload);
      if (!parsed || !isActive) {
        return;
      }

      setDesktopUpdaterStatus(parsed);
    };

    void desktopApi
      .getUpdaterStatus()
      .then((payload) => {
        applyStatusPayload(payload);
      })
      .catch((error) => {
        logHomeWarning(
          "desktop_updater_status_read_failed",
          error instanceof Error ? error.message : "Unknown error.",
          {
          location: "controller.desktopUpdater",
          },
        );
      });

    const unsubscribe = desktopApi.onUpdaterStatus((payload) => {
      applyStatusPayload(payload);
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
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
    const pendingCursorIndex = pendingChatCommandCursorIndexRef.current;
    if (pendingCursorIndex === null) {
      return;
    }

    const input = chatInputRef.current;
    if (!input) {
      return;
    }

    const nextCursorIndex = clampNumber(pendingCursorIndex, 0, draft.length);
    input.focus();
    input.setSelectionRange(nextCursorIndex, nextCursorIndex);
    pendingChatCommandCursorIndexRef.current = null;
    setChatComposerCursorIndex(nextCursorIndex);
  }, [draft]);

  useEffect(() => {
    setChatCommandHighlightedIndex(0);
  }, [
    activeChatCommandMatch?.keyword,
    activeChatCommandMatch?.query,
    activeChatCommandMatch?.rangeStart,
    activeChatCommandMatch?.rangeEnd,
  ]);

  useEffect(() => {
    if (activeChatCommandSuggestions.length === 0) {
      setChatCommandHighlightedIndex(0);
      return;
    }

    setChatCommandHighlightedIndex((current) =>
      clampNumber(current, 0, activeChatCommandSuggestions.length - 1),
    );
  }, [activeChatCommandSuggestions.length]);

  useEffect(() => {
    void loadAzureConnections();
  }, []);

  useEffect(() => {
    void loadAvailableSkills();
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
    if (!activePlaygroundAzureConnection) {
      setPlaygroundAzureDeployments([]);
      setSelectedPlaygroundAzureDeploymentName("");
      setPlaygroundAzureDeploymentError(null);
      return;
    }

    void loadAzureDeployments(activePlaygroundAzureConnection.id, "playground");
  }, [activePlaygroundAzureConnection]);

  useEffect(() => {
    if (!activeUtilityAzureConnection) {
      setUtilityAzureDeployments([]);
      setSelectedUtilityAzureDeploymentName("");
      setUtilityAzureDeploymentError(null);
      return;
    }

    void loadAzureDeployments(activeUtilityAzureConnection.id, "utility");
  }, [activeUtilityAzureConnection]);

  useEffect(() => {
    if (isAzureAuthRequired) {
      return;
    }

    const tenantId = activeAzureTenantIdRef.current.trim();
    const principalId = activeAzurePrincipalIdRef.current.trim();
    const projectId = selectedPlaygroundAzureConnectionId.trim();
    const deploymentName = selectedPlaygroundAzureDeploymentName.trim();
    if (!tenantId || !principalId || !projectId || !deploymentName) {
      return;
    }

    if (!azureConnections.some((connection) => connection.id === projectId)) {
      return;
    }

    if (!playgroundAzureDeployments.includes(deploymentName)) {
      return;
    }

    const preferred = preferredAzureSelectionRef.current;
    if (
      preferred &&
      preferred.tenantId === tenantId &&
      preferred.principalId === principalId &&
      preferred.playground?.projectId === projectId &&
      preferred.playground?.deploymentName === deploymentName
    ) {
      return;
    }

    void saveAzureSelectionPreference({
      target: "playground",
      tenantId,
      principalId,
      projectId,
      deploymentName,
    });
  }, [
    azureConnections,
    playgroundAzureDeployments,
    isAzureAuthRequired,
    selectedPlaygroundAzureConnectionId,
    selectedPlaygroundAzureDeploymentName,
  ]);

  useEffect(() => {
    if (isAzureAuthRequired) {
      return;
    }

    const tenantId = activeAzureTenantIdRef.current.trim();
    const principalId = activeAzurePrincipalIdRef.current.trim();
    const projectId = selectedUtilityAzureConnectionId.trim();
    const deploymentName = selectedUtilityAzureDeploymentName.trim();
    const nextUtilityReasoningEffort = utilityReasoningEffort;
    if (!tenantId || !principalId || !projectId || !deploymentName) {
      return;
    }

    if (!azureConnections.some((connection) => connection.id === projectId)) {
      return;
    }

    if (!utilityAzureDeployments.includes(deploymentName)) {
      return;
    }

    const preferred = preferredAzureSelectionRef.current;
    if (
      preferred &&
      preferred.tenantId === tenantId &&
      preferred.principalId === principalId &&
      preferred.utility?.projectId === projectId &&
      preferred.utility?.deploymentName === deploymentName &&
      preferred.utility?.reasoningEffort === nextUtilityReasoningEffort
    ) {
      return;
    }

    void saveAzureSelectionPreference({
      target: "utility",
      tenantId,
      principalId,
      projectId,
      deploymentName,
      reasoningEffort: nextUtilityReasoningEffort,
    });
  }, [
    azureConnections,
    utilityAzureDeployments,
    isAzureAuthRequired,
    selectedUtilityAzureConnectionId,
    selectedUtilityAzureDeploymentName,
    utilityReasoningEffort,
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
    if (!editingMcpServerId) {
      return;
    }

    const targetExists = savedMcpServers.some((server) => server.id === editingMcpServerId);
    if (!targetExists) {
      clearMcpServerEditState();
    }
  }, [editingMcpServerId, savedMcpServers]);

  useEffect(() => {
    activeThreadIdRef.current = activeThreadId;
  }, [activeThreadId]);

  useEffect(() => {
    activeThreadNameInputRef.current = activeThreadNameInput;
  }, [activeThreadNameInput]);

  useEffect(() => {
    threadRequestStateByIdRef.current = threadRequestStateById;
  }, [threadRequestStateById]);

  useEffect(() => {
    threadsRef.current = threads;
  }, [threads]);

  useEffect(() => {
    return () => {
      clearThreadTitleRefreshTimeout();
      clearThreadNameSaveTimeout();
      clearThreadSaveTimeout();
    };
  }, []);

  useEffect(() => {
    if (!isThreadsReadyRef.current || isApplyingThreadStateRef.current) {
      return;
    }
    if (isSending || isSwitchingThread || isDeletingThread || isRestoringThread || isLoadingThreads) {
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
    if (!shouldPersistThreadSnapshot(snapshot)) {
      return;
    }
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
    reasoningEffort,
    webSearchEnabled,
    agentInstruction,
    messages,
    mcpServers,
    mcpRpcHistory,
    selectedThreadSkills,
    threads,
    isSending,
    isSwitchingThread,
    isDeletingThread,
    isRestoringThread,
    isLoadingThreads,
  ]);

  useEffect(() => {
    if (!isThreadsReadyRef.current || isApplyingThreadStateRef.current) {
      return;
    }
    if (
      isSending ||
      isLoadingThreads ||
      isSwitchingThread ||
      isCreatingThread ||
      isDeletingThread ||
      isRestoringThread
    ) {
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
    if (!shouldPersistThreadSnapshot(baseThread)) {
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
    isDeletingThread,
    isRestoringThread,
  ]);

  useEffect(() => {
    if (!isThreadsReadyRef.current || isApplyingThreadStateRef.current) {
      return;
    }
    if (
      isLoadingThreads ||
      isSwitchingThread ||
      isCreatingThread ||
      isDeletingThread ||
      isRestoringThread
    ) {
      return;
    }

    const currentThreadId = activeThreadIdRef.current.trim();
    if (!currentThreadId || isArchivedThread(currentThreadId)) {
      return;
    }

    const baseThread = threadsRef.current.find((thread) => thread.id === currentThreadId);
    if (!baseThread || !hasThreadInteraction(baseThread)) {
      return;
    }

    const currentInstruction = agentInstruction.trim();
    const baseInstruction = baseThread.agentInstruction.trim();
    if (currentInstruction === baseInstruction) {
      return;
    }

    clearThreadTitleRefreshTimeout();
    threadTitleRefreshTimeoutRef.current = window.setTimeout(() => {
      threadTitleRefreshTimeoutRef.current = null;
      void refreshThreadTitleInBackground({
        threadId: currentThreadId,
        reason: "instruction_update",
      });
    }, 1000);

    return () => {
      clearThreadTitleRefreshTimeout();
    };
  }, [
    activeThreadId,
    agentInstruction,
    threads,
    isLoadingThreads,
    isSwitchingThread,
    isCreatingThread,
    isDeletingThread,
    isRestoringThread,
  ]);

  // Saved MCP / Skills loading flows.
  async function loadSavedMcpServers() {
    const expectedUserKey = activeWorkspaceUserKeyRef.current.trim();
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

      const payload = await readJsonPayload<McpServersApiResponse>(
        response,
        "saved MCP servers",
      );
      if (requestSeq !== savedMcpRequestSeqRef.current) {
        return;
      }
      if (expectedUserKey !== activeWorkspaceUserKeyRef.current.trim()) {
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
      setSavedMcpError(null);
    } catch (loadError) {
      if (requestSeq !== savedMcpRequestSeqRef.current) {
        return;
      }
      if (expectedUserKey !== activeWorkspaceUserKeyRef.current.trim()) {
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
        expectedUserKey === activeWorkspaceUserKeyRef.current.trim()
      ) {
        setIsLoadingSavedMcpServers(false);
      }
    }
  }

  async function loadAvailableSkills(options: {
    clearStatus?: boolean;
  } = {}): Promise<void> {
    if (options.clearStatus !== false) {
      setSkillsError(null);
      setSkillsWarning(null);
      setSkillRegistryError(null);
      setSkillRegistryWarning(null);
      setSkillRegistrySuccess(null);
    }
    setIsLoadingSkills(true);

    try {
      const response = await fetch("/api/skills", {
        method: "GET",
      });
      const payload = await readJsonPayload<SkillsApiResponse>(response, "Skills");
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load Skills.");
      }

      applySkillsApiPayload(payload);
      setSkillRegistrySuccess(null);
    } catch (loadError) {
      logHomeError("load_skills_failed", loadError, {
        action: "load_skills",
      });
      setAvailableSkills([]);
      setSkillRegistryCatalogs([]);
      setSkillsError(loadError instanceof Error ? loadError.message : "Failed to load Skills.");
      setSkillRegistryError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load Skill registries.",
      );
    } finally {
      setIsLoadingSkills(false);
    }
  }

  function applySkillsApiPayload(payload: SkillsApiResponse) {
    const parsedSkills = readSkillCatalogList(payload.skills);
    const parsedRegistryCatalogs = readSkillRegistryCatalogList(payload.registries);
    const skillWarnings = readStringList(payload.skillWarnings);
    const registryWarnings = readStringList(payload.registryWarnings);

    setAvailableSkills(parsedSkills);
    setSkillRegistryCatalogs(parsedRegistryCatalogs);
    setSkillsError(null);
    setSkillRegistryError(null);
    setSkillsWarning(skillWarnings.length > 0 ? skillWarnings.slice(0, 2).join("\n") : null);
    setSkillRegistryWarning(
      registryWarnings.length > 0 ? registryWarnings.slice(0, 2).join("\n") : null,
    );
  }

  async function updateSkillRegistrySkill(options: {
    action: "install_registry_skill" | "delete_registry_skill";
    registryId: SkillRegistryId;
    skillName: string;
  }): Promise<void> {
    setIsMutatingSkillRegistries(true);
    setSkillRegistryError(null);
    setSkillRegistrySuccess(null);

    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: options.action,
          registryId: options.registryId,
          skillName: options.skillName,
        }),
      });
      const payload = await readJsonPayload<SkillsApiResponse>(response, "Skills");
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update Skill registry.");
      }

      applySkillsApiPayload(payload);
      const message = typeof payload.message === "string" ? payload.message.trim() : "";
      setSkillRegistrySuccess(message || null);
    } catch (error) {
      logHomeError("update_skill_registry_failed", error, {
        action: options.action,
        context: {
          registryId: options.registryId,
          skillName: options.skillName,
        },
      });
      setSkillRegistryError(
        error instanceof Error ? error.message : "Failed to update Skill registry.",
      );
    } finally {
      setIsMutatingSkillRegistries(false);
    }
  }

  // Timer and reset helpers.
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
      if (activeWorkspaceUserKeyRef.current === expectedUserKey) {
        void loadSavedMcpServers();
      }
    }, 1200);
  }

  function clearSavedMcpServersState(nextError: string | null = null) {
    clearSavedMcpLoginRetryTimeout();
    setEditingMcpServerId("");
    setIsDeletingSavedMcpServer(false);
    setSavedMcpServers([]);
    setSavedMcpError(nextError);
    setIsLoadingSavedMcpServers(false);
  }

  function resetMcpServerFormInputs() {
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

  function clearMcpServerEditState() {
    setEditingMcpServerId("");
    resetMcpServerFormInputs();
    setMcpFormError(null);
    setMcpFormWarning(null);
  }

  function populateMcpServerFormForEdit(server: McpServerConfig) {
    setMcpNameInput(server.name);
    setMcpTransport(server.transport);
    if (server.transport === "stdio") {
      setMcpCommandInput(server.command);
      setMcpArgsInput(server.args.length > 0 ? JSON.stringify(server.args) : "");
      setMcpCwdInput(server.cwd ?? "");
      setMcpEnvInput(
        Object.entries(server.env)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => `${key}=${value}`)
          .join("\n"),
      );
      setMcpUrlInput("");
      setMcpHeadersInput("");
      setMcpUseAzureAuthInput(false);
      setMcpAzureAuthScopeInput(MCP_DEFAULT_AZURE_AUTH_SCOPE);
      setMcpTimeoutSecondsInput(String(MCP_DEFAULT_TIMEOUT_SECONDS));
      return;
    }

    setMcpUrlInput(server.url);
    setMcpHeadersInput(
      Object.entries(server.headers)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    setMcpUseAzureAuthInput(server.useAzureAuth);
    setMcpAzureAuthScopeInput(server.azureAuthScope);
    setMcpTimeoutSecondsInput(String(server.timeoutSeconds));
    setMcpCommandInput("");
    setMcpArgsInput("");
    setMcpCwdInput("");
    setMcpEnvInput("");
  }

  function clearThreadNameSaveTimeout() {
    const timeoutId = threadNameSaveTimeoutRef.current;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      threadNameSaveTimeoutRef.current = null;
    }
  }

  function clearThreadTitleRefreshTimeout() {
    const timeoutId = threadTitleRefreshTimeoutRef.current;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
      threadTitleRefreshTimeoutRef.current = null;
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
    clearThreadTitleRefreshTimeout();
    clearThreadNameSaveTimeout();
    clearThreadSaveTimeout();
    isThreadsReadyRef.current = false;
    activeThreadIdRef.current = "";
    isApplyingThreadStateRef.current = false;
    threadSaveSignatureByIdRef.current.clear();
    setThreadsState([]);
    setActiveThreadId("");
    setActiveThreadNameInput("");
    setThreadError(nextError);
    setIsLoadingThreads(false);
    setIsSwitchingThread(false);
    setIsCreatingThread(false);
    setIsDeletingThread(false);
    setIsRestoringThread(false);
    setIsSavingThread(false);
    setMessages([...HOME_INITIAL_MESSAGES]);
    setMcpRpcHistory([]);
    setMcpServers([]);
    setSelectedThreadSkills([]);
    setSelectedDialogueSkills([]);
    setReasoningEffort(HOME_DEFAULT_REASONING_EFFORT);
    setWebSearchEnabled(HOME_DEFAULT_WEB_SEARCH_ENABLED);
    setAgentInstruction(DEFAULT_AGENT_INSTRUCTION);
    setLoadedInstructionFileName(null);
    setInstructionFileError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceError(null);
    setInstructionEnhanceSuccess(null);
    setInstructionEnhancingThreadId("");
    setInstructionEnhanceComparison(null);
    setDraft("");
    setDraftAttachments([]);
    setChatAttachmentError(null);
    setUiError(null);
    setSystemNotice(null);
    setThreadRequestStateById({});
    setIsComposing(false);
  }

  // Thread request-state helpers.
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

  // Thread snapshot mutation helpers.
  function isArchivedThread(threadIdRaw: string): boolean {
    return isThreadArchivedById(threadsRef.current, threadIdRaw);
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

  function shouldPersistThreadSnapshot(
    snapshot: Pick<
      ThreadSnapshot,
      "id" | "messages" | "reasoningEffort" | "webSearchEnabled" | "threadEnvironment"
    > &
      Partial<Pick<ThreadSnapshot, "skillSelections">>,
  ): boolean {
    if (hasThreadPersistableState(snapshot)) {
      return true;
    }

    return threadSaveSignatureByIdRef.current.has(snapshot.id);
  }

  function createLocalThreadSnapshot(options: {
    name?: string;
  } = {}): ThreadSnapshot {
    const now = new Date().toISOString();
    const normalizedName = (options.name ?? "").trim().slice(0, HOME_THREAD_NAME_MAX_LENGTH);
    const name = normalizedName || THREAD_DEFAULT_NAME;

    return {
      id: createId("thread"),
      name,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      reasoningEffort: HOME_DEFAULT_REASONING_EFFORT,
      webSearchEnabled: HOME_DEFAULT_WEB_SEARCH_ENABLED,
      agentInstruction: DEFAULT_AGENT_INSTRUCTION,
      threadEnvironment: {},
      messages: [],
      mcpServers: [],
      mcpRpcHistory: [],
      skillSelections: [],
    };
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
      reasoningEffort,
      webSearchEnabled,
      agentInstruction,
      threadEnvironment: cloneThreadEnvironment(base.threadEnvironment),
      messages: cloneMessages(messages),
      mcpServers: cloneMcpServers(mcpServers),
      mcpRpcHistory: cloneMcpRpcHistory(mcpRpcHistory),
      skillSelections: cloneThreadSkillSelections(selectedThreadSkills),
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

  function applyThreadEnvironmentToThreadState(
    threadId: string,
    environmentValue: unknown,
  ): void {
    if (!threadId) {
      return;
    }

    const nextEnvironment = readThreadEnvironmentFromUnknown(environmentValue);
    updateThreadSnapshotById(threadId, (thread) => ({
      ...thread,
      updatedAt: new Date().toISOString(),
      threadEnvironment: cloneThreadEnvironment(nextEnvironment),
    }));
  }

  function applyThreadSnapshotToState(thread: ThreadSnapshot) {
    isApplyingThreadStateRef.current = true;

    const clonedMessages = cloneMessages(thread.messages);
    const clonedMcpServers = cloneMcpServers(thread.mcpServers);
    const clonedMcpRpcHistory = cloneMcpRpcHistory(thread.mcpRpcHistory);
    const clonedSkillSelections = cloneThreadSkillSelections(thread.skillSelections);

    activeThreadIdRef.current = thread.id;
    setActiveThreadId(thread.id);
    setActiveThreadNameInput(thread.name);
    setMessages(clonedMessages);
    setMcpServers(clonedMcpServers);
    setMcpRpcHistory(clonedMcpRpcHistory);
    setSelectedThreadSkills(clonedSkillSelections);
    setSelectedDialogueSkills([]);
    setReasoningEffort(thread.reasoningEffort);
    setWebSearchEnabled(thread.webSearchEnabled);
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

  // Thread persistence and title-refresh orchestration.
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
    if (!shouldPersistThreadSnapshot(snapshot)) {
      return true;
    }
    const expectedUserKey = activeWorkspaceUserKeyRef.current.trim();
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
      if (expectedUserKey !== activeWorkspaceUserKeyRef.current.trim()) {
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
      logHomeInfo("save_thread_snapshot_succeeded", "Thread snapshot saved.", {
        action: "save_thread_snapshot",
        context: {
          threadId: savedThread.id,
          messageCount: savedThread.messages.length,
          mcpServerCount: savedThread.mcpServers.length,
          mcpRpcCount: savedThread.mcpRpcHistory.length,
          skillSelectionCount: savedThread.skillSelections.length,
        },
      });
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
    if (!shouldPersistThreadSnapshot(snapshot)) {
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
    if (!shouldPersistThreadSnapshot(snapshot)) {
      return true;
    }
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
    if (!shouldPersistThreadSnapshot(baseThread)) {
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

  async function refreshThreadTitleInBackground(options: {
    threadId: string;
    reason: "first_message" | "instruction_update";
    instructionOverride?: string;
  }): Promise<void> {
    const normalizedThreadId = options.threadId.trim();
    if (!normalizedThreadId) {
      return;
    }
    if (isArchivedThread(normalizedThreadId) || isChatLocked || isLoadingUtilityAzureDeployments) {
      return;
    }

    const utilityConnection = activeUtilityAzureConnection;
    const deploymentName = selectedUtilityAzureDeploymentName.trim();
    if (!utilityConnection || !deploymentName || !utilityAzureDeployments.includes(deploymentName)) {
      return;
    }

    const baseThread = threadsRef.current.find((thread) => thread.id === normalizedThreadId);
    if (!baseThread || !hasThreadInteraction(baseThread)) {
      return;
    }

    const playgroundContent = buildThreadAutoTitlePlaygroundContent(baseThread.messages);
    if (!playgroundContent) {
      return;
    }

    const instruction =
      typeof options.instructionOverride === "string"
        ? options.instructionOverride
        : normalizedThreadId === activeThreadIdRef.current.trim()
          ? agentInstruction
          : baseThread.agentInstruction;

    try {
      const response = await fetch("/api/thread-title", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          playgroundContent,
          instruction,
          azureConfig: {
            projectName: utilityConnection.projectName,
            baseUrl: utilityConnection.baseUrl,
            apiVersion: utilityConnection.apiVersion,
            deploymentName,
          },
          reasoningEffort: utilityReasoningEffort,
        }),
      });

      const payload = (await response.json()) as ThreadTitleApiResponse;
      if (!response.ok || payload.error) {
        if (payload.errorCode === "azure_login_required") {
          setIsAzureAuthRequired(true);
        }
        throw new Error(payload.error || "Failed to generate thread title.");
      }

      const nextTitle = normalizeThreadAutoTitle(typeof payload.title === "string" ? payload.title : "");
      if (!nextTitle) {
        return;
      }

      const latestThread = threadsRef.current.find((thread) => thread.id === normalizedThreadId);
      if (!latestThread || latestThread.deletedAt !== null) {
        return;
      }

      const activeThreadId = activeThreadIdRef.current.trim();
      const currentInputName =
        normalizedThreadId === activeThreadId
          ? activeThreadNameInputRef.current.trim()
          : latestThread.name.trim();
      if (nextTitle === latestThread.name && (!currentInputName || currentInputName === nextTitle)) {
        return;
      }

      updateThreadSnapshotById(normalizedThreadId, (thread) => ({
        ...thread,
        updatedAt: new Date().toISOString(),
        name: nextTitle,
      }));

      if (normalizedThreadId === activeThreadId) {
        setActiveThreadNameInput(nextTitle);
      }

      await saveActiveThreadNameInBackground(normalizedThreadId, nextTitle);
    } catch (threadTitleError) {
      logHomeError("generate_thread_title_failed", threadTitleError, {
        action: "generate_thread_title",
        context: {
          threadId: normalizedThreadId,
          reason: options.reason,
        },
      });
    }
  }

  // Thread lifecycle actions (load/create/rename/archive/switch).
  async function loadThreads(): Promise<void> {
    const expectedUserKey = activeWorkspaceUserKeyRef.current.trim();
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
      if (expectedUserKey !== activeWorkspaceUserKeyRef.current.trim()) {
        return;
      }

      const parsedThreads = readThreadSnapshotList(payload.threads, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      const nextThreads =
        parsedThreads.some((thread) => thread.deletedAt === null)
          ? parsedThreads
          : upsertThreadSnapshot(parsedThreads, createLocalThreadSnapshot());

      setThreadSaveSignatures(parsedThreads);
      setThreadsState(nextThreads);
      setThreadRequestStateById((current) => {
        const next: Record<string, ThreadRequestState> = {};
        const validIds = new Set(nextThreads.map((thread) => thread.id));
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
        nextThreads.find((thread) => thread.id === preferredThreadId) ??
        nextThreads.find((thread) => thread.deletedAt === null) ??
        nextThreads[0];
      if (!nextThread) {
        throw new Error("No thread is available.");
      }

      applyThreadSnapshotToState(nextThread);
      logHomeInfo("load_threads_succeeded", "Threads loaded.", {
        action: "load_threads",
        context: {
          threadCount: nextThreads.length,
          archivedThreadCount: nextThreads.filter((thread) => thread.deletedAt !== null).length,
          activeThreadId: nextThread.id,
        },
      });
    } catch (loadError) {
      if (requestSeq !== threadLoadRequestSeqRef.current) {
        return;
      }
      if (expectedUserKey !== activeWorkspaceUserKeyRef.current.trim()) {
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
    if (isLoadingThreads || isSwitchingThread || isCreatingThread || isDeletingThread || isRestoringThread) {
      return false;
    }

    setThreadError(null);
    setIsCreatingThread(true);

    try {
      const currentThreadId = activeThreadIdRef.current.trim();
      const currentThread = threadsRef.current.find((thread) => thread.id === currentThreadId);
      const currentThreadSnapshot =
        currentThread ? buildThreadSnapshotFromCurrentState(currentThread) : null;

      if (
        currentThread &&
        currentThreadSnapshot &&
        !hasThreadPersistableState(currentThreadSnapshot) &&
        !threadSaveSignatureByIdRef.current.has(currentThread.id)
      ) {
        applyThreadSnapshotToState(currentThread);
        return true;
      }

      if (!readThreadRequestState(currentThreadId).isSending) {
        const saved = await flushActiveThreadSnapshot();
        if (!saved) {
          return false;
        }
      }

      const localThread = createLocalThreadSnapshot({
        name: options.name,
      });
      updateThreadsState((current) => upsertThreadSnapshot(current, localThread));
      isThreadsReadyRef.current = true;
      applyThreadSnapshotToState(localThread);
      logHomeInfo("create_thread_succeeded", "Thread created.", {
        action: "create_thread",
        context: {
          threadId: localThread.id,
          nameLength: localThread.name.length,
        },
      });
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

  async function handleCreateThread() {
    const created = await createThreadAndSwitch({
      name: "",
    });
    if (created) {
      setActiveMainTab("threads");
    }
  }

  async function handleThreadRename(threadIdRaw: string, nextNameRaw: string): Promise<void> {
    const threadId = threadIdRaw.trim();
    if (!threadId) {
      return;
    }

    const normalizedName = nextNameRaw.trim().slice(0, HOME_THREAD_NAME_MAX_LENGTH);
    if (!normalizedName) {
      setThreadError("Thread name cannot be empty.");
      return;
    }

    if (isSending) {
      setThreadError("Thread state is updating. Please wait.");
      return;
    }

    if (
      isLoadingThreads ||
      isSwitchingThread ||
      isCreatingThread ||
      isDeletingThread ||
      isRestoringThread
    ) {
      return;
    }

    const targetThread = threadsRef.current.find((thread) => thread.id === threadId);
    if (!targetThread || targetThread.deletedAt !== null) {
      setThreadError("Selected thread is not available.");
      return;
    }

    if (readThreadRequestState(threadId).isSending) {
      setThreadError("Cannot rename a thread while a response is in progress.");
      return;
    }

    if (targetThread.name === normalizedName) {
      return;
    }

    setThreadError(null);
    updateThreadSnapshotById(threadId, (thread) => ({
      ...thread,
      updatedAt: new Date().toISOString(),
      name: normalizedName,
    }));

    if (threadId === activeThreadIdRef.current.trim()) {
      setActiveThreadNameInput(normalizedName);
    }

    const renamedThread = threadsRef.current.find((thread) => thread.id === threadId);
    if (!renamedThread) {
      return;
    }

    const signature = buildThreadSaveSignature(renamedThread);
    await saveThreadSnapshotToDatabase(renamedThread, signature);
  }

  async function handleThreadLogicalDelete(threadIdRaw: string): Promise<void> {
    const threadId = threadIdRaw.trim();
    if (!threadId) {
      return;
    }

    if (isSending) {
      setThreadError("Thread state is updating. Please wait.");
      return;
    }

    if (
      isLoadingThreads ||
      isSwitchingThread ||
      isCreatingThread ||
      isDeletingThread ||
      isRestoringThread
    ) {
      return;
    }

    const targetThread = threadsRef.current.find((thread) => thread.id === threadId);
    if (!targetThread || targetThread.deletedAt !== null) {
      setThreadError("Selected thread is not available.");
      return;
    }
    if (!hasThreadInteraction(targetThread)) {
      setThreadError("Threads without messages cannot be deleted.");
      return;
    }

    if (readThreadRequestState(threadId).isSending) {
      setThreadError("Cannot delete a thread while a response is in progress.");
      return;
    }

    setThreadError(null);
    setIsDeletingThread(true);

    try {
      const currentThreadId = activeThreadIdRef.current.trim();
      if (!readThreadRequestState(currentThreadId).isSending) {
        const saved = await flushActiveThreadSnapshot();
        if (!saved) {
          return;
        }
      }

      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "delete",
          threadId,
        }),
      });

      const payload = (await response.json()) as ThreadsApiResponse;
      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        if (authRequired) {
          setIsAzureAuthRequired(true);
          throw new Error("Azure login is required. Open Settings and sign in to continue.");
        }

        throw new Error(payload.error || "Failed to delete thread.");
      }

      const deletedThread = readThreadSnapshotFromUnknown(payload.thread, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      if (!deletedThread || deletedThread.id !== threadId || deletedThread.deletedAt === null) {
        throw new Error("Deleted thread payload is invalid.");
      }

      setThreadRequestStateById((current) => {
        const next = { ...current };
        delete next[threadId];
        return next;
      });
      await loadThreads();
      logHomeInfo("delete_thread_succeeded", "Thread archived.", {
        action: "delete_thread",
        context: {
          threadId,
        },
      });
    } catch (deleteError) {
      logHomeError("delete_thread_failed", deleteError, {
        action: "delete_thread",
        statusCode: 500,
        context: {
          threadId,
        },
      });
      setThreadError(deleteError instanceof Error ? deleteError.message : "Failed to delete thread.");
    } finally {
      setIsDeletingThread(false);
    }
  }

  async function handleThreadRestore(threadIdRaw: string): Promise<void> {
    const threadId = threadIdRaw.trim();
    if (!threadId) {
      return;
    }

    if (isSending) {
      setThreadError("Thread state is updating. Please wait.");
      return;
    }

    if (
      isLoadingThreads ||
      isSwitchingThread ||
      isCreatingThread ||
      isDeletingThread ||
      isRestoringThread
    ) {
      return;
    }

    const targetThread = threadsRef.current.find((thread) => thread.id === threadId);
    if (!targetThread || targetThread.deletedAt === null) {
      setThreadError("Selected archive is not available.");
      return;
    }

    setThreadError(null);
    setIsRestoringThread(true);

    try {
      const currentThreadId = activeThreadIdRef.current.trim();
      if (!readThreadRequestState(currentThreadId).isSending) {
        const saved = await flushActiveThreadSnapshot();
        if (!saved) {
          return;
        }
      }

      const response = await fetch("/api/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "restore",
          threadId,
        }),
      });

      const payload = (await response.json()) as ThreadsApiResponse;
      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        if (authRequired) {
          setIsAzureAuthRequired(true);
          throw new Error("Azure login is required. Open Settings and sign in to continue.");
        }

        throw new Error(payload.error || "Failed to restore thread.");
      }

      const restoredThread = readThreadSnapshotFromUnknown(payload.thread, {
        fallbackInstruction: DEFAULT_AGENT_INSTRUCTION,
      });
      if (!restoredThread || restoredThread.id !== threadId || restoredThread.deletedAt !== null) {
        throw new Error("Restored thread payload is invalid.");
      }

      updateThreadsState((current) => upsertThreadSnapshot(current, restoredThread));
      threadSaveSignatureByIdRef.current.set(restoredThread.id, buildThreadSaveSignature(restoredThread));
      applyThreadSnapshotToState(restoredThread);
      logHomeInfo("restore_thread_succeeded", "Thread restored.", {
        action: "restore_thread",
        context: {
          threadId,
        },
      });
    } catch (restoreError) {
      logHomeError("restore_thread_failed", restoreError, {
        action: "restore_thread",
        statusCode: 500,
        context: {
          threadId,
        },
      });
      setThreadError(restoreError instanceof Error ? restoreError.message : "Failed to restore thread.");
    } finally {
      setIsRestoringThread(false);
    }
  }

  async function handleThreadChange(nextThreadIdRaw: string) {
    const nextThreadId = nextThreadIdRaw.trim();
    setThreadError(null);
    if (
      isLoadingThreads ||
      isSwitchingThread ||
      isCreatingThread ||
      isDeletingThread ||
      isRestoringThread
    ) {
      return;
    }
    if (!nextThreadId || nextThreadId === activeThreadIdRef.current) {
      return;
    }

    const nextThread = threadsRef.current.find((thread) => thread.id === nextThreadId);
    if (!nextThread) {
      setThreadError("Selected thread is not available.");
      return;
    }
    setIsSwitchingThread(true);
    try {
      const currentThreadId = activeThreadIdRef.current.trim();
      if (!readThreadRequestState(currentThreadId).isSending) {
        const saved = await flushActiveThreadSnapshot();
        if (!saved) {
          return;
        }
      }

      applyThreadSnapshotToState(nextThread);
      logHomeInfo("switch_thread_succeeded", "Thread switched.", {
        action: "switch_thread",
        context: {
          fromThreadId: currentThreadId,
          toThreadId: nextThread.id,
        },
      });
    } finally {
      setIsSwitchingThread(false);
    }
  }

  // Azure identity, selection, and deployment discovery.
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

  async function saveAzureSelectionPreference(
    selection:
      | {
          target: "playground";
          tenantId: string;
          principalId: string;
          projectId: string;
          deploymentName: string;
        }
      | {
          target: "utility";
          tenantId: string;
          principalId: string;
          projectId: string;
          deploymentName: string;
          reasoningEffort: ReasoningEffort;
        },
  ): Promise<void> {
    const currentPreferredSelection = preferredAzureSelectionRef.current;
    const nextPreferredSelection: AzureSelectionPreference =
      currentPreferredSelection &&
      currentPreferredSelection.tenantId === selection.tenantId &&
      currentPreferredSelection.principalId === selection.principalId
        ? {
            ...currentPreferredSelection,
            playground: currentPreferredSelection.playground
              ? { ...currentPreferredSelection.playground }
              : null,
            utility: currentPreferredSelection.utility
              ? { ...currentPreferredSelection.utility }
              : null,
          }
        : {
            tenantId: selection.tenantId,
            principalId: selection.principalId,
            playground: null,
            utility: null,
          };

    const targetSelection = {
      projectId: selection.projectId,
      deploymentName: selection.deploymentName,
    };
    if (selection.target === "playground") {
      nextPreferredSelection.playground = targetSelection;
    } else {
      nextPreferredSelection.utility = {
        ...targetSelection,
        reasoningEffort: selection.reasoningEffort,
      };
    }
    preferredAzureSelectionRef.current = nextPreferredSelection;

    try {
      const response = await fetch("/api/azure-selection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: selection.target,
          projectId: selection.projectId,
          deploymentName: selection.deploymentName,
          ...(selection.target === "utility"
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
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

  function clearActiveAzureIdentity(): void {
    activeAzureTenantIdRef.current = "";
    activeAzurePrincipalIdRef.current = "";
    activeWorkspaceUserKeyRef.current = "";
    preferredAzureSelectionRef.current = null;
    setActiveAzurePrincipal(null);
    setUtilityReasoningEffort(HOME_DEFAULT_UTILITY_REASONING_EFFORT);
  }

  function updateActiveAzureIdentity(tenantId: string, principalId: string): string {
    activeAzureTenantIdRef.current = tenantId;
    activeAzurePrincipalIdRef.current = principalId;
    const nextWorkspaceUserKey = tenantId && principalId ? `${tenantId}::${principalId}` : "";
    activeWorkspaceUserKeyRef.current = nextWorkspaceUserKey;
    return nextWorkspaceUserKey;
  }

  async function loadAzureConnections(): Promise<boolean> {
    const requestSeq = azureConnectionsRequestSeqRef.current + 1;
    azureConnectionsRequestSeqRef.current = requestSeq;
    setIsLoadingAzureConnections(true);

    try {
      const response = await fetch("/api/azure-connections", {
        method: "GET",
      });

      const payload = (await response.json()) as AzureConnectionsApiResponse;
      if (requestSeq !== azureConnectionsRequestSeqRef.current) {
        return isAzureAuthRequired;
      }
      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        clearActiveAzureIdentity();
        clearSavedMcpServersState();
        clearThreadsState(
          authRequired
            ? "Azure login is required. Open Settings and sign in to load threads."
            : null,
        );
        setIsAzureAuthRequired(authRequired);
        setAzureConnections([]);
        setPlaygroundAzureDeployments([]);
        setUtilityAzureDeployments([]);
        setIsLoadingPlaygroundAzureDeployments(false);
        setIsLoadingUtilityAzureDeployments(false);
        setSelectedPlaygroundAzureConnectionId("");
        setSelectedPlaygroundAzureDeploymentName("");
        setSelectedUtilityAzureConnectionId("");
        setSelectedUtilityAzureDeploymentName("");
        setUtilityReasoningEffort(HOME_DEFAULT_UTILITY_REASONING_EFFORT);
        setAzureConnectionError(authRequired ? null : payload.error || "Failed to load Azure projects.");
        setPlaygroundAzureDeploymentError(null);
        setUtilityAzureDeploymentError(null);
        return authRequired;
      }

      const parsedProjects = readAzureProjectList(payload.projects);
      const tenantId = readTenantIdFromUnknown(payload.tenantId);
      const principalId = readPrincipalIdFromUnknown(payload.principalId);
      const parsedPrincipal =
        readAzurePrincipalProfileFromUnknown(payload.principal, tenantId, principalId) ??
        (tenantId && principalId
          ? {
              tenantId,
              principalId,
              displayName: principalId,
              principalName: "",
              principalType: "unknown" as const,
            }
          : null);
      const previousWorkspaceUserKey = activeWorkspaceUserKeyRef.current;
      const nextWorkspaceUserKey = updateActiveAzureIdentity(tenantId, principalId);
      if (!nextWorkspaceUserKey) {
        clearSavedMcpServersState();
        clearThreadsState();
      } else if (previousWorkspaceUserKey !== nextWorkspaceUserKey) {
        void loadSavedMcpServers();
        void loadThreads();
      } else if (!isThreadsReadyRef.current && !isLoadingThreads) {
        void loadThreads();
      }
      if (shouldScheduleSavedMcpLoginRetry(isAzureAuthRequired, nextWorkspaceUserKey)) {
        // After login completes, token propagation can briefly lag for MCP route auth.
        scheduleSavedMcpLoginRetry(nextWorkspaceUserKey);
      } else {
        clearSavedMcpLoginRetryTimeout();
      }
      const preferredSelection =
        tenantId && principalId
          ? await loadAzureSelectionPreference(tenantId, principalId)
          : null;
      if (requestSeq !== azureConnectionsRequestSeqRef.current) {
        return payload.authRequired === true;
      }
      preferredAzureSelectionRef.current = preferredSelection;
      const preferredPlaygroundProjectId = preferredSelection?.playground?.projectId ?? "";
      const preferredUtilityProjectId = preferredSelection?.utility?.projectId ?? "";
      const preferredUtilityReasoningEffort =
        preferredSelection?.utility?.reasoningEffort ?? HOME_DEFAULT_UTILITY_REASONING_EFFORT;
      const knownProjectIds = new Set(parsedProjects.map((connection) => connection.id));
      const deploymentAvailabilityByProjectId = new Map<string, boolean>();

      const resolveInitialProjectId = (currentProjectId: string, preferredProjectId: string): string => {
        const normalizedCurrentProjectId = currentProjectId.trim();
        if (knownProjectIds.has(normalizedCurrentProjectId)) {
          return normalizedCurrentProjectId;
        }

        const normalizedPreferredProjectId = preferredProjectId.trim();
        if (knownProjectIds.has(normalizedPreferredProjectId)) {
          return normalizedPreferredProjectId;
        }

        return parsedProjects[0]?.id ?? "";
      };

      const checkProjectHasDeployments = async (projectId: string): Promise<boolean> => {
        const normalizedProjectId = projectId.trim();
        if (!normalizedProjectId) {
          return false;
        }

        const cachedAvailability = deploymentAvailabilityByProjectId.get(normalizedProjectId);
        if (cachedAvailability !== undefined) {
          return cachedAvailability;
        }

        try {
          const deploymentResponse = await fetch(
            `/api/azure-connections?projectId=${encodeURIComponent(normalizedProjectId)}`,
            {
              method: "GET",
            },
          );
          const deploymentPayload = (await deploymentResponse.json()) as AzureConnectionsApiResponse;
          if (requestSeq !== azureConnectionsRequestSeqRef.current) {
            return false;
          }

          if (!deploymentResponse.ok) {
            deploymentAvailabilityByProjectId.set(normalizedProjectId, false);
            return false;
          }

          const hasDeployments = readAzureDeploymentList(deploymentPayload.deployments).length > 0;
          deploymentAvailabilityByProjectId.set(normalizedProjectId, hasDeployments);
          return hasDeployments;
        } catch {
          deploymentAvailabilityByProjectId.set(normalizedProjectId, false);
          return false;
        }
      };

      const resolveProjectWithDeployments = async (
        currentProjectId: string,
        preferredProjectId: string,
      ): Promise<string> => {
        const initialProjectId = resolveInitialProjectId(currentProjectId, preferredProjectId);
        if (!initialProjectId) {
          return "";
        }

        if (await checkProjectHasDeployments(initialProjectId)) {
          return initialProjectId;
        }

        for (const project of parsedProjects) {
          if (await checkProjectHasDeployments(project.id)) {
            return project.id;
          }
        }

        return initialProjectId;
      };

      const nextPlaygroundProjectId = await resolveProjectWithDeployments(
        selectedPlaygroundAzureConnectionIdRef.current,
        preferredPlaygroundProjectId,
      );
      if (requestSeq !== azureConnectionsRequestSeqRef.current) {
        return payload.authRequired === true;
      }
      const nextUtilityProjectId = await resolveProjectWithDeployments(
        selectedUtilityAzureConnectionIdRef.current,
        preferredUtilityProjectId,
      );
      if (requestSeq !== azureConnectionsRequestSeqRef.current) {
        return payload.authRequired === true;
      }

      setAzureConnections(parsedProjects);
      setActiveAzurePrincipal(parsedPrincipal);
      setPlaygroundAzureDeployments([]);
      setUtilityAzureDeployments([]);
      setIsAzureAuthRequired(payload.authRequired === true ? true : false);
      setAzureConnectionError(null);
      setPlaygroundAzureDeploymentError(null);
      setUtilityAzureDeploymentError(null);
      setUtilityReasoningEffort(preferredUtilityReasoningEffort);
      setSelectedPlaygroundAzureConnectionId(nextPlaygroundProjectId);
      setSelectedUtilityAzureConnectionId(nextUtilityProjectId);
      return payload.authRequired === true;
    } catch (loadError) {
      if (requestSeq !== azureConnectionsRequestSeqRef.current) {
        return isAzureAuthRequired;
      }
      logHomeError("load_azure_connections_failed", loadError, {
        action: "load_azure_connections",
      });
      const errorMessage =
        loadError instanceof Error ? loadError.message : "Failed to load Azure projects.";
      const nextAuthRequired = isLikelyChatAzureAuthError(errorMessage);
      clearActiveAzureIdentity();
      clearSavedMcpServersState();
      clearThreadsState(
        nextAuthRequired
          ? "Azure login is required. Open Settings and sign in to load threads."
          : null,
      );
      setIsAzureAuthRequired(nextAuthRequired);
      setAzureConnections([]);
      setPlaygroundAzureDeployments([]);
      setUtilityAzureDeployments([]);
      setIsLoadingPlaygroundAzureDeployments(false);
      setIsLoadingUtilityAzureDeployments(false);
      setSelectedPlaygroundAzureConnectionId("");
      setSelectedPlaygroundAzureDeploymentName("");
      setSelectedUtilityAzureConnectionId("");
      setSelectedUtilityAzureDeploymentName("");
      setUtilityReasoningEffort(HOME_DEFAULT_UTILITY_REASONING_EFFORT);
      setAzureConnectionError(nextAuthRequired ? null : errorMessage);
      setPlaygroundAzureDeploymentError(null);
      setUtilityAzureDeploymentError(null);
      return nextAuthRequired;
    } finally {
      if (requestSeq === azureConnectionsRequestSeqRef.current) {
        setIsLoadingAzureConnections(false);
      }
    }
  }

  async function loadAzureDeployments(
    projectId: string,
    target: "playground" | "utility",
  ): Promise<void> {
    if (!projectId) {
      if (target === "playground") {
        setPlaygroundAzureDeployments([]);
        setSelectedPlaygroundAzureDeploymentName("");
        setPlaygroundAzureDeploymentError(null);
      } else {
        setUtilityAzureDeployments([]);
        setSelectedUtilityAzureDeploymentName("");
        setUtilityAzureDeploymentError(null);
      }
      return;
    }

    const requestSeq =
      target === "playground"
        ? playgroundAzureDeploymentRequestSeqRef.current + 1
        : utilityAzureDeploymentRequestSeqRef.current + 1;
    if (target === "playground") {
      playgroundAzureDeploymentRequestSeqRef.current = requestSeq;
      setIsLoadingPlaygroundAzureDeployments(true);
      setPlaygroundAzureDeploymentError(null);
    } else {
      utilityAzureDeploymentRequestSeqRef.current = requestSeq;
      setIsLoadingUtilityAzureDeployments(true);
      setUtilityAzureDeploymentError(null);
    }

    try {
      const response = await fetch(
        `/api/azure-connections?projectId=${encodeURIComponent(projectId)}`,
        {
          method: "GET",
        },
      );

      const payload = (await response.json()) as AzureConnectionsApiResponse;
      const activeRequestSeq =
        target === "playground"
          ? playgroundAzureDeploymentRequestSeqRef.current
          : utilityAzureDeploymentRequestSeqRef.current;
      if (requestSeq !== activeRequestSeq) {
        return;
      }

      if (!response.ok) {
        const authRequired = payload.authRequired === true || response.status === 401;
        if (authRequired) {
          clearActiveAzureIdentity();
          clearSavedMcpServersState();
          clearThreadsState("Azure login is required. Open Settings and sign in to load threads.");
        }
        setIsAzureAuthRequired(authRequired);
        if (target === "playground") {
          setPlaygroundAzureDeployments([]);
          setSelectedPlaygroundAzureDeploymentName("");
          setPlaygroundAzureDeploymentError(
            authRequired
              ? null
              : payload.error || "Failed to load deployments for the selected project.",
          );
        } else {
          setUtilityAzureDeployments([]);
          setSelectedUtilityAzureDeploymentName("");
          setUtilityAzureDeploymentError(
            authRequired
              ? null
              : payload.error || "Failed to load deployments for the selected project.",
          );
        }
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
      const parsedPrincipal = readAzurePrincipalProfileFromUnknown(
        payload.principal,
        activeAzureTenantIdRef.current,
        activeAzurePrincipalIdRef.current,
      );
      if (parsedPrincipal) {
        setActiveAzurePrincipal(parsedPrincipal);
      } else if (activeAzureTenantIdRef.current && activeAzurePrincipalIdRef.current) {
        setActiveAzurePrincipal({
          tenantId: activeAzureTenantIdRef.current,
          principalId: activeAzurePrincipalIdRef.current,
          displayName: activeAzurePrincipalIdRef.current,
          principalName: "",
          principalType: "unknown",
        });
      }

      const preferredSelection = preferredAzureSelectionRef.current;
      const preferredDeploymentName =
        preferredSelection &&
        preferredSelection.tenantId === activeAzureTenantIdRef.current &&
        preferredSelection.principalId === activeAzurePrincipalIdRef.current &&
        (target === "playground"
          ? preferredSelection.playground?.projectId === projectId
          : preferredSelection.utility?.projectId === projectId)
          ? (target === "playground"
              ? preferredSelection.playground?.deploymentName
              : preferredSelection.utility?.deploymentName) ?? ""
          : "";

      setIsAzureAuthRequired(false);
      if (target === "playground") {
        setPlaygroundAzureDeployments(parsedDeployments);
        setSelectedPlaygroundAzureDeploymentName((current) =>
          parsedDeployments.includes(current)
            ? current
            : preferredDeploymentName && parsedDeployments.includes(preferredDeploymentName)
              ? preferredDeploymentName
              : parsedDeployments[0] ?? "",
        );
        setPlaygroundAzureDeploymentError(
          parsedDeployments.length === 0
            ? "No Agents SDK-compatible deployments found for this project."
            : null,
        );
      } else {
        setUtilityAzureDeployments(parsedDeployments);
        setSelectedUtilityAzureDeploymentName((current) =>
          parsedDeployments.includes(current)
            ? current
            : preferredDeploymentName && parsedDeployments.includes(preferredDeploymentName)
              ? preferredDeploymentName
              : parsedDeployments[0] ?? "",
        );
        setUtilityAzureDeploymentError(
          parsedDeployments.length === 0
            ? "No Agents SDK-compatible deployments found for this project."
            : null,
        );
      }
    } catch (loadError) {
      const activeRequestSeq =
        target === "playground"
          ? playgroundAzureDeploymentRequestSeqRef.current
          : utilityAzureDeploymentRequestSeqRef.current;
      if (requestSeq !== activeRequestSeq) {
        return;
      }

      logHomeError("load_azure_deployments_failed", loadError, {
        action: "load_azure_deployments",
        context: {
          target,
          projectId,
        },
      });
      setIsAzureAuthRequired(false);
      if (target === "playground") {
        setPlaygroundAzureDeployments([]);
        setSelectedPlaygroundAzureDeploymentName("");
        setPlaygroundAzureDeploymentError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load deployments for the selected project.",
        );
      } else {
        setUtilityAzureDeployments([]);
        setSelectedUtilityAzureDeploymentName("");
        setUtilityAzureDeploymentError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load deployments for the selected project.",
        );
      }
    } finally {
      const activeRequestSeq =
        target === "playground"
          ? playgroundAzureDeploymentRequestSeqRef.current
          : utilityAzureDeploymentRequestSeqRef.current;
      if (requestSeq === activeRequestSeq) {
        if (target === "playground") {
          setIsLoadingPlaygroundAzureDeployments(false);
        } else {
          setIsLoadingUtilityAzureDeployments(false);
        }
      }
    }
  }

  // MCP save/connect and chat execution flow.
  async function saveMcpServerToConfig(
    server: McpServerConfig,
    options: {
      includeId?: boolean;
    } = {},
  ): Promise<{
    profile: McpServerConfig;
    warning: string | null;
  }> {
    const response = await fetch("/api/mcp-servers", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        serializeMcpServerForSave(server, {
          includeId: options.includeId === true,
        }),
      ),
    });

    const payload = await readJsonPayload<McpServersApiResponse>(response, "saved MCP servers");
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
    } else {
      setSavedMcpServers((current) => upsertMcpServer(current, profile));
    }

    return {
      profile,
      warning: typeof payload.warning === "string" ? payload.warning : null,
    };
  }

  async function deleteSavedMcpServerFromConfig(serverId: string): Promise<McpServerConfig[]> {
    const response = await fetch("/api/mcp-servers", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: serverId,
      }),
    });

    const payload = await readJsonPayload<McpServersApiResponse>(response, "saved MCP servers");
    if (!response.ok) {
      const authRequired = isMcpServersAuthRequired(response.status, payload);
      if (authRequired) {
        setIsAzureAuthRequired(true);
        throw new Error("Azure login is required. Open Settings and sign in to edit MCP servers.");
      }

      throw new Error(payload.error || "Failed to delete MCP server.");
    }

    return readMcpServerList(payload.profiles);
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
    if (isArchivedThread(threadId)) {
      setThreadError("Archived thread is read-only. Restore it from Archives to continue.");
      setActiveMainTab("threads");
      return;
    }

    if (readThreadRequestState(threadId).isSending) {
      return;
    }

    if (isLoadingThreads || isSwitchingThread || isDeletingThread || isRestoringThread) {
      setThreadError("Thread state is updating. Please wait.");
      setActiveMainTab("threads");
      return;
    }

    if (isChatLocked) {
      setActiveMainTab("settings");
      setUiError("Playground is unavailable while logged out. Open ⚙️ Settings and sign in.");
      return;
    }

    if (!activePlaygroundAzureConnection) {
      setUiError(
        isAzureAuthRequired
          ? "Azure login is required. Click Project or Deployment and sign in."
          : "No Azure project is available. Check your Azure account permissions.",
      );
      return;
    }

    const deploymentName = selectedPlaygroundAzureDeploymentName.trim();
    if (isLoadingPlaygroundAzureDeployments) {
      setUiError("Deployment list is loading. Please wait.");
      return;
    }

    if (!deploymentName || !playgroundAzureDeployments.includes(deploymentName)) {
      setUiError("Select an Azure deployment before sending.");
      return;
    }

    const baseThread = threadsRef.current.find((thread) => thread.id === threadId);
    const shouldRefreshThreadTitleOnFirstMessage =
      !!baseThread && baseThread.deletedAt === null && baseThread.messages.length === 0;

    const turnId = createId("turn");
    const requestAttachments = draftAttachments.map(
      ({ id: _id, ...attachment }) => attachment,
    );
    const requestMcpServers = cloneMcpServers(mcpServers);
    const requestSkillSelections = mergeSkillSelections(
      selectedThreadSkills,
      selectedDialogueSkills,
    );
    const requestThreadEnvironment = baseThread
      ? cloneThreadEnvironment(baseThread.threadEnvironment)
      : {};
    const requestExplicitSkillLocations = requestSkillSelections.map(
      (selection) => selection.location,
    );
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
    setSelectedDialogueSkills([]);
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
    logHomeInfo("send_message_started", "Thread message request started.", {
      action: "send_message",
      context: {
        threadId,
        turnId,
        messageLength: content.length,
        historyCount: history.length,
        attachmentCount: requestAttachments.length,
        mcpServerCount: requestMcpServers.length,
        skillSelectionCount: requestSkillSelections.length,
      },
    });
    if (shouldRefreshThreadTitleOnFirstMessage) {
      void refreshThreadTitleInBackground({
        threadId,
        reason: "first_message",
      });
    }

    let receivedMcpRpcCount = 0;
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
        },
        body: JSON.stringify({
          threadId,
          turnId,
          message: content,
          attachments: requestAttachments,
          history,
          azureConfig: {
            projectName: activePlaygroundAzureConnection.projectName,
            baseUrl: activePlaygroundAzureConnection.baseUrl,
            apiVersion: activePlaygroundAzureConnection.apiVersion,
            deploymentName,
          },
          reasoningEffort,
          webSearchEnabled,
          agentInstruction: requestAgentInstruction,
          threadEnvironment: requestThreadEnvironment,
          skills: requestSkillSelections,
          explicitSkillLocations: requestExplicitSkillLocations,
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
            receivedMcpRpcCount += 1;
            appendMcpRpcLogToThreadState(threadId, {
              ...entry,
              turnId,
            });
          },
        });
      } else {
        payload = await readJsonPayload<ChatApiResponse>(response, "chat");
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

      applyThreadEnvironmentToThreadState(
        threadId,
        "threadEnvironment" in payload ? payload.threadEnvironment : requestThreadEnvironment,
      );
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
      logHomeInfo("send_message_succeeded", "Thread message request completed.", {
        action: "send_message",
        context: {
          threadId,
          turnId,
          responseLength: payload.message.length,
          mcpRpcCount: receivedMcpRpcCount,
          usedEventStream: isEventStream,
        },
      });
    } catch (sendError) {
      logHomeError("send_message_failed", sendError, {
        action: "send_message",
        context: {
          threadId,
          turnId,
          messageLength: content.length,
          attachmentCount: requestAttachments.length,
          skillSelectionCount: requestSkillSelections.length,
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

  // UI event handlers bound to panel props.
  async function handleAzureLogin() {
    if (isStartingAzureLogin) {
      return;
    }

    setAzureLoginError(null);
    setSystemNotice(null);
    setIsStartingAzureLogin(true);
    try {
      const response = await fetch("/api/azure-login", {
        method: "POST",
      });
      const payload = (await response.json()) as AzureActionApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to start Azure login.");
      }

      setSystemNotice(payload.message || "Azure login completed.");
      setIsAzureAuthRequired(false);
      setAzureConnectionError(null);
      let stillAuthRequired = true;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        stillAuthRequired = await loadAzureConnections();
        if (!stillAuthRequired) {
          break;
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, 500);
        });
      }
      if (stillAuthRequired) {
        setIsAzureAuthRequired(true);
      }
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
      setPlaygroundAzureDeploymentError(null);
      setUtilityAzureDeploymentError(null);
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

  function handleCancelMcpServerEdit() {
    clearMcpServerEditState();
    setSavedMcpError(null);
  }

  function handleEditSavedMcpServer(serverIdRaw: string) {
    if (isArchivedThread(activeThreadIdRef.current)) {
      setSavedMcpError("Archived thread is read-only. Restore it from Archives to edit MCP servers.");
      return;
    }

    const serverId = serverIdRaw.trim();
    if (!serverId) {
      return;
    }

    const selected = savedMcpServers.find((server) => server.id === serverId);
    if (!selected) {
      setSavedMcpError("Selected MCP server is not available.");
      return;
    }

    setEditingMcpServerId(serverId);
    populateMcpServerFormForEdit(selected);
    setMcpFormError(null);
    setMcpFormWarning(null);
    setSavedMcpError(null);
  }

  async function handleDeleteSavedMcpServer(serverIdRaw: string) {
    if (isArchivedThread(activeThreadIdRef.current)) {
      setSavedMcpError("Archived thread is read-only. Restore it from Archives to edit MCP servers.");
      return;
    }

    if (isDeletingSavedMcpServer) {
      return;
    }

    const serverId = serverIdRaw.trim();
    if (!serverId) {
      return;
    }

    const selected = savedMcpServers.find((server) => server.id === serverId);
    if (!selected) {
      setSavedMcpError("Selected MCP server is not available.");
      return;
    }

    setIsDeletingSavedMcpServer(true);
    setSavedMcpError(null);

    try {
      const nextSavedProfiles = await deleteSavedMcpServerFromConfig(serverId);
      setSavedMcpServers(nextSavedProfiles);

      const deletedKey = buildMcpServerKey(selected);
      setMcpServers((current) =>
        current.filter((server) => buildMcpServerKey(server) !== deletedKey),
      );

      if (editingMcpServerId === serverId) {
        clearMcpServerEditState();
      }
    } catch (deleteError) {
      logHomeError("delete_mcp_server_failed", deleteError, {
        action: "delete_saved_mcp_server",
        context: {
          serverId,
          serverName: selected.name,
        },
      });
      setSavedMcpError(
        deleteError instanceof Error ? deleteError.message : "Failed to delete MCP server.",
      );
    } finally {
      setIsDeletingSavedMcpServer(false);
    }
  }

  function handleReloadSkills() {
    void loadAvailableSkills();
  }

  function handleToggleRegistrySkill(registryId: SkillRegistryId, skillIdRaw: string) {
    const skillId = skillIdRaw.trim();
    if (!skillId) {
      return;
    }

    const registryCatalog = skillRegistryCatalogs.find(
      (registry) => registry.registryId === registryId,
    );
    if (!registryCatalog) {
      return;
    }

    const selectedSkill = registryCatalog.skills.find((skill) => skill.id === skillId);
    if (!selectedSkill) {
      return;
    }

    void updateSkillRegistrySkill({
      action: selectedSkill.isInstalled ? "delete_registry_skill" : "install_registry_skill",
      registryId: registryCatalog.registryId,
      skillName: selectedSkill.id,
    });
  }

  function handleAddDialogueSkill(locationRaw: string) {
    const location = locationRaw.trim();
    if (!location) {
      return;
    }

    setSelectedDialogueSkills((current) => {
      if (current.some((selection) => selection.location === location)) {
        return current;
      }

      const skill = availableSkillByLocation.get(location);
      if (!skill) {
        return current;
      }

      return [
        ...current,
        {
          name: skill.name,
          location: skill.location,
        },
      ];
    });
  }

  function handleRemoveDialogueSkill(locationRaw: string) {
    const location = locationRaw.trim();
    if (!location) {
      return;
    }

    setSelectedDialogueSkills((current) =>
      current.filter((selection) => selection.location !== location),
    );
  }

  function handleAddThreadSkill(locationRaw: string) {
    const location = locationRaw.trim();
    if (!location) {
      return;
    }

    setSelectedThreadSkills((current) => {
      if (current.some((selection) => selection.location === location)) {
        return current;
      }

      const skill = availableSkillByLocation.get(location);
      if (!skill) {
        return current;
      }

      return [
        ...current,
        {
          name: skill.name,
          location: skill.location,
        },
      ];
    });
    setSkillsError(null);
  }

  function handleRemoveThreadSkill(locationRaw: string) {
    const location = locationRaw.trim();
    if (!location) {
      return;
    }

    setSelectedThreadSkills((current) =>
      current.filter((selection) => selection.location !== location),
    );
    setSkillsError(null);
  }

  function handleToggleThreadSkill(locationRaw: string) {
    const location = locationRaw.trim();
    if (!location) {
      return;
    }

    setSelectedThreadSkills((current) => {
      const existingIndex = current.findIndex((selection) => selection.location === location);
      if (existingIndex >= 0) {
        return current.filter((selection) => selection.location !== location);
      }

      const skill = availableSkillByLocation.get(location);
      if (!skill) {
        return current;
      }

      return [
        ...current,
        {
          name: skill.name,
          location: skill.location,
        },
      ];
    });
    setSkillsError(null);
  }

  function handleSelectActiveChatCommandSuggestion(suggestionIdRaw: string) {
    const suggestionId = suggestionIdRaw.trim();
    if (!suggestionId || !activeChatCommandMatch || !activeChatCommandProvider) {
      return;
    }

    const suggestion =
      activeChatCommandSuggestions.find((entry) => entry.id === suggestionId) ?? null;
    if (!suggestion || !suggestion.isAvailable) {
      return;
    }

    activeChatCommandProvider.applySuggestion(suggestion);

    const nextDraft = replaceChatCommandToken({
      value: draft,
      rangeStart: activeChatCommandMatch.rangeStart,
      rangeEnd: activeChatCommandMatch.rangeEnd,
      replacement: "",
    });
    pendingChatCommandCursorIndexRef.current = nextDraft.cursorIndex;
    setDraft(nextDraft.value);
    setChatComposerCursorIndex(nextDraft.cursorIndex);
    setChatCommandHighlightedIndex(0);
    setChatAttachmentError(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isArchivedThread(activeThreadIdRef.current)) {
      setThreadError("Archived thread is read-only. Restore it from Archives to continue.");
      setActiveMainTab("threads");
      return;
    }
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

    if (activeChatCommandMenu && activeChatCommandMenu.suggestions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setChatCommandHighlightedIndex((current) => {
          const total = activeChatCommandMenu.suggestions.length;
          if (total <= 0) {
            return 0;
          }

          return (current + 1) % total;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setChatCommandHighlightedIndex((current) => {
          const total = activeChatCommandMenu.suggestions.length;
          if (total <= 0) {
            return 0;
          }

          return (current - 1 + total) % total;
        });
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        const activeSuggestion = activeChatCommandMenu.suggestions[activeChatCommandHighlightIndex];
        if (!activeSuggestion) {
          return;
        }

        event.preventDefault();
        handleSelectActiveChatCommandSuggestion(activeSuggestion.id);
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isArchivedThread(activeThreadIdRef.current)) {
        setThreadError("Archived thread is read-only. Restore it from Archives to continue.");
        setActiveMainTab("threads");
        return;
      }
      if (isChatLocked) {
        setActiveMainTab("settings");
        return;
      }
      void sendMessage();
    }
  }

  function handleDraftChange(event: React.ChangeEvent<HTMLTextAreaElement>, value: string) {
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

    const cursorIndex = event.currentTarget.selectionStart ?? value.length;
    setDraft(value);
    setChatComposerCursorIndex(cursorIndex);
    setChatAttachmentError(null);
    resizeChatInput(event.currentTarget);
  }

  function handleInputSelect(event: SyntheticEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;
    setChatComposerCursorIndex(target.selectionStart ?? target.value.length);
  }

  function handleOpenChatAttachmentPicker() {
    if (isSending || isChatLocked || isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

    chatAttachmentInputRef.current?.click();
  }

  async function handleChatAttachmentFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const input = event.currentTarget;
    if (isArchivedThread(activeThreadIdRef.current)) {
      input.value = "";
      return;
    }
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
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

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
    setSelectedPlaygroundAzureConnectionId(projectId);
    setSelectedPlaygroundAzureDeploymentName("");
    setPlaygroundAzureDeploymentError(null);
    setUiError(null);
  }

  function handleChatDeploymentChange(nextDeploymentNameRaw: string) {
    const nextDeploymentName = nextDeploymentNameRaw.trim();
    setSelectedPlaygroundAzureDeploymentName(nextDeploymentName);
    setUiError(null);

    const tenantId = activeAzureTenantIdRef.current.trim();
    const principalId = activeAzurePrincipalIdRef.current.trim();
    const projectId = (activePlaygroundAzureConnection?.id ?? "").trim();
    if (!tenantId || !principalId || !projectId || !nextDeploymentName) {
      return;
    }

    if (!playgroundAzureDeployments.includes(nextDeploymentName)) {
      return;
    }

    void saveAzureSelectionPreference({
      target: "playground",
      tenantId,
      principalId,
      projectId,
      deploymentName: nextDeploymentName,
    });
  }

  function handleUtilityProjectChange(projectId: string) {
    setSelectedUtilityAzureConnectionId(projectId);
    setSelectedUtilityAzureDeploymentName("");
    setUtilityAzureDeploymentError(null);
    setInstructionEnhanceError(null);
  }

  function handleUtilityDeploymentChange(nextDeploymentNameRaw: string) {
    const nextDeploymentName = nextDeploymentNameRaw.trim();
    setSelectedUtilityAzureDeploymentName(nextDeploymentName);
    setInstructionEnhanceError(null);

    const tenantId = activeAzureTenantIdRef.current.trim();
    const principalId = activeAzurePrincipalIdRef.current.trim();
    const projectId = (activeUtilityAzureConnection?.id ?? "").trim();
    if (!tenantId || !principalId || !projectId || !nextDeploymentName) {
      return;
    }

    if (!utilityAzureDeployments.includes(nextDeploymentName)) {
      return;
    }

    void saveAzureSelectionPreference({
      target: "utility",
      tenantId,
      principalId,
      projectId,
      deploymentName: nextDeploymentName,
      reasoningEffort: utilityReasoningEffort,
    });
  }

  function handleUtilityReasoningEffortChange(nextValue: ReasoningEffort) {
    setUtilityReasoningEffort(nextValue);
    setInstructionEnhanceError(null);
  }

  function handleReasoningEffortChange(nextValue: ReasoningEffort) {
    setReasoningEffort(nextValue);
    setUiError(null);
  }

  function handleWebSearchEnabledChange(nextValue: boolean) {
    setWebSearchEnabled(nextValue);
    setUiError(null);
  }

  function handleAgentInstructionChange(value: string) {
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

    setAgentInstruction(value);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceError(null);
    setInstructionEnhanceSuccess(null);
    setInstructionEnhanceComparison(null);
  }

  function handleClearInstruction() {
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

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
    if (isArchivedThread(activeThreadIdRef.current)) {
      input.value = "";
      return;
    }
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
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

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
    const enhanceThreadId = activeThreadIdRef.current.trim();
    if (!enhanceThreadId || isArchivedThread(enhanceThreadId)) {
      return;
    }

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

    if (!activeUtilityAzureConnection) {
      setInstructionEnhanceError("No Utility project is selected.");
      return;
    }

    const deploymentName = selectedUtilityAzureDeploymentName.trim();
    if (isLoadingUtilityAzureDeployments) {
      setInstructionEnhanceError("Utility deployment list is loading. Please wait.");
      return;
    }

    if (!deploymentName || !utilityAzureDeployments.includes(deploymentName)) {
      setInstructionEnhanceError("Select a Utility deployment before enhancing.");
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

    setInstructionEnhancingThreadId(enhanceThreadId);
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
            projectName: activeUtilityAzureConnection.projectName,
            baseUrl: activeUtilityAzureConnection.baseUrl,
            apiVersion: activeUtilityAzureConnection.apiVersion,
            deploymentName,
          },
          reasoningEffort: utilityReasoningEffort,
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
      setInstructionEnhancingThreadId("");
    }
  }

  function handleAdoptEnhancedInstruction() {
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

    if (!instructionEnhanceComparison) {
      return;
    }

    const enhancedInstruction = instructionEnhanceComparison.enhanced;
    const currentThreadId = activeThreadIdRef.current.trim();
    setAgentInstruction(enhancedInstruction);
    setInstructionEnhanceComparison(null);
    setInstructionEnhanceError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceSuccess("Enhanced instruction applied.");
    if (currentThreadId) {
      void refreshThreadTitleInBackground({
        threadId: currentThreadId,
        reason: "instruction_update",
        instructionOverride: enhancedInstruction,
      });
    }
  }

  function handleAdoptOriginalInstruction() {
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

    if (!instructionEnhanceComparison) {
      return;
    }

    const originalInstruction = instructionEnhanceComparison.original;
    const currentThreadId = activeThreadIdRef.current.trim();
    setAgentInstruction(originalInstruction);
    setInstructionEnhanceComparison(null);
    setInstructionEnhanceError(null);
    setInstructionSaveError(null);
    setInstructionSaveSuccess(null);
    setInstructionEnhanceSuccess("Kept original instruction.");
    if (currentThreadId) {
      void refreshThreadTitleInBackground({
        threadId: currentThreadId,
        reason: "instruction_update",
        instructionOverride: originalInstruction,
      });
    }
  }

  async function handleAddMcpServer() {
    if (isArchivedThread(activeThreadIdRef.current)) {
      setMcpFormError("Archived thread is read-only. Restore it from Archives to edit MCP servers.");
      return;
    }

    const editingServerId = editingMcpServerId.trim();
    const isEditing = editingServerId.length > 0;
    const editingServer = isEditing
      ? savedMcpServers.find((server) => server.id === editingServerId) ?? null
      : null;
    if (isEditing && !editingServer) {
      setEditingMcpServerId("");
      setMcpFormError("Selected MCP server is not available.");
      return;
    }

    const rawName = mcpNameInput.trim();
    setMcpFormError(null);
    setMcpFormWarning(null);

    let serverToSave: McpServerConfig;
    const serverId = isEditing ? editingServerId : createId("mcp");

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

      serverToSave = {
        name,
        transport: "stdio",
        command,
        args: argsResult.value,
        cwd: cwd || undefined,
        env: envResult.value,
        id: serverId,
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

      serverToSave = {
        id: serverId,
        name,
        url: normalizedUrl,
        transport: mcpTransport,
        headers: headersResult.value,
        useAzureAuth: mcpUseAzureAuthInput,
        azureAuthScope,
        timeoutSeconds: timeoutResult.value,
      };
    }

    const existingServerIndex = isEditing
      ? -1
      : mcpServers.findIndex(
          (server) => buildMcpServerKey(server) === buildMcpServerKey(serverToSave),
        );
    const existingServerName = existingServerIndex >= 0 ? (mcpServers[existingServerIndex]?.name ?? "") : "";

    setIsSavingMcpServer(true);
    let saveWarning: string | null = null;
    let savedProfile = serverToSave;
    try {
      const saveResult = await saveMcpServerToConfig(serverToSave, {
        includeId: isEditing,
      });
      saveWarning = saveResult.warning;
      savedProfile = saveResult.profile;

      if (isEditing && editingServer) {
        const previousServerKey = buildMcpServerKey(editingServer);
        const nextServerKey = buildMcpServerKey(savedProfile);
        setMcpServers((current) => {
          const filtered = current.filter(
            (server) => buildMcpServerKey(server) !== previousServerKey,
          );
          if (filtered.length === current.length) {
            return current;
          }

          const nextIndex = filtered.findIndex(
            (server) => buildMcpServerKey(server) === nextServerKey,
          );
          if (nextIndex >= 0) {
            return filtered.map((server, index) =>
              index === nextIndex ? { ...server, name: savedProfile.name } : server,
            );
          }

          return [...filtered, savedProfile];
        });
      } else {
        connectMcpServerToAgent(savedProfile);
      }

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
    if (isEditing) {
      setMcpFormWarning(saveWarning);
      if (saveWarning) {
        logHomeWarning("mcp_server_edit_warning", saveWarning, {
          action: "save_mcp_server",
          context: {
            savedProfileName: savedProfile.name,
            transport: savedProfile.transport,
          },
        });
      }
    } else if (existingServerIndex >= 0) {
      const fallbackLocalWarning =
        existingServerName && existingServerName !== savedProfile.name
          ? `An MCP server with the same configuration already exists. Renamed it from "${existingServerName}" to "${savedProfile.name}".`
          : "An MCP server with the same configuration already exists. Reused the existing entry.";
      const warningToShow = saveWarning ?? fallbackLocalWarning;
      setMcpFormWarning(warningToShow);
      logHomeWarning("mcp_server_duplicate_warning", warningToShow, {
        action: "save_mcp_server",
        context: {
          existingServerName,
          savedProfileName: savedProfile.name,
          transport: serverToSave.transport,
        },
      });
    } else {
      setMcpFormWarning(saveWarning);
      if (saveWarning) {
        logHomeWarning("mcp_server_save_warning", saveWarning, {
          action: "save_mcp_server",
          context: {
            savedProfileName: savedProfile.name,
            transport: serverToSave.transport,
          },
        });
      }
    }
    setEditingMcpServerId("");
    resetMcpServerFormInputs();
  }

  function handleToggleSavedMcpServer(serverIdRaw: string) {
    if (isArchivedThread(activeThreadIdRef.current)) {
      setSavedMcpError("Archived thread is read-only. Restore it from Archives to edit MCP servers.");
      return;
    }

    const serverId = serverIdRaw.trim();
    if (!serverId) {
      return;
    }

    const selected = savedMcpServers.find((server) => server.id === serverId);
    if (!selected) {
      setSavedMcpError("Selected MCP server is not available.");
      return;
    }

    const selectedKey = buildMcpServerKey(selected);
    setMcpServers((current) => {
      const alreadyConnected = current.some(
        (server) => buildMcpServerKey(server) === selectedKey,
      );
      if (alreadyConnected) {
        return current.filter((server) => buildMcpServerKey(server) !== selectedKey);
      }

      return [...current, selected];
    });
    setSavedMcpError(null);
  }

  function handleRemoveMcpServer(id: string) {
    if (isArchivedThread(activeThreadIdRef.current)) {
      return;
    }

    setMcpServers((current) => current.filter((server) => server.id !== id));
  }

  async function handleApplyDesktopUpdate() {
    const desktopApi = readDesktopApi();
    if (!desktopApi || !desktopUpdaterStatus.updateDownloaded || isApplyingDesktopUpdate) {
      return;
    }

    setIsApplyingDesktopUpdate(true);
    setUiError(null);
    try {
      await desktopApi.quitAndInstallUpdate();
    } catch (error) {
      logHomeError("desktop_update_apply_failed", error, {
        action: "desktop_updater.quitAndInstallUpdate",
        location: "controller.desktopUpdater",
        context: {
          availableVersion: desktopUpdaterStatus.availableVersion,
        },
      });
      setUiError(error instanceof Error ? error.message : "Failed to apply desktop update.");
      setIsApplyingDesktopUpdate(false);
    }
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
      isLoadingPlaygroundAzureDeployments
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

    const needsProjectReload = azureConnections.length === 0 || !activePlaygroundAzureConnection;
    const needsDeploymentReload =
      target === "deployment" &&
      (!activePlaygroundAzureConnection ||
        playgroundAzureDeployments.length === 0 ||
        !selectedPlaygroundAzureDeploymentName.trim());

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

  // Panel prop composition for Home route rendering.
  const settingsTabProps = {
    azureConnectionSectionProps: {
      isAzureAuthRequired,
      isSending,
      isStartingAzureLogin,
      onAzureLogin: handleAzureLogin,
      isLoadingAzureConnections,
      isLoadingAzureDeployments: isLoadingPlaygroundAzureDeployments,
      activeAzureConnection: activePlaygroundAzureConnection,
      activeAzurePrincipal,
      selectedPlaygroundAzureDeploymentName,
      isStartingAzureLogout,
      onAzureLogout: handleAzureLogout,
      azureLogoutError,
      azureConnectionError,
    },
    utilityModelSectionProps: {
      isAzureAuthRequired,
      isSending,
      isLoadingAzureConnections,
      isLoadingUtilityAzureDeployments,
      azureConnections,
      selectedUtilityAzureConnectionId,
      selectedUtilityAzureDeploymentName,
      utilityAzureDeployments,
      utilityReasoningEffort,
      utilityReasoningEffortOptions: reasoningEffortOptions,
      utilityAzureDeploymentError,
      onUtilityProjectChange: handleUtilityProjectChange,
      onUtilityDeploymentChange: handleUtilityDeploymentChange,
      onUtilityReasoningEffortChange: handleUtilityReasoningEffortChange,
    },
  };

  const mcpServersTabProps = {
    savedMcpServerOptions,
    selectedSavedMcpServerCount,
    isSending,
    isThreadReadOnly: isActiveThreadArchived,
    isLoadingSavedMcpServers,
    isMutatingSavedMcpServers,
    savedMcpError,
    onToggleSavedMcpServer: handleToggleSavedMcpServer,
    onEditSavedMcpServer: handleEditSavedMcpServer,
    onDeleteSavedMcpServer: (serverId: string) => {
      void handleDeleteSavedMcpServer(serverId);
    },
    onReloadSavedMcpServers: handleReloadSavedMcpServers,
    isEditingMcpServer,
    editingMcpServerName,
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
    onCancelMcpServerEdit: handleCancelMcpServerEdit,
    isSavingMcpServer,
    mcpFormError,
    mcpFormWarning,
    onClearMcpFormWarning: () => {
      setMcpFormWarning(null);
    },
  };

  const isThreadOperationBusy =
    isLoadingThreads || isSwitchingThread || isCreatingThread || isDeletingThread || isRestoringThread;

  const threadsTabProps = {
    instructionSectionProps: {
      agentInstruction,
      instructionEnhanceComparison,
      describeInstructionLanguage,
      isSending,
      isThreadReadOnly: isActiveThreadArchived,
      isEnhancingInstruction,
      showEnhancingInstructionSpinner: isEnhancingInstructionForActiveThread,
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
    activeThreadOptions: activeThreadSummaries.map((thread) => {
      const isActiveThread = thread.id === activeThreadId;
      return {
        id: thread.id,
        name: isActiveThread ? activeThreadNameInput : thread.name,
        updatedAt: thread.updatedAt,
        deletedAt: thread.deletedAt,
        messageCount: thread.messageCount,
        mcpServerCount: thread.mcpServerCount,
        isAwaitingResponse:
          (threadRequestStateById[thread.id] ?? HOME_DEFAULT_THREAD_REQUEST_STATE).isSending,
      };
    }),
    archivedThreadOptions: archivedThreadSummaries.map((thread) => ({
      id: thread.id,
      name: thread.name,
      updatedAt: thread.updatedAt,
      deletedAt: thread.deletedAt,
      messageCount: thread.messageCount,
      mcpServerCount: thread.mcpServerCount,
      isAwaitingResponse:
        (threadRequestStateById[thread.id] ?? HOME_DEFAULT_THREAD_REQUEST_STATE).isSending,
    })),
    activeThreadId,
    isLoadingThreads,
    isSwitchingThread,
    isCreatingThread,
    isDeletingThread,
    isRestoringThread,
    threadError,
    onActiveThreadChange: (threadId: string) => {
      void handleThreadChange(threadId);
    },
    onCreateThread: () => {
      void handleCreateThread();
    },
    onThreadRename: (threadId: string, nextName: string) => {
      void handleThreadRename(threadId, nextName);
    },
    onThreadDelete: (threadId: string) => {
      void handleThreadLogicalDelete(threadId);
    },
    onThreadRestore: (threadId: string) => {
      void handleThreadRestore(threadId);
    },
  };

  const skillsTabProps = {
    skillsSectionProps: {
      skillOptions: threadSkillOptions,
      isLoadingSkills,
      isSending,
      isThreadReadOnly: isActiveThreadArchived,
      skillsError,
      skillsWarning,
      onReloadSkills: handleReloadSkills,
      onToggleSkill: handleToggleThreadSkill,
      onClearSkillsWarning: () => {
        setSkillsWarning(null);
      },
    },
    skillRegistrySectionProps: {
      skillRegistryGroups,
      isLoadingSkillRegistries: isLoadingSkills,
      isMutatingSkillRegistries,
      skillRegistryError,
      skillRegistryWarning,
      skillRegistrySuccess,
      onReloadSkillRegistries: handleReloadSkills,
      onToggleRegistrySkill: handleToggleRegistrySkill,
      onClearSkillRegistryWarning: () => {
        setSkillRegistryWarning(null);
      },
      onClearSkillRegistrySuccess: () => {
        setSkillRegistrySuccess(null);
      },
    },
  };

  const playgroundPanelProps = {
    messages,
    mcpHistoryByTurnId,
    isSending,
    isThreadReadOnly: isActiveThreadArchived,
    desktopUpdaterStatus,
    isApplyingDesktopUpdate,
    onApplyDesktopUpdate: () => {
      void handleApplyDesktopUpdate();
    },
    activeThreadName: activeThreadNameInput,
    isThreadOperationBusy,
    isCreatingThread,
    onCreateThread: () => {
      void handleCreateThread();
    },
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
    onInputSelect: handleInputSelect,
    onOpenChatAttachmentPicker: handleOpenChatAttachmentPicker,
    onChatAttachmentFileChange: handleChatAttachmentFileChange,
    onRemoveChatAttachment: handleRemoveDraftAttachment,
    onInputKeyDown: handleInputKeyDown,
    chatCommandMenu: activeChatCommandMenu,
    onSelectChatCommandSuggestion: handleSelectActiveChatCommandSuggestion,
    onHighlightChatCommandSuggestion: setChatCommandHighlightedIndex,
    onCompositionStart: () => setIsComposing(true),
    onCompositionEnd: () => setIsComposing(false),
    isChatLocked,
    isLoadingAzureConnections,
    isLoadingAzureDeployments: isLoadingPlaygroundAzureDeployments,
    isAzureAuthRequired,
    isStartingAzureLogin,
    isStartingAzureLogout,
    onChatAzureSelectorAction: handleChatAzureSelectorAction,
    azureConnections,
    activeAzureConnectionId: activePlaygroundAzureConnection?.id ?? "",
    onProjectChange: handleChatProjectChange,
    selectedAzureDeploymentName: selectedPlaygroundAzureDeploymentName,
    azureDeployments: playgroundAzureDeployments,
    onDeploymentChange: handleChatDeploymentChange,
    reasoningEffort,
    reasoningEffortOptions,
    onReasoningEffortChange: handleReasoningEffortChange,
    webSearchEnabled,
    onWebSearchEnabledChange: handleWebSearchEnabledChange,
    maxChatAttachmentFiles: CHAT_ATTACHMENT_MAX_FILES,
    canSendMessage,
    selectedThreadSkills,
    selectedDialogueSkills,
    onRemoveThreadSkill: handleRemoveThreadSkill,
    onRemoveDialogueSkill: handleRemoveDialogueSkill,
    mcpServers,
    onRemoveMcpServer: handleRemoveMcpServer,
  };

  const unauthenticatedPanelProps = {
    isStartingAzureLogin,
    onAzureLogin: handleAzureLogin,
  };

  return {
    layoutRef,
    rightPaneWidth,
    isMainSplitterResizing: activeResizeHandle === "main",
    onMainSplitterPointerDown: handleMainSplitterPointerDown,
    isAzureAuthRequired,
    unauthenticatedPanelProps,
    configPanelProps: {
      activeMainTab,
      onMainTabChange: setActiveMainTab,
      isChatLocked,
      settingsTabProps,
      mcpServersTabProps,
      skillsTabProps,
      threadsTabProps,
    },
    playgroundPanelProps,
  };
}

function mergeSkillSelections(
  threadSkills: ThreadSkillSelection[],
  dialogueSkills: ThreadSkillSelection[],
): ThreadSkillSelection[] {
  const byLocation = new Map<string, ThreadSkillSelection>();
  for (const selection of [...threadSkills, ...dialogueSkills]) {
    const location = selection.location.trim();
    if (!location || byLocation.has(location)) {
      continue;
    }
    byLocation.set(location, {
      name: selection.name,
      location,
    });
  }
  return Array.from(byLocation.values());
}

function resolveSkillBadgeLabel(
  source: "workspace" | "codex_home" | "app_data",
  location: string,
): string {
  if (source === "workspace") {
    return "Workspace";
  }

  if (source === "codex_home") {
    return "CODEX_HOME";
  }

  const registryLabel = readSkillRegistryLabelFromSkillLocation(location);
  return registryLabel ?? "App Data";
}

function readSkillCommandSuggestions(
  skillOptions: Array<{
    name: string;
    description: string;
    location: string;
    badge: string;
    isSelected: boolean;
    isAvailable: boolean;
  }>,
  queryRaw: string,
): ChatCommandSuggestion[] {
  const query = queryRaw.trim().toLowerCase();
  const maxSuggestions = 12;

  return skillOptions
    .filter((skill) => {
      if (!skill.isAvailable) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.location.toLowerCase().includes(query)
      );
    })
    .slice(0, maxSuggestions)
    .map((skill) => ({
      id: skill.location,
      label: skill.name,
      description: skill.description,
      detail: `${skill.badge} · ${skill.location}`,
      isSelected: skill.isSelected,
      isAvailable: skill.isAvailable,
    }));
}
