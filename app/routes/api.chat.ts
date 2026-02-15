import type { Route } from "./+types/api.chat";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import { AzureOpenAI } from "openai";

type ChatRole = "user" | "assistant";

type ClientMessage = {
  role: ChatRole;
  content: string;
};

const AZURE_OPENAI_BASE_URL =
  process.env.AZURE_BASE_URL ?? process.env.AZURE_OPENAI_BASE_URL ?? "";
const AZURE_OPENAI_API_VERSION =
  process.env.AZURE_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION ?? "";
const AZURE_OPENAI_DEPLOYMENT_NAME = "gpt-4o-mini";
const AZURE_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
const SYSTEM_PROMPT = "You are a concise assistant for a simple chat app.";
let azureOpenAIClient: AzureOpenAI | null = null;

export function loader({}: Route.LoaderArgs) {
  return Response.json(
    { error: "Use POST /api/chat for this endpoint." },
    { status: 405 },
  );
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const message = readMessage(payload);
  if (!message) {
    return Response.json({ error: "`message` is required." }, { status: 400 });
  }

  const history = readHistory(payload);
  if (!AZURE_OPENAI_BASE_URL || !AZURE_OPENAI_API_VERSION) {
    return Response.json({
      message:
        "Azure OpenAI is not configured. Set AZURE_BASE_URL/AZURE_OPENAI_BASE_URL and AZURE_API_VERSION/AZURE_OPENAI_API_VERSION, then restart the server.",
      placeholder: true,
    });
  }

  try {
    const completion = await getAzureOpenAIClient().chat.completions.create({
      model: AZURE_OPENAI_DEPLOYMENT_NAME,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
        { role: "user", content: message },
      ],
      temperature: 0.7,
    });

    const assistantMessage = extractAssistantMessage(completion.choices?.[0]?.message?.content);
    if (!assistantMessage) {
      return Response.json(
        { error: "Azure OpenAI returned an empty message." },
        { status: 502 },
      );
    }

    return Response.json({ message: assistantMessage });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not connect to Azure OpenAI.",
      },
      { status: 502 },
    );
  }
}

function getAzureOpenAIClient(): AzureOpenAI {
  if (azureOpenAIClient) {
    return azureOpenAIClient;
  }

  const credential = new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(
    credential,
    AZURE_COGNITIVE_SERVICES_SCOPE,
  );

  azureOpenAIClient = new AzureOpenAI({
    azureADTokenProvider,
    baseURL: AZURE_OPENAI_BASE_URL,
    apiVersion: AZURE_OPENAI_API_VERSION,
  });

  return azureOpenAIClient;
}

function readMessage(payload: unknown): string {
  if (!isRecord(payload)) {
    return "";
  }
  const message = payload.message;
  if (typeof message !== "string") {
    return "";
  }
  return message.trim();
}

function readHistory(payload: unknown): ClientMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.history)) {
    return [];
  }

  return payload.history
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const role = entry.role;
      const content = entry.content;
      if ((role !== "user" && role !== "assistant") || typeof content !== "string") {
        return null;
      }

      const trimmedContent = content.trim();
      if (!trimmedContent) {
        return null;
      }

      return { role, content: trimmedContent };
    })
    .filter((entry): entry is ClientMessage => entry !== null)
    .slice(-10);
}

function extractAssistantMessage(
  content: string | Array<{ type?: string; text?: string }> | null | undefined,
): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((piece) => (typeof piece.text === "string" ? piece.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}
