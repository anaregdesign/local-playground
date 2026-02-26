/**
 * Server runtime module.
 */
import { spawn } from "node:child_process";
import { constants as fsConstants, type Dirent } from "node:fs";
import {
  access,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import nodeOs from "node:os";
import path from "node:path";
import {
  AGENT_SKILL_ASSET_FILE_MAX_BYTES,
  AGENT_SKILL_ASSETS_DIRECTORY_NAME,
  AGENT_SKILL_REFERENCE_FILE_MAX_BYTES,
  AGENT_SKILL_REFERENCES_DIRECTORY_NAME,
  AGENT_SKILL_RESOURCES_DIRECTORY_NAME,
  AGENT_SKILL_RESOURCE_MAX_FILES_PER_DIRECTORY,
  AGENT_SKILL_RESOURCE_PATH_MAX_LENGTH,
  AGENT_SKILL_SCRIPT_ARG_MAX_LENGTH,
  AGENT_SKILL_SCRIPT_MAX_ARGS,
  AGENT_SKILL_SCRIPT_OUTPUT_MAX_CHARS,
  AGENT_SKILL_SCRIPT_TIMEOUT_MAX_MS,
  AGENT_SKILL_SCRIPT_TIMEOUT_MS,
  AGENT_SKILL_SCRIPTS_DIRECTORY_NAME,
} from "~/lib/constants";

const SKILL_RESOURCE_DIRECTORY_BY_KIND = {
  scripts: AGENT_SKILL_SCRIPTS_DIRECTORY_NAME,
  references: AGENT_SKILL_REFERENCES_DIRECTORY_NAME,
  assets: AGENT_SKILL_ASSETS_DIRECTORY_NAME,
} as const;

// agentskills.io defines scripts/references/assets as canonical directories.
// resources/ is a non-standard optional directory used by some skills.
// Include it when SKILL.md guidance and resource discovery indicate it is required.
const SKILL_RESOURCE_DIRECTORY_CANDIDATES_BY_KIND = {
  scripts: [AGENT_SKILL_SCRIPTS_DIRECTORY_NAME],
  references: [AGENT_SKILL_REFERENCES_DIRECTORY_NAME, AGENT_SKILL_RESOURCES_DIRECTORY_NAME],
  assets: [AGENT_SKILL_ASSETS_DIRECTORY_NAME, AGENT_SKILL_RESOURCES_DIRECTORY_NAME],
} as const;

export type SkillResourceKind = keyof typeof SKILL_RESOURCE_DIRECTORY_BY_KIND;

export type SkillResourceFileEntry = {
  path: string;
  sizeBytes: number;
};

export type SkillResourceManifest = {
  skillRoot: string;
  scripts: SkillResourceFileEntry[];
  references: SkillResourceFileEntry[];
  assets: SkillResourceFileEntry[];
  scriptsTruncated: boolean;
  referencesTruncated: boolean;
  assetsTruncated: boolean;
};

export type SkillScriptRunOptions = {
  skillRoot: string;
  relativePath: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  outputMaxChars?: number;
};

export type SkillScriptRunResult = {
  command: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  environmentChanges: {
    captured: boolean;
    updated: Record<string, string>;
    removed: string[];
  };
};

type ListedSkillResourceFiles = {
  files: SkillResourceFileEntry[];
  truncated: boolean;
};

type PendingDirectory = {
  absolutePath: string;
  relativePath: string;
};

type SkillResourceDirectoryResolution = {
  name: string;
  absolutePath: string;
};

export async function inspectSkillResourceManifest(skillLocation: string): Promise<SkillResourceManifest> {
  const normalizedLocation = skillLocation.trim();
  if (!normalizedLocation) {
    throw new Error("Skill location is required.");
  }

  if (path.basename(normalizedLocation) !== "SKILL.md") {
    throw new Error("Skill location must point to SKILL.md.");
  }

  const skillRoot = path.dirname(normalizedLocation);
  const [scriptsResult, referencesResult, assetsResult] = await Promise.all([
    listSkillResourceFiles(skillRoot, "scripts"),
    listSkillResourceFiles(skillRoot, "references"),
    listSkillResourceFiles(skillRoot, "assets"),
  ]);

  return {
    skillRoot,
    scripts: scriptsResult.files,
    references: referencesResult.files,
    assets: assetsResult.files,
    scriptsTruncated: scriptsResult.truncated,
    referencesTruncated: referencesResult.truncated,
    assetsTruncated: assetsResult.truncated,
  };
}

export async function readSkillResourceText(options: {
  skillRoot: string;
  kind: "references" | "assets";
  relativePath: string;
  maxBytes?: number;
}): Promise<string> {
  const absolutePath = await resolveSkillResourceFilePath(
    options.skillRoot,
    options.kind,
    options.relativePath,
  );
  const maxBytes = normalizeMaxBytes(options.maxBytes, options.kind);
  const fileStats = await stat(absolutePath);
  if (fileStats.size > maxBytes) {
    throw new Error(`Skill ${options.kind} file exceeds ${maxBytes} bytes.`);
  }

  return await readFile(absolutePath, "utf8");
}

export async function readSkillResourceBuffer(options: {
  skillRoot: string;
  kind: "assets";
  relativePath: string;
  maxBytes?: number;
}): Promise<Buffer> {
  const absolutePath = await resolveSkillResourceFilePath(
    options.skillRoot,
    options.kind,
    options.relativePath,
  );
  const maxBytes = normalizeMaxBytes(options.maxBytes, options.kind);
  const fileStats = await stat(absolutePath);
  if (fileStats.size > maxBytes) {
    throw new Error(`Skill ${options.kind} file exceeds ${maxBytes} bytes.`);
  }

  return await readFile(absolutePath);
}

export async function runSkillScript(options: SkillScriptRunOptions): Promise<SkillScriptRunResult> {
  const scriptPath = await resolveSkillResourceFilePath(
    options.skillRoot,
    "scripts",
    options.relativePath,
  );
  const scriptArgs = normalizeScriptArgs(options.args);
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const outputMaxChars = normalizeOutputMaxChars(options.outputMaxChars);
  const baseEnvironment = normalizeProcessEnvironment(options.env);
  const command = resolveScriptCommand(scriptPath, scriptArgs);

  if (command.captureEnvironment === "bash") {
    return await runProcessWithShellEnvironmentCapture({
      scriptPath,
      scriptArgs,
      cwd: path.resolve(options.skillRoot),
      env: baseEnvironment,
      timeoutMs,
      outputMaxChars,
    });
  }

  if (command.captureEnvironment === "pwsh") {
    return await runProcessWithPowerShellEnvironmentCapture({
      scriptPath,
      scriptArgs,
      cwd: path.resolve(options.skillRoot),
      env: baseEnvironment,
      timeoutMs,
      outputMaxChars,
    });
  }

  if (command.captureEnvironment === "cmd") {
    return await runProcessWithWindowsCommandEnvironmentCapture({
      scriptPath,
      scriptArgs,
      cwd: path.resolve(options.skillRoot),
      env: baseEnvironment,
      timeoutMs,
      outputMaxChars,
    });
  }

  return await runProcess({
    command: command.command,
    args: command.args,
    cwd: path.resolve(options.skillRoot),
    env: baseEnvironment,
    timeoutMs,
    outputMaxChars,
  });
}

async function listSkillResourceFiles(
  skillRoot: string,
  kind: SkillResourceKind,
): Promise<ListedSkillResourceFiles> {
  const baseDirectories = await resolveSkillResourceDirectories(skillRoot, kind);
  if (baseDirectories.length === 0) {
    return {
      files: [],
      truncated: false,
    };
  }

  const files: SkillResourceFileEntry[] = [];
  const seenFilePaths = new Set<string>();
  const pendingDirectories: PendingDirectory[] = baseDirectories.map((directory) => ({
    absolutePath: directory.absolutePath,
    relativePath: "",
  }));
  let truncated = false;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.shift();
    if (!currentDirectory) {
      continue;
    }

    let entries: Dirent[];
    try {
      entries = await readdir(currentDirectory.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }

      const childRelativePath = joinRelativePath(currentDirectory.relativePath, entry.name);
      const childAbsolutePath = path.join(currentDirectory.absolutePath, entry.name);

      if (entry.isDirectory()) {
        pendingDirectories.push({
          absolutePath: childAbsolutePath,
          relativePath: childRelativePath,
        });
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStats = await stat(childAbsolutePath).catch(() => null);
      if (!fileStats || !fileStats.isFile()) {
        continue;
      }

      if (seenFilePaths.has(childRelativePath)) {
        continue;
      }
      seenFilePaths.add(childRelativePath);

      files.push({
        path: childRelativePath,
        sizeBytes: fileStats.size,
      });

      if (files.length >= AGENT_SKILL_RESOURCE_MAX_FILES_PER_DIRECTORY) {
        truncated = true;
        break;
      }
    }

    if (truncated) {
      break;
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  return {
    files,
    truncated,
  };
}

async function resolveSkillResourceFilePath(
  skillRoot: string,
  kind: SkillResourceKind,
  relativePath: string,
): Promise<string> {
  const resourceDirectories = await resolveSkillResourceDirectories(skillRoot, kind);
  if (resourceDirectories.length === 0) {
    throw new Error(buildSkillMissingDirectoryError(kind));
  }

  const normalizedRelativePath = normalizeSkillRelativePath(relativePath);
  const relativePathSegments = normalizedRelativePath.split("/");
  let lastError: unknown = null;

  for (const resourceDirectory of resourceDirectories) {
    const candidateRelativePath = normalizeSkillRelativePathForDirectory(
      relativePathSegments,
      kind,
      resourceDirectory.name,
    );
    const candidatePath = path.resolve(resourceDirectory.absolutePath, candidateRelativePath);
    if (!isPathWithin(candidatePath, resourceDirectory.absolutePath)) {
      throw new Error(`Skill ${kind} path must stay inside the skill directory.`);
    }

    try {
      await assertReadableSkillResourcePath(candidatePath, resourceDirectory.absolutePath, kind);
      return candidatePath;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error(`Skill ${kind} path was not found.`);
}

async function assertReadableSkillResourcePath(
  candidatePath: string,
  scopeDirectory: string,
  kind: SkillResourceKind,
): Promise<void> {
  await access(candidatePath, fsConstants.R_OK);

  const fileStats = await lstat(candidatePath);
  if (fileStats.isSymbolicLink()) {
    throw new Error(`Skill ${kind} path cannot be a symbolic link.`);
  }

  if (!fileStats.isFile()) {
    throw new Error(`Skill ${kind} path must target a file.`);
  }

  const [scopeDirectoryRealPath, candidateRealPath] = await Promise.all([
    realpath(scopeDirectory).catch(() => scopeDirectory),
    realpath(candidatePath).catch(() => candidatePath),
  ]);

  if (!isPathWithin(candidateRealPath, scopeDirectoryRealPath)) {
    throw new Error(`Skill ${kind} path must stay inside the skill directory.`);
  }
}

async function resolveSkillResourceDirectories(
  skillRoot: string,
  kind: SkillResourceKind,
): Promise<SkillResourceDirectoryResolution[]> {
  const normalizedSkillRoot = skillRoot.trim();
  if (!normalizedSkillRoot) {
    throw new Error("Skill root is required.");
  }

  const directoryNames = SKILL_RESOURCE_DIRECTORY_CANDIDATES_BY_KIND[kind];
  const resolutions = await Promise.all(
    directoryNames.map(async (directoryName) => {
      const absolutePath = path.resolve(normalizedSkillRoot, directoryName);
      const exists = await directoryExists(absolutePath);
      return {
        name: directoryName,
        absolutePath,
        exists,
      };
    }),
  );

  return resolutions
    .filter((resolution) => resolution.exists)
    .map((resolution) => ({
      name: resolution.name,
      absolutePath: resolution.absolutePath,
    }));
}

function buildSkillMissingDirectoryError(kind: SkillResourceKind): string {
  const names = SKILL_RESOURCE_DIRECTORY_CANDIDATES_BY_KIND[kind];
  if (names.length === 1) {
    return `Skill does not include ${names[0]} directory.`;
  }

  return `Skill does not include ${names.join(" or ")} directory.`;
}

function normalizeSkillRelativePathForDirectory(
  pathSegments: string[],
  kind: SkillResourceKind,
  directoryName: string,
): string {
  const canonicalDirectoryName = SKILL_RESOURCE_DIRECTORY_BY_KIND[kind];
  const relativeSegments =
    pathSegments[0] === canonicalDirectoryName || pathSegments[0] === directoryName
      ? pathSegments.slice(1)
      : pathSegments;
  if (relativeSegments.length === 0) {
    throw new Error("Skill path must target a file.");
  }

  return path.join(...relativeSegments);
}

function normalizeSkillRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").trim();
  if (!normalized) {
    throw new Error("Skill path is required.");
  }

  if (normalized.length > AGENT_SKILL_RESOURCE_PATH_MAX_LENGTH) {
    throw new Error(
      `Skill path must be ${AGENT_SKILL_RESOURCE_PATH_MAX_LENGTH} characters or fewer.`,
    );
  }

  if (normalized.startsWith("/")) {
    throw new Error("Skill path must be relative.");
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Skill path contains invalid segments.");
  }
  return normalized;
}

function normalizeMaxBytes(value: number | undefined, kind: "references" | "assets"): number {
  const fallback = kind === "references" ? AGENT_SKILL_REFERENCE_FILE_MAX_BYTES : AGENT_SKILL_ASSET_FILE_MAX_BYTES;
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || !value || value <= 0) {
    return fallback;
  }

  return Math.min(value, fallback);
}

function normalizeScriptArgs(value: string[]): string[] {
  if (!Array.isArray(value)) {
    throw new Error("Script args must be an array.");
  }

  if (value.length > AGENT_SKILL_SCRIPT_MAX_ARGS) {
    throw new Error(`Script args must include at most ${AGENT_SKILL_SCRIPT_MAX_ARGS} items.`);
  }

  const result: string[] = [];
  for (const [index, entry] of value.entries()) {
    if (typeof entry !== "string") {
      throw new Error(`Script arg at index ${index} must be a string.`);
    }

    if (entry.length > AGENT_SKILL_SCRIPT_ARG_MAX_LENGTH) {
      throw new Error(
        `Script arg at index ${index} must be ${AGENT_SKILL_SCRIPT_ARG_MAX_LENGTH} characters or fewer.`,
      );
    }

    result.push(entry);
  }

  return result;
}

function normalizeTimeoutMs(value: number | undefined): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || !value || value <= 0) {
    return AGENT_SKILL_SCRIPT_TIMEOUT_MS;
  }

  return Math.min(Math.max(1, value), AGENT_SKILL_SCRIPT_TIMEOUT_MAX_MS);
}

function normalizeOutputMaxChars(value: number | undefined): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || !value || value <= 0) {
    return AGENT_SKILL_SCRIPT_OUTPUT_MAX_CHARS;
  }

  return Math.max(128, value);
}

function resolveScriptCommand(
  scriptPath: string,
  scriptArgs: string[],
): {
  command: string;
  args: string[];
  captureEnvironment: false | "bash" | "pwsh" | "cmd";
} {
  const extension = path.extname(scriptPath).toLowerCase();

  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") {
    return {
      command: process.execPath,
      args: [scriptPath, ...scriptArgs],
      captureEnvironment: false,
    };
  }

  if (extension === ".py") {
    return {
      command: process.platform === "win32" ? "python" : "python3",
      args: [scriptPath, ...scriptArgs],
      captureEnvironment: false,
    };
  }

  if (extension === ".sh" || extension === ".bash") {
    return {
      command: "bash",
      args: [scriptPath, ...scriptArgs],
      captureEnvironment: "bash",
    };
  }

  if (extension === ".ps1") {
    const powerShellCommand = readDefaultPowerShellCommandPath();
    return {
      command: powerShellCommand,
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs],
      captureEnvironment: "pwsh",
    };
  }

  if (extension === ".cmd" || extension === ".bat") {
    if (process.platform === "win32") {
      return {
        command: readDefaultCmdCommandPath(),
        args: ["/d", "/s", "/c", scriptPath, ...scriptArgs],
        captureEnvironment: "cmd",
      };
    }
  }

  return {
    command: scriptPath,
    args: scriptArgs,
    captureEnvironment: false,
  };
}

async function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputMaxChars: number;
}): Promise<SkillScriptRunResult> {
  const child = spawn(options.command, options.args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let truncated = false;
  let timedOut = false;

  const recordOutput = (target: "stdout" | "stderr", chunk: string) => {
    if (!chunk) {
      return;
    }

    const previousValue = target === "stdout" ? stdout : stderr;
    const nextValue = appendLimited(previousValue, chunk, options.outputMaxChars);
    if (nextValue.truncated) {
      truncated = true;
    }

    if (target === "stdout") {
      stdout = nextValue.value;
    } else {
      stderr = nextValue.value;
    }
  };

  if (child.stdout) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      recordOutput("stdout", chunk);
    });
  }

  if (child.stderr) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      recordOutput("stderr", chunk);
    });
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, options.timeoutMs);

  try {
    const completion = await new Promise<{
      exitCode: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, signal) => {
        resolve({
          exitCode,
          signal,
        });
      });
    });

    return {
      command: [options.command, ...options.args],
      exitCode: completion.exitCode,
      signal: completion.signal,
      stdout,
      stderr,
      timedOut,
      truncated,
      environmentChanges: {
        captured: false,
        updated: {},
        removed: [],
      },
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function appendLimited(
  existing: string,
  next: string,
  maxChars: number,
): {
  value: string;
  truncated: boolean;
} {
  if (existing.length >= maxChars) {
    return {
      value: existing,
      truncated: true,
    };
  }

  const remainingChars = maxChars - existing.length;
  if (next.length <= remainingChars) {
    return {
      value: `${existing}${next}`,
      truncated: false,
    };
  }

  return {
    value: `${existing}${next.slice(0, remainingChars)}`,
    truncated: true,
  };
}

function normalizeProcessEnvironment(
  value: Record<string, string> | undefined,
): NodeJS.ProcessEnv {
  const normalized: NodeJS.ProcessEnv = {};
  const source = value ?? process.env;
  for (const [key, entry] of Object.entries(source)) {
    if (typeof entry !== "string") {
      continue;
    }

    normalized[key] = entry;
  }
  return normalized;
}

async function runProcessWithShellEnvironmentCapture(options: {
  scriptPath: string;
  scriptArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputMaxChars: number;
}): Promise<SkillScriptRunResult> {
  const tempDirectory = await mkdtemp(
    path.join(nodeOs.tmpdir(), "local-playground-skill-env-"),
  );
  const environmentSnapshotPath = path.join(tempDirectory, "environment.snapshot");
  const wrapperPath = path.join(tempDirectory, "capture-env.sh");

  const wrapperScript = [
    "#!/usr/bin/env bash",
    "__local_playground_capture_env() {",
    '  if [[ -n "${LOCAL_PLAYGROUND_ENV_CAPTURE_FILE:-}" ]]; then',
    '    env -0 > "${LOCAL_PLAYGROUND_ENV_CAPTURE_FILE}" 2>/dev/null || true',
    "  fi",
    "}",
    "trap __local_playground_capture_env EXIT",
    "set +e",
    'source "$1" "${@:2}"',
    "exit $?",
    "",
  ].join("\n");

  await writeFile(wrapperPath, wrapperScript, {
    encoding: "utf8",
    mode: 0o700,
  });

  try {
    const bashCommand =
      process.platform === "win32"
        ? "bash"
        : readDefaultBashCommandPath();
    const runtimeEnvironment = {
      ...options.env,
      LOCAL_PLAYGROUND_ENV_CAPTURE_FILE: environmentSnapshotPath,
    };
    const result = await runProcess({
      command: bashCommand,
      args: [wrapperPath, options.scriptPath, ...options.scriptArgs],
      cwd: options.cwd,
      env: runtimeEnvironment,
      timeoutMs: options.timeoutMs,
      outputMaxChars: options.outputMaxChars,
    });

    const capturedEnvironment = await readCapturedEnvironmentSnapshot(environmentSnapshotPath);
    if (!capturedEnvironment) {
      return result;
    }

    const environmentChanges = readEnvironmentChanges(options.env, capturedEnvironment);
    return {
      ...result,
      environmentChanges: {
        captured: true,
        ...environmentChanges,
      },
    };
  } finally {
    await rm(tempDirectory, {
      recursive: true,
      force: true,
    });
  }
}

function readDefaultBashCommandPath(): string {
  const configured = typeof process.env.BASH === "string" ? process.env.BASH.trim() : "";
  if (configured) {
    return configured;
  }

  return "/bin/bash";
}

function readDefaultPowerShellCommandPath(): string {
  const configuredPwsh = typeof process.env.PWSH === "string" ? process.env.PWSH.trim() : "";
  if (configuredPwsh) {
    return configuredPwsh;
  }

  const configuredPowerShell =
    typeof process.env.POWERSHELL === "string" ? process.env.POWERSHELL.trim() : "";
  if (configuredPowerShell) {
    return configuredPowerShell;
  }

  return process.platform === "win32" ? "powershell.exe" : "pwsh";
}

function readDefaultCmdCommandPath(): string {
  const configuredComSpec =
    typeof process.env.ComSpec === "string" ? process.env.ComSpec.trim() : "";
  if (configuredComSpec) {
    return configuredComSpec;
  }

  const configuredComspec =
    typeof process.env.COMSPEC === "string" ? process.env.COMSPEC.trim() : "";
  if (configuredComspec) {
    return configuredComspec;
  }

  const configured = typeof process.env.SystemRoot === "string" ? process.env.SystemRoot.trim() : "";
  if (configured) {
    return path.join(configured, "System32", "cmd.exe");
  }

  return "cmd.exe";
}

async function runProcessWithPowerShellEnvironmentCapture(options: {
  scriptPath: string;
  scriptArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputMaxChars: number;
}): Promise<SkillScriptRunResult> {
  const tempDirectory = await mkdtemp(
    path.join(nodeOs.tmpdir(), "local-playground-skill-env-"),
  );
  const environmentSnapshotPath = path.join(tempDirectory, "environment.snapshot");
  const wrapperPath = path.join(tempDirectory, "capture-env.ps1");

  const wrapperScript = [
    "param(",
    "  [Parameter(Mandatory = $true)][string]$ScriptPath,",
    "  [Parameter(Mandatory = $true)][string]$CaptureFile,",
    "  [string[]]$ScriptArgs",
    ")",
    '$ErrorActionPreference = "Continue"',
    "$scriptExitCode = 0",
    "try {",
    "  . $ScriptPath @ScriptArgs",
    "  if ($LASTEXITCODE -is [int]) {",
    "    $scriptExitCode = [int]$LASTEXITCODE",
    "  }",
    "} catch {",
    "  Write-Error $_",
    "  $scriptExitCode = 1",
    "} finally {",
    "  try {",
    "    $pairs = New-Object System.Collections.Generic.List[string]",
    "    Get-ChildItem Env: | ForEach-Object {",
    '      $pairs.Add("$($_.Name)=$($_.Value)")',
    "    }",
    '    $text = [string]::Join("`0", $pairs) + "`0"',
    "    [System.IO.File]::WriteAllBytes(",
    "      $CaptureFile,",
    "      [System.Text.Encoding]::UTF8.GetBytes($text)",
    "    )",
    "  } catch {",
    "    # Best effort capture.",
    "  }",
    "}",
    "exit $scriptExitCode",
    "",
  ].join("\n");

  await writeFile(wrapperPath, wrapperScript, {
    encoding: "utf8",
    mode: 0o700,
  });

  try {
    const powerShellCommand = readDefaultPowerShellCommandPath();
    const result = await runProcess({
      command: powerShellCommand,
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        wrapperPath,
        options.scriptPath,
        environmentSnapshotPath,
        ...options.scriptArgs,
      ],
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs,
      outputMaxChars: options.outputMaxChars,
    });

    const capturedEnvironment = await readCapturedEnvironmentSnapshot(environmentSnapshotPath);
    if (!capturedEnvironment) {
      return result;
    }

    const environmentChanges = readEnvironmentChanges(options.env, capturedEnvironment);
    return {
      ...result,
      environmentChanges: {
        captured: true,
        ...environmentChanges,
      },
    };
  } finally {
    await rm(tempDirectory, {
      recursive: true,
      force: true,
    });
  }
}

async function runProcessWithWindowsCommandEnvironmentCapture(options: {
  scriptPath: string;
  scriptArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  outputMaxChars: number;
}): Promise<SkillScriptRunResult> {
  const tempDirectory = await mkdtemp(
    path.join(nodeOs.tmpdir(), "local-playground-skill-env-"),
  );
  const environmentSnapshotPath = path.join(tempDirectory, "environment.snapshot");
  const wrapperPath = path.join(tempDirectory, "capture-env.cmd");

  const wrapperScript = [
    "@echo off",
    "setlocal enableextensions",
    'set "__LOCAL_PLAYGROUND_SCRIPT=%~1"',
    "shift",
    'if not defined __LOCAL_PLAYGROUND_SCRIPT exit /b 1',
    'call "%__LOCAL_PLAYGROUND_SCRIPT%" %*',
    'set "__LOCAL_PLAYGROUND_SCRIPT_EXIT_CODE=%ERRORLEVEL%"',
    "if defined LOCAL_PLAYGROUND_ENV_CAPTURE_FILE (",
    '  >"%LOCAL_PLAYGROUND_ENV_CAPTURE_FILE%" set',
    ")",
    "exit /b %__LOCAL_PLAYGROUND_SCRIPT_EXIT_CODE%",
    "",
  ].join("\r\n");

  await writeFile(wrapperPath, wrapperScript, {
    encoding: "utf8",
    mode: 0o700,
  });

  try {
    const runtimeEnvironment = {
      ...options.env,
      LOCAL_PLAYGROUND_ENV_CAPTURE_FILE: environmentSnapshotPath,
    };
    const result = await runProcess({
      command: readDefaultCmdCommandPath(),
      args: ["/d", "/s", "/c", wrapperPath, options.scriptPath, ...options.scriptArgs],
      cwd: options.cwd,
      env: runtimeEnvironment,
      timeoutMs: options.timeoutMs,
      outputMaxChars: options.outputMaxChars,
    });

    const capturedEnvironment = await readCapturedEnvironmentSnapshot(environmentSnapshotPath);
    if (!capturedEnvironment) {
      return result;
    }

    const environmentChanges = readEnvironmentChanges(options.env, capturedEnvironment);
    return {
      ...result,
      environmentChanges: {
        captured: true,
        ...environmentChanges,
      },
    };
  } finally {
    await rm(tempDirectory, {
      recursive: true,
      force: true,
    });
  }
}

async function readCapturedEnvironmentSnapshot(
  snapshotPath: string,
): Promise<Record<string, string> | null> {
  try {
    const raw = await readFile(snapshotPath, "utf8");
    const entries = raw.includes("\0") ? raw.split("\0") : raw.split(/\r?\n/);
    const environment: Record<string, string> = {};
    for (const entry of entries) {
      if (!entry) {
        continue;
      }

      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = entry.slice(0, separatorIndex);
      const value = entry.slice(separatorIndex + 1);
      if (!key) {
        continue;
      }

      environment[key] = value;
    }

    return environment;
  } catch {
    return null;
  }
}

function readEnvironmentChanges(
  previous: NodeJS.ProcessEnv,
  next: Record<string, string>,
): {
  updated: Record<string, string>;
  removed: string[];
} {
  const updated: Record<string, string> = {};
  for (const [key, nextValue] of Object.entries(next)) {
    if (shouldIgnoreEnvironmentChangeKey(key)) {
      continue;
    }

    const previousValue = previous[key];
    if (typeof previousValue === "string" && previousValue === nextValue) {
      continue;
    }

    updated[key] = nextValue;
  }

  const removed: string[] = [];
  for (const [key, previousValue] of Object.entries(previous)) {
    if (typeof previousValue !== "string" || shouldIgnoreEnvironmentChangeKey(key)) {
      continue;
    }

    if (key in next) {
      continue;
    }

    removed.push(key);
  }

  return {
    updated,
    removed,
  };
}

function shouldIgnoreEnvironmentChangeKey(key: string): boolean {
  if (!key || key.startsWith("BASH_") || key.startsWith("__LOCAL_PLAYGROUND_")) {
    return true;
  }

  return (
    key === "LOCAL_PLAYGROUND_ENV_CAPTURE_FILE" ||
    key === "PSExecutionPolicyPreference" ||
    key === "CD" ||
    key === "_" ||
    key === "PWD" ||
    key === "OLDPWD" ||
    key === "SHLVL" ||
    key === "SHELLOPTS" ||
    key === "BASHOPTS" ||
    key === "BASHPID" ||
    key === "PPID" ||
    key === "EUID" ||
    key === "UID"
  );
}

function joinRelativePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}

function isPathWithin(targetPath: string, basePath: string): boolean {
  const relativePath = path.relative(basePath, targetPath);
  if (!relativePath) {
    return true;
  }

  return !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function directoryExists(location: string): Promise<boolean> {
  try {
    const locationStat = await stat(location);
    return locationStat.isDirectory();
  } catch {
    return false;
  }
}
