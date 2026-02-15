import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/home";

type ChatRole = "user" | "assistant";
type ReasoningEffort = "none" | "low" | "medium" | "high";
type McpTransport = "streamable_http" | "sse";

type McpServerConfig = {
  id: string;
  name: string;
  url: string;
  transport: McpTransport;
};

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
};

type ChatApiResponse = {
  message?: string;
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
const DEFAULT_AGENT_INSTRUCTION = "You are a concise assistant for a simple chat app.";
const MAX_INSTRUCTION_FILE_SIZE_BYTES = 200_000;
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
  const [mcpNameInput, setMcpNameInput] = useState("");
  const [mcpUrlInput, setMcpUrlInput] = useState("");
  const [mcpTransport, setMcpTransport] = useState<McpTransport>(DEFAULT_MCP_TRANSPORT);
  const [mcpFormError, setMcpFormError] = useState<string | null>(null);
  const [contextWindowInput, setContextWindowInput] = useState(
    String(DEFAULT_CONTEXT_WINDOW_SIZE),
  );
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);
  const contextWindowValidation = validateContextWindowInput(contextWindowInput);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isSending || !contextWindowValidation.isValid) {
      return;
    }

    const userMessage: ChatMessage = createMessage("user", content);
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
          agentInstruction,
          mcpServers: mcpServers.map(({ name, url, transport }) => ({
            name,
            url,
            transport,
          })),
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
        `Instruction file is too large. Max ${Math.floor(MAX_INSTRUCTION_FILE_SIZE_BYTES / 1000)}KB.`,
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

  function handleAddMcpServer() {
    const rawName = mcpNameInput.trim();
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
    const duplicated = mcpServers.some(
      (server) =>
        server.name.toLowerCase() === name.toLowerCase() &&
        server.url.toLowerCase() === normalizedUrl.toLowerCase(),
    );
    if (duplicated) {
      setMcpFormError("This MCP server is already added.");
      return;
    }

    setMcpServers((current) => [
      ...current,
      {
        id: createId("mcp"),
        name,
        url: normalizedUrl,
        transport: mcpTransport,
      },
    ]);
    setMcpFormError(null);
    setMcpNameInput("");
    setMcpUrlInput("");
    setMcpTransport(DEFAULT_MCP_TRANSPORT);
  }

  function handleRemoveMcpServer(id: string) {
    setMcpServers((current) => current.filter((server) => server.id !== id));
  }

  return (
    <main className="chat-page">
      <div className="chat-layout">
        <section className="chat-shell">
          <header className="chat-header">
            <h1>Simple Chat</h1>
            <p>Set AZURE_BASE_URL, AZURE_API_VERSION=v1, and AZURE_DEPLOYMENT_NAME.</p>
          </header>

          <div className="chat-log" aria-live="polite">
            {messages.map((message) => (
              <article
                key={message.id}
                className={`message-row ${message.role === "user" ? "user" : "assistant"}`}
              >
                <p>{message.content}</p>
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
                disabled={isSending}
              />
              <button
                type="submit"
                disabled={isSending || draft.trim().length === 0 || !contextWindowValidation.isValid}
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
              <p className="field-hint">Supported: .md, .txt, .xml, .json (max 200KB)</p>
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
              <input
                type="text"
                placeholder="https://example.com/mcp"
                value={mcpUrlInput}
                onChange={(event) => setMcpUrlInput(event.target.value)}
                disabled={isSending}
              />
              <select
                value={mcpTransport}
                onChange={(event) => setMcpTransport(event.target.value as McpTransport)}
                disabled={isSending}
              >
                <option value="streamable_http">streamable_http</option>
                <option value="sse">sse</option>
              </select>
              <button type="button" className="secondary-btn" onClick={handleAddMcpServer} disabled={isSending}>
                Add Server
              </button>
              {mcpFormError ? <p className="field-error">{mcpFormError}</p> : null}
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
                        <p className="mcp-item-url">{server.url}</p>
                        <p className="mcp-item-meta">{server.transport}</p>
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

function getFileExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  return parts.length > 1 ? parts[parts.length - 1] : "";
}

function createId(prefix: string): string {
  const randomPart = Math.random().toString(36).slice(2);
  return `${prefix}-${Date.now()}-${randomPart}`;
}
