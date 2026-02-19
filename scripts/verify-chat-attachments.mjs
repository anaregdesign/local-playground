import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = process.env.LOCAL_PLAYGROUND_BASE_URL || "http://localhost:5180";
const DEFAULT_PROJECT_NAME = process.env.LOCAL_PLAYGROUND_PROJECT_NAME || "gp52-project-resource";
const DEFAULT_DEPLOYMENT_NAME = process.env.LOCAL_PLAYGROUND_DEPLOYMENT || "gpt-5.2";
const FIXTURE_DIRECTORY = path.join(os.tmpdir(), "local-playground-chat-attachment-fixtures");
const AGENT_INSTRUCTION = [
  "You are a concise assistant for a local playground app.",
  "Reply briefly.",
].join(" ");
const REQUEST_TIMEOUT_MS = 150_000;

const MIME_TYPE_BY_EXTENSION = {
  c: "text/plain",
  cpp: "text/plain",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  html: "text/html",
  java: "text/plain",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  php: "text/plain",
  pkl: "application/octet-stream",
  png: "image/png",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  py: "text/x-python",
  rb: "text/plain",
  tar: "application/x-tar",
  tex: "text/plain",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  zip: "application/zip",
};

async function main() {
  const extensions = await readAttachmentExtensions();
  if (extensions.length === 0) {
    throw new Error("Failed to read attachment extensions from constants.");
  }

  const { project, deploymentName } = await resolveAzureTarget(
    DEFAULT_BASE_URL,
    DEFAULT_PROJECT_NAME,
    DEFAULT_DEPLOYMENT_NAME,
  );

  await fs.mkdir(FIXTURE_DIRECTORY, { recursive: true });
  const fixtureByExtension = await createFixtures(extensions, FIXTURE_DIRECTORY);

  const results = [];
  for (const extension of extensions) {
    console.log(`Sending .${extension}...`);
    const fixturePath = fixtureByExtension.get(extension);
    if (!fixturePath) {
      results.push({
        extension,
        ok: false,
        status: 0,
        error: "Fixture file is missing.",
      });
      continue;
    }

    const attachment = await readAttachment(fixturePath, extension);
    const result = await sendAttachment({
      baseUrl: DEFAULT_BASE_URL,
      project,
      deploymentName,
      attachment,
    });
    if (result.ok) {
      console.log(`  -> OK (status=${result.status})`);
    } else {
      console.log(`  -> FAIL (status=${result.status}) ${result.error}`);
    }
    results.push({
      extension,
      ...result,
    });
  }

  const okResults = results.filter((result) => result.ok);
  const failedResults = results.filter((result) => !result.ok);

  console.log(`\nVerified project: ${project.projectName}`);
  console.log(`Verified deployment: ${deploymentName}`);
  console.log(`Fixture directory: ${FIXTURE_DIRECTORY}`);
  console.log(`\nTotal: ${results.length}, Success: ${okResults.length}, Failed: ${failedResults.length}\n`);

  for (const result of results) {
    if (result.ok) {
      console.log(`[OK]   .${result.extension}  status=${result.status}`);
    } else {
      console.log(`[FAIL] .${result.extension}  status=${result.status}  ${result.error}`);
    }
  }

  if (failedResults.length > 0) {
    process.exitCode = 1;
  }
}

async function resolveAzureTarget(baseUrl, projectName, preferredDeployment) {
  const projectPayload = await fetchJson(`${baseUrl}/api/azure-connections`);
  const projects = Array.isArray(projectPayload.projects) ? projectPayload.projects : [];
  const project =
    projects.find((entry) => typeof entry.projectName === "string" && entry.projectName === projectName) ??
    projects[0];

  if (!project || typeof project.id !== "string") {
    throw new Error("No Azure project is available.");
  }

  const deploymentsPayload = await fetchJson(
    `${baseUrl}/api/azure-connections?projectId=${encodeURIComponent(project.id)}`,
  );
  const deployments = Array.isArray(deploymentsPayload.deployments)
    ? deploymentsPayload.deployments.filter((entry) => typeof entry === "string" && entry.trim())
    : [];

  if (deployments.length === 0) {
    throw new Error(`No deployment found for project "${project.projectName}".`);
  }

  const deploymentName = deployments.includes(preferredDeployment)
    ? preferredDeployment
    : deployments[0];

  return {
    project,
    deploymentName,
  };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON response from ${url}: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status}) for ${url}`);
  }

  return payload;
}

async function readAttachmentExtensions() {
  const constantsPath = path.resolve("app/lib/constants.ts");
  const source = await fs.readFile(constantsPath, "utf8");
  const setMatch = source.match(
    /CHAT_ATTACHMENT_ALLOWED_EXTENSIONS\s*=\s*new Set\(\[(?<entries>[\s\S]*?)\]\)/,
  );
  const entries = setMatch?.groups?.entries ?? "";
  const regex = /"([a-z0-9]+)"/g;
  const extensions = [];
  let current;
  while ((current = regex.exec(entries)) !== null) {
    extensions.push(current[1]);
  }
  return extensions;
}

async function createFixtures(extensions, fixtureDirectory) {
  const fixtureByExtension = new Map();
  for (const extension of extensions) {
    const fileName = `dummy.${extension}`;
    const filePath = path.join(fixtureDirectory, fileName);
    const content = buildDummyContent(extension);
    await fs.writeFile(filePath, content);
    fixtureByExtension.set(extension, filePath);
  }
  return fixtureByExtension;
}

function buildDummyContent(extension) {
  switch (extension) {
    case "png":
      return Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5R2f8AAAAASUVORK5CYII=",
        "base64",
      );
    case "jpg":
    case "jpeg":
      return Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQDxAQEA8PEA8QDw8QEA8QEA8QEA8QFREWFhURFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDQ0NDw0NDysZFRkrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrKysrK//AABEIAAEAAQMBIgACEQEDEQH/xAAXAAADAQAAAAAAAAAAAAAAAAAAAQID/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAER/9oADAMBAAIQAxAAAAHnAAH/xAAXEAADAQAAAAAAAAAAAAAAAAAAAREh/9oACAEBAAEFAjM//8QAFhEBAQEAAAAAAAAAAAAAAAAAABEB/9oACAEDAQE/Aaf/xAAWEQEBAQAAAAAAAAAAAAAAAAABABH/2gAIAQIBAT8Bp//EABkQAAIDAQAAAAAAAAAAAAAAAAABERAhMf/aAAgBAQAGPwKFqH//xAAZEAEBAAMBAAAAAAAAAAAAAAABEQAhMWH/2gAIAQEAAT8hKTQJ2jC6UY7n/9oADAMBAAIAAwAAABCf/8QAFxEAAwEAAAAAAAAAAAAAAAAAAAERIf/aAAgBAwEBPxB2H//EABYRAQEBAAAAAAAAAAAAAAAAAAABEf/aAAgBAgEBPxBf/8QAGxABAQACAwEAAAAAAAAAAAAAAREAITFBYXH/2gAIAQEAAT8QmT2d2K6KOkQx5whvoaA6wQ2i6qZqP//Z",
        "base64",
      );
    case "gif":
      return Buffer.from("R0lGODlhAQABAIAAAP///////ywAAAAAAQABAAACAkQBADs=", "base64");
    case "pdf":
      return Buffer.from(
        "%PDF-1.1\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\nxref\n0 4\n0000000000 65535 f \n0000000010 00000 n \n0000000062 00000 n \n0000000121 00000 n \ntrailer\n<< /Root 1 0 R /Size 4 >>\nstartxref\n182\n%%EOF\n",
        "utf8",
      );
    case "zip":
    case "docx":
    case "xlsx":
    case "pptx":
      return Buffer.from("PK\u0003\u0004dummy-content", "binary");
    case "tar":
      return Buffer.from("dummy-tar-content", "utf8");
    case "pkl":
      return Buffer.from([0x80, 0x04, 0x95, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x8c, 0x05, 0x64, 0x75, 0x6d, 0x6d, 0x79, 0x94, 0x2e]);
    case "csv":
      return Buffer.from("id,name\n1,dummy\n", "utf8");
    case "json":
      return Buffer.from("{\"dummy\":true}\n", "utf8");
    case "xml":
      return Buffer.from("<?xml version=\"1.0\" encoding=\"UTF-8\"?><root>dummy</root>\n", "utf8");
    case "html":
      return Buffer.from("<!doctype html><html><body>dummy</body></html>\n", "utf8");
    case "md":
      return Buffer.from("# dummy\n\ncontent\n", "utf8");
    case "tex":
      return Buffer.from("\\documentclass{article}\\begin{document}dummy\\end{document}\n", "utf8");
    case "py":
      return Buffer.from("print('dummy')\n", "utf8");
    case "js":
      return Buffer.from("console.log('dummy');\n", "utf8");
    case "java":
      return Buffer.from("class Dummy { public static void main(String[] args) {} }\n", "utf8");
    case "c":
      return Buffer.from("int main(void){return 0;}\n", "utf8");
    case "cpp":
      return Buffer.from("int main(){return 0;}\n", "utf8");
    case "php":
      return Buffer.from("<?php echo 'dummy';\n", "utf8");
    case "rb":
      return Buffer.from("puts 'dummy'\n", "utf8");
    case "txt":
      return Buffer.from("dummy text\n", "utf8");
    default:
      return Buffer.from(`dummy .${extension}\n`, "utf8");
  }
}

async function readAttachment(filePath, extension) {
  const content = await fs.readFile(filePath);
  const mimeType = MIME_TYPE_BY_EXTENSION[extension] || "application/octet-stream";
  return {
    name: path.basename(filePath),
    mimeType,
    sizeBytes: content.byteLength,
    dataUrl: `data:${mimeType};base64,${content.toString("base64")}`,
  };
}

async function sendAttachment({ baseUrl, project, deploymentName, attachment }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort(new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms.`));
  }, REQUEST_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        message: "Please reply with OK.",
        attachments: [attachment],
        history: [],
        azureConfig: {
          projectName: project.projectName,
          baseUrl: project.baseUrl,
          apiVersion: project.apiVersion || "v1",
          deploymentName,
        },
        reasoningEffort: "low",
        contextWindowSize: 1,
        agentInstruction: AGENT_INSTRUCTION,
        mcpServers: [],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeoutId);
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : "Request failed.",
    };
  } finally {
    clearTimeout(timeoutId);
  }

  const text = await response.text();
  let payload = {};
  try {
    payload = JSON.parse(text);
  } catch {
    return {
      ok: false,
      status: response.status,
      error: `Invalid JSON response: ${text.slice(0, 240)}`,
    };
  }

  if (!response.ok || payload.error) {
    return {
      ok: false,
      status: response.status,
      error: payload.error || `Request failed (${response.status}).`,
    };
  }
  if (typeof payload.message !== "string" || !payload.message.trim()) {
    return {
      ok: false,
      status: response.status,
      error: "Server returned an empty assistant message.",
    };
  }
  return {
    ok: true,
    status: response.status,
    error: "",
  };
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
