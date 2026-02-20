import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CopyIconButton } from "~/components/home/shared/CopyIconButton";
import { buildMcpEntryCopyPayload } from "~/lib/home/chat/history";
import { formatChatAttachmentSize } from "~/lib/home/chat/attachments";
import type { ChatMessage } from "~/lib/home/chat/messages";
import type { JsonToken } from "~/lib/home/chat/json-highlighting";
import {
  formatJsonForDisplay,
  isJsonCodeClassName,
  parseJsonMessageTokens,
  tokenizeJson,
} from "~/lib/home/chat/json-highlighting";
import type { McpRpcHistoryEntry } from "~/lib/home/chat/stream";

type JsonHighlightStyle = "default" | "compact";

export function renderTurnMcpLog(
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

export function renderMessageContent(message: ChatMessage) {
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

function renderHighlightedJson(
  value: unknown,
  ariaLabel: string,
  style: JsonHighlightStyle,
) {
  const formatted = formatJsonForDisplay(value);
  const tokens = tokenizeJson(formatted);
  return renderJsonTokens(tokens, ariaLabel, style);
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
