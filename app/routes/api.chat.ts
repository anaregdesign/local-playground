import type { Route } from "./+types/api.chat";
import { DefaultAzureCredential, getBearerTokenProvider } from "@azure/identity";
import OpenAI from "openai";

type ChatRole = "user" | "assistant";

type ClientMessage = {
  role: ChatRole;
  content: string;
};

type ReasoningEffort = "none" | "low" | "medium" | "high";

const AZURE_OPENAI_BASE_URL =
  process.env.AZURE_BASE_URL ?? process.env.AZURE_OPENAI_BASE_URL ?? "";
const AZURE_OPENAI_API_VERSION =
  (process.env.AZURE_API_VERSION ?? process.env.AZURE_OPENAI_API_VERSION ?? "v1").trim();
const AZURE_OPENAI_DEPLOYMENT_NAME = (
  process.env.AZURE_DEPLOYMENT_NAME ?? process.env.AZURE_OPENAI_DEPLOYMENT_NAME ?? ""
).trim();
const AZURE_COGNITIVE_SERVICES_SCOPE = "https://cognitiveservices.azure.com/.default";
const SYSTEM_PROMPT = "You are a concise assistant for a simple chat app.";
let azureOpenAIClient: OpenAI | null = null;

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
  const reasoningEffort = readReasoningEffort(payload);
  if (!AZURE_OPENAI_BASE_URL) {
    return Response.json({
      message:
        "Azure OpenAI is not configured. Set AZURE_BASE_URL/AZURE_OPENAI_BASE_URL, then restart the server.",
      placeholder: true,
    });
  }
  if (!AZURE_OPENAI_DEPLOYMENT_NAME) {
    return Response.json(
      {
        error:
          "Azure deployment is not configured. Set AZURE_DEPLOYMENT_NAME (or AZURE_OPENAI_DEPLOYMENT_NAME).",
      },
      { status: 400 },
    );
  }
  if (AZURE_OPENAI_API_VERSION && AZURE_OPENAI_API_VERSION !== "v1") {
    return Response.json(
      {
        error:
          "For Azure OpenAI v1 endpoint, set AZURE_API_VERSION (or AZURE_OPENAI_API_VERSION) to `v1`.",
      },
      { status: 400 },
    );
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
      reasoning_effort: reasoningEffort,
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
        error: buildUpstreamErrorMessage(error),
      },
      { status: 502 },
    );
  }
}

function getAzureOpenAIClient(): OpenAI {
  if (azureOpenAIClient) {
    return azureOpenAIClient;
  }

  const credential = new DefaultAzureCredential();
  const azureADTokenProvider = getBearerTokenProvider(
    credential,
    AZURE_COGNITIVE_SERVICES_SCOPE,
  );

  azureOpenAIClient = new OpenAI({
    baseURL: normalizeAzureOpenAIBaseURL(AZURE_OPENAI_BASE_URL),
    apiKey: azureADTokenProvider,
  });

  return azureOpenAIClient;
}

function normalizeAzureOpenAIBaseURL(rawValue: string): string {
  const trimmed = rawValue.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  if (/\/openai\/v1$/i.test(trimmed)) {
    return `${trimmed}/`;
  }

  return `${trimmed}/openai/v1/`;
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

function readReasoningEffort(payload: unknown): ReasoningEffort {
  if (!isRecord(payload)) {
    return "none";
  }

  const value = payload.reasoningEffort;
  if (value === "none" || value === "low" || value === "medium" || value === "high") {
    return value;
  }
  return "none";
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

function buildUpstreamErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Could not connect to Azure OpenAI.";
  }

  if (error.message.includes("Resource not found")) {
    return `${error.message} Check AZURE_BASE_URL and deployment name (${AZURE_OPENAI_DEPLOYMENT_NAME}).`;
  }
  if (error.message.includes("Unavailable model")) {
    return `${error.message} Check AZURE_DEPLOYMENT_NAME (or AZURE_OPENAI_DEPLOYMENT_NAME).`;
  }

  return error.message;
}
