import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Route } from "./+types/home";

type ChatRole = "user" | "assistant";
type ReasoningEffort = "none" | "low" | "medium" | "high";
type McpTransport = "streamable_http" | "sse" | "stdio";

type McpHttpServerConfig = {
  id: string;
  name: string;
  transport: "streamable_http" | "sse";
  url: string;
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

type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
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
};

type SaveMcpServerRequest = Omit<McpHttpServerConfig, "id"> | Omit<McpStdioServerConfig, "id">;
type McpServersApiResponse = {
  profile?: unknown;
  profiles?: unknown;
  warning?: string;
  error?: string;
};

const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content: "Hello. Ask me anything.",
  },
];
const DEFAULT_CONTEXT_WINDOW_SIZE = 10;
const MIN_CONTEXT_WINDOW_SIZE = 1;
const MAX_CONTEXT_WINDOW_SIZE = 200;
const MIN_TEMPERATURE = 0;
const MAX_TEMPERATURE = 2;
const DEFAULT_AGENT_INSTRUCTION = "You are a concise assistant for a simple chat app.";
const MAX_INSTRUCTION_FILE_SIZE_BYTES = 1_000_000;
const MAX_INSTRUCTION_FILE_SIZE_LABEL = "1MB";
const ALLOWED_INSTRUCTION_EXTENSIONS = new Set(["md", "txt", "xml", "json"]);
const DEFAULT_MCP_TRANSPORT: McpTransport = "streamable_http";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Simple Chat" },
    { name: "description", content: "Simple desktop chat app with OpenAI backend." },
  ];
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("none");
  const [agentInstruction, setAgentInstruction] = useState(DEFAULT_AGENT_INSTRUCTION);
  const [loadedInstructionFileName, setLoadedInstructionFileName] = useState<string | null>(null);
  const [instructionFileError, setInstructionFileError] = useState<string | null>(null);
  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]);
  const [savedMcpServers, setSavedMcpServers] = useState<McpServerConfig[]>([]);
  const [selectedSavedMcpServerId, setSelectedSavedMcpServerId] = useState("");
  const [mcpNameInput, setMcpNameInput] = useState("");
  const [mcpUrlInput, setMcpUrlInput] = useState("");
  const [mcpCommandInput, setMcpCommandInput] = useState("");
  const [mcpArgsInput, setMcpArgsInput] = useState("");
  const [mcpCwdInput, setMcpCwdInput] = useState("");
  const [mcpEnvInput, setMcpEnvInput] = useState("");
  const [mcpTransport, setMcpTransport] = useState<McpTransport>(DEFAULT_MCP_TRANSPORT);
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [mcpFormWarning, setMcpFormWarning] = useState<string | null>(null);
  const [savedMcpError, setSavedMcpError] = useState<string | null>(null);
  const [isLoadingSavedMcpServers, setIsLoadingSavedMcpServers] = useState(false);
  const [isSavingMcpServer, setIsSavingMcpServer] = useState(false);
  const [contextWindowInput, setContextWindowInput] = useState(
    String(DEFAULT_CONTEXT_WINDOW_SIZE),
  );
  const [temperatureInput, setTemperatureInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const contextWindowValidation = validateContextWindowInput(contextWindowInput);
  const temperatureValidation = validateTemperatureInput(temperatureInput);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  useEffect(() => {
    void loadSavedMcpServers();
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
      !contextWindowValidation.isValid ||
      !temperatureValidation.isValid
    ) {
      return;
    }

    const userMessage: ChatMessage = createMessage("user", content);
    const contextWindowSize = contextWindowValidation.value;
    if (contextWindowSize === null) {
      return;
    }
    const temperature = temperatureValidation.value;

    const history = messages
      .slice(-contextWindowSize)
      .map(({ role, content: previousContent }) => ({
        role,
        content: previousContent,
      }));

    setMessages((current) => [...current, userMessage]);
    setDraft("");
    setError(null);
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: content,
          history,
          reasoningEffort,
          contextWindowSize,
          ...(temperature !== null ? { temperature } : {}),
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
                },
          ),
        }),
      });

      const payload = (await response.json()) as ChatApiResponse;
      if (!response.ok) {
        throw new Error(payload.error || "Failed to send message.");
      }
      if (!payload.message) {
        throw new Error("The server returned an empty message.");
      }

      setMessages((current) => [...current, createMessage("assistant", payload.message!)]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Could not reach the server.");
    } finally {
      setIsSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || isComposing || event.nativeEvent.keyCode === 229) {
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
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
    } catch {
      setInstructionFileError("Failed to read the selected instruction file.");
    } finally {
      input.value = "";
    }
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

      serverToAdd = {
        id: createId("mcp"),
        name,
        url: normalizedUrl,
        transport: mcpTransport,
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
          ? `同一設定のMCPサーバーが既に存在したため、名前を「${existingServerName}」から「${savedProfileName}」に上書きしました。`
          : "同一設定のMCPサーバーが既に存在したため、既存エントリを再利用しました。";
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
    setMcpTransport(DEFAULT_MCP_TRANSPORT);
  }

  function handleAddSavedMcpServer() {
    if (!selectedSavedMcpServerId) {
      setSavedMcpError("Select a saved MCP server first.");
      return;
    }

    const selected = savedMcpServers.find((server) => server.id === selectedSavedMcpServerId);
    if (!selected) {
      setSavedMcpError("Selected MCP server is not available.");
      return;
    }

    const nextServer = cloneMcpServerWithNewId(selected);
    const duplicated = mcpServers.some(
      (server) => buildMcpServerKey(server) === buildMcpServerKey(nextServer),
    );
    if (duplicated) {
      setSavedMcpError("This MCP server is already added.");
      return;
    }

    setMcpServers((current) => [...current, nextServer]);
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
    setDraft("");
    setError(null);
    setIsComposing(false);
  }

  return (
    <main className="chat-page">
      <div className="chat-layout">
        <section className="chat-shell">
          <header className="chat-header">
            <div className="chat-header-row">
              <div className="chat-header-main">
                <h1>Simple Chat</h1>
                <p>Set AZURE_BASE_URL, AZURE_API_VERSION=v1, and AZURE_DEPLOYMENT_NAME.</p>
              </div>
              <button
                type="button"
                className="secondary-btn chat-reset-btn"
                onClick={handleResetThread}
                disabled={isSending}
              >
                Reset Thread
              </button>
            </div>
          </header>

          <div className="chat-log" aria-live="polite">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`message-row ${message.role === "user" ? "user" : "assistant"}`}
              >
                {renderMessageContent(message)}
              </article>
            ))}

            {isSending ? (
              <article className="message-row assistant">
                <p className="typing">Thinking...</p>
              </article>
            ) : null}
            <div ref={endOfMessagesRef} />
          </div>

          <footer className="chat-footer">
            {error ? <p className="chat-error">{error}</p> : null}
            <form className="chat-form" onSubmit={handleSubmit}>
              <label className="sr-only" htmlFor="chat-input">
                Message
              </label>
              <textarea
                id="chat-input"
                name="message"
                rows={2}
                placeholder="Type a message..."
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleInputKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={
                  isSending ||
                  draft.trim().length === 0 ||
                  !contextWindowValidation.isValid ||
                  !temperatureValidation.isValid
                }
              >
                Send
              </button>
            </form>
          </footer>
        </section>

        <aside className="settings-shell" aria-label="Chat settings">
          <header className="settings-header">
            <h2>Settings</h2>
            <p>Model behavior options</p>
          </header>
          <div className="settings-content">
            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Agent Instruction</h3>
                <p>System instruction used for the agent.</p>
              </div>
              <textarea
                id="agent-instruction"
                rows={6}
                value={agentInstruction}
                onChange={(event) => setAgentInstruction(event.target.value)}
                disabled={isSending}
                placeholder="System instruction for the agent"
              />
              <div className="file-picker-row">
                <input
                  id="agent-instruction-file"
                  className="file-input-hidden"
                  type="file"
                  accept=".md,.txt,.xml,.json,text/plain,text/markdown,application/json,application/xml,text/xml"
                  onChange={(event) => {
                    void handleInstructionFileChange(event);
                  }}
                  disabled={isSending}
                />
                <label htmlFor="agent-instruction-file" className="file-picker-button">
                  Load File
                </label>
                <span className="file-picker-name">
                  {loadedInstructionFileName ?? "No file loaded"}
                </span>
              </div>
              <p className="field-hint">Supported: .md, .txt, .xml, .json (max 1MB)</p>
              {instructionFileError ? (
                <p className="field-error">{instructionFileError}</p>
              ) : null}
            </section>

            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Reasoning Effort</h3>
                <p>How much internal reasoning the model should use.</p>
              </div>
              <select
                id="reasoning-effort"
                value={reasoningEffort}
                onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
                disabled={isSending}
              >
                {REASONING_EFFORT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </section>

            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Temperature</h3>
                <p>Controls response randomness. Leave empty for None.</p>
              </div>
              <input
                id="temperature"
                type="text"
                inputMode="decimal"
                placeholder="None"
                value={temperatureInput}
                onChange={(event) => setTemperatureInput(event.target.value)}
                disabled={isSending}
                aria-invalid={!temperatureValidation.isValid}
                aria-describedby="temperature-error"
              />
              <p className="field-hint">None or number from 0 to 2.</p>
              {temperatureValidation.message ? (
                <p id="temperature-error" className="field-error">
                  {temperatureValidation.message}
                </p>
              ) : null}
            </section>

            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Context Window</h3>
                <p>Number of recent messages to include as context.</p>
              </div>
              <input
                id="context-window-size"
                type="text"
                inputMode="numeric"
                placeholder="10"
                value={contextWindowInput}
                onChange={(event) => setContextWindowInput(event.target.value)}
                disabled={isSending}
                aria-invalid={!contextWindowValidation.isValid}
                aria-describedby="context-window-size-error"
              />
              <p className="field-hint">Integer from 1 to 200.</p>
              {contextWindowValidation.message ? (
                <p id="context-window-size-error" className="field-error">
                  {contextWindowValidation.message}
                </p>
              ) : null}
            </section>
          </div>
        </aside>

        <aside className="mcp-shell" aria-label="MCP server settings">
          <header className="mcp-header">
            <h2>MCP Servers</h2>
          </header>
          <div className="mcp-content">
            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Add MCP Server</h3>
              </div>
              <input
                type="text"
                placeholder="Server name (optional)"
                value={mcpNameInput}
                onChange={(event) => setMcpNameInput(event.target.value)}
                disabled={isSending}
              />
              <select
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
              </select>
              {mcpTransport === "stdio" ? (
                <>
                  <input
                    type="text"
                    placeholder="Command (e.g. npx)"
                    value={mcpCommandInput}
                    onChange={(event) => setMcpCommandInput(event.target.value)}
                    disabled={isSending}
                  />
                  <input
                    type="text"
                    placeholder='Args (space-separated or JSON array)'
                    value={mcpArgsInput}
                    onChange={(event) => setMcpArgsInput(event.target.value)}
                    disabled={isSending}
                  />
                  <input
                    type="text"
                    placeholder="Working directory (optional)"
                    value={mcpCwdInput}
                    onChange={(event) => setMcpCwdInput(event.target.value)}
                    disabled={isSending}
                  />
                  <textarea
                    rows={3}
                    placeholder={"Environment variables (optional)\nKEY=value"}
                    value={mcpEnvInput}
                    onChange={(event) => setMcpEnvInput(event.target.value)}
                    disabled={isSending}
                  />
                </>
              ) : (
                <input
                  type="text"
                  placeholder="https://example.com/mcp"
                  value={mcpUrlInput}
                  onChange={(event) => setMcpUrlInput(event.target.value)}
                  disabled={isSending}
                />
              )}
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  void handleAddMcpServer();
                }}
                disabled={isSending || isSavingMcpServer}
              >
                Add Server
              </button>
              {mcpFormError ? <p className="field-error">{mcpFormError}</p> : null}
              {mcpFormWarning ? <p className="field-warning">{mcpFormWarning}</p> : null}
            </section>

            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Saved Configs</h3>
              </div>
              <select
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
              </select>
              <div className="mcp-action-row">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={handleAddSavedMcpServer}
                  disabled={
                    isSending ||
                    isLoadingSavedMcpServers ||
                    savedMcpServers.length === 0 ||
                    !selectedSavedMcpServerId
                  }
                >
                  Add Selected
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => {
                    void loadSavedMcpServers();
                  }}
                  disabled={isSending || isLoadingSavedMcpServers}
                >
                  {isLoadingSavedMcpServers ? "Loading..." : "Reload"}
                </button>
              </div>
              {savedMcpError ? <p className="field-error">{savedMcpError}</p> : null}
            </section>

            <section className="setting-group">
              <div className="setting-group-header">
                <h3>Added Servers</h3>
              </div>
              {mcpServers.length === 0 ? (
                <p className="field-hint">No MCP servers added.</p>
              ) : (
                <div className="mcp-list">
                  {mcpServers.map((server) => (
                    <article key={server.id} className="mcp-item">
                      <div className="mcp-item-body">
                        <p className="mcp-item-name">{server.name}</p>
                        {server.transport === "stdio" ? (
                          <>
                            <p className="mcp-item-url">
                              {server.command}
                              {server.args.length > 0 ? ` ${server.args.join(" ")}` : ""}
                            </p>
                            {server.cwd ? <p className="mcp-item-meta">cwd: {server.cwd}</p> : null}
                            <p className="mcp-item-meta">
                              {server.transport} ({Object.keys(server.env).length} env)
                            </p>
                          </>
                        ) : (
                          <>
                            <p className="mcp-item-url">{server.url}</p>
                            <p className="mcp-item-meta">{server.transport}</p>
                          </>
                        )}
                      </div>
                      <button
                        type="button"
                        className="mcp-remove-btn"
                        onClick={() => handleRemoveMcpServer(server.id)}
                        disabled={isSending}
                      >
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
}

function createMessage(role: ChatRole, content: string): ChatMessage {
  const randomPart = Math.random().toString(36).slice(2);
  return {
    id: `${role}-${Date.now()}-${randomPart}`,
    role,
    content,
  };
}

const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = ["none", "low", "medium", "high"];
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function validateContextWindowInput(input: string): {
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

function validateTemperatureInput(input: string): {
  isValid: boolean;
  value: number | null;
  message: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      isValid: true,
      value: null,
      message: null,
    };
  }

  if (!/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    return {
      isValid: false,
      value: null,
      message: "Temperature must be a number.",
    };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < MIN_TEMPERATURE || parsed > MAX_TEMPERATURE) {
    return {
      isValid: false,
      value: null,
      message: `Temperature must be between ${MIN_TEMPERATURE} and ${MAX_TEMPERATURE}.`,
    };
  }

  return {
    isValid: true,
    value: parsed,
    message: null,
  };
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

  return `${server.transport}:${server.url.toLowerCase()}`;
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

  return {
    id,
    name,
    transport,
    url,
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
  };
}

function cloneMcpServerWithNewId(server: McpServerConfig): McpServerConfig {
  if (server.transport === "stdio") {
    return {
      ...server,
      args: [...server.args],
      env: { ...server.env },
      id: createId("mcp"),
    };
  }

  return {
    ...server,
    id: createId("mcp"),
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

  return `${server.name} (${server.transport})`;
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
          }}
        >
          {message.content}
        </ReactMarkdown>
      </div>
    );
  }

  return (
    <pre className="json-message" aria-label="JSON response">
      {jsonTokens.map((token, index) => (
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
