import { useEffect, useRef, useState } from "react";
import type { Route } from "./+types/home";

type ChatRole = "user" | "assistant";

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

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Simple Chat" },
    { name: "description", content: "Simple desktop chat app with OpenAI backend." },
  ];
}

export default function Home() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isSending]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || isSending) {
      return;
    }

    const userMessage: ChatMessage = createMessage("user", content);
    const history = messages
      .slice(-10)
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

  return (
    <main className="chat-page">
      <section className="chat-shell">
        <header className="chat-header">
          <h1>Simple Chat</h1>
          <p>Set AZURE_BASE_URL and AZURE_API_VERSION to enable responses.</p>
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
            <button type="submit" disabled={isSending || draft.trim().length === 0}>
              Send
            </button>
          </form>
        </footer>
      </section>
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
