/**
 * Test module verifying runtime behavior.
 */
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  inspectSkillResourceManifest,
  readSkillResourceBuffer,
  readSkillResourceText,
  runSkillScript,
} from "~/lib/server/skills/runtime";

const tempDirectories: string[] = [];
const hasPowerShellRuntime = canRunCommand(
  process.platform === "win32" ? "powershell.exe" : "pwsh",
);

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0, tempDirectories.length).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("inspectSkillResourceManifest", () => {
  it("lists files under scripts/references/assets", async () => {
    const skillRoot = await createTempSkillRoot();

    await mkdir(path.join(skillRoot, "scripts", "nested"), { recursive: true });
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await mkdir(path.join(skillRoot, "assets"), { recursive: true });

    await writeFile(path.join(skillRoot, "scripts", "run.mjs"), "console.log('ok')", "utf8");
    await writeFile(path.join(skillRoot, "scripts", "nested", "validate.sh"), "echo ok", "utf8");
    await writeFile(path.join(skillRoot, "references", "guide.md"), "# guide", "utf8");
    await writeFile(path.join(skillRoot, "assets", "template.json"), '{"ok":true}', "utf8");

    const manifest = await inspectSkillResourceManifest(path.join(skillRoot, "SKILL.md"));

    expect(manifest.scripts.map((entry) => entry.path)).toEqual([
      "nested/validate.sh",
      "run.mjs",
    ]);
    expect(manifest.references.map((entry) => entry.path)).toEqual(["guide.md"]);
    expect(manifest.assets.map((entry) => entry.path)).toEqual(["template.json"]);
  });

  it("includes resources as an additional directory for references and assets", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await mkdir(path.join(skillRoot, "resources"), { recursive: true });

    await writeFile(path.join(skillRoot, "scripts", "run.mjs"), "console.log('ok')", "utf8");
    await writeFile(path.join(skillRoot, "resources", "guide.md"), "# guide", "utf8");
    await writeFile(path.join(skillRoot, "resources", "template.json"), '{"ok":true}', "utf8");

    const manifest = await inspectSkillResourceManifest(path.join(skillRoot, "SKILL.md"));

    expect(manifest.scripts.map((entry) => entry.path)).toEqual(["run.mjs"]);
    expect(manifest.references.map((entry) => entry.path)).toEqual(["guide.md", "template.json"]);
    expect(manifest.assets.map((entry) => entry.path)).toEqual(["guide.md", "template.json"]);
  });
});

describe("readSkillResourceText", () => {
  it("rejects path traversal", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await writeFile(path.join(skillRoot, "references", "guide.md"), "safe", "utf8");

    await expect(
      readSkillResourceText({
        skillRoot,
        kind: "references",
        relativePath: "../SKILL.md",
      }),
    ).rejects.toThrow("invalid segments");
  });

  it("reads text from references", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await writeFile(path.join(skillRoot, "references", "guide.md"), "line1\nline2", "utf8");

    const content = await readSkillResourceText({
      skillRoot,
      kind: "references",
      relativePath: "guide.md",
    });

    expect(content).toBe("line1\nline2");
  });

  it("accepts references-prefixed paths", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await writeFile(path.join(skillRoot, "references", "guide.md"), "line1\nline2", "utf8");

    const content = await readSkillResourceText({
      skillRoot,
      kind: "references",
      relativePath: "references/guide.md",
    });

    expect(content).toBe("line1\nline2");
  });

  it("reads references from resources directory when requested", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "resources"), { recursive: true });
    await writeFile(path.join(skillRoot, "resources", "guide.md"), "resource guide", "utf8");

    const content = await readSkillResourceText({
      skillRoot,
      kind: "references",
      relativePath: "resources/guide.md",
    });

    expect(content).toBe("resource guide");
  });

});

describe("readSkillResourceBuffer", () => {
  it("reads binary assets", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "assets"), { recursive: true });
    await writeFile(path.join(skillRoot, "assets", "bytes.bin"), Buffer.from([0, 1, 2, 3]));

    const buffer = await readSkillResourceBuffer({
      skillRoot,
      kind: "assets",
      relativePath: "bytes.bin",
    });

    expect([...buffer]).toEqual([0, 1, 2, 3]);
  });

  it("reads assets from resources directory when requested", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "resources"), { recursive: true });
    await writeFile(path.join(skillRoot, "resources", "bytes.bin"), Buffer.from([4, 5, 6, 7]));

    const buffer = await readSkillResourceBuffer({
      skillRoot,
      kind: "assets",
      relativePath: "resources/bytes.bin",
    });

    expect([...buffer]).toEqual([4, 5, 6, 7]);
  });

});

describe("runSkillScript", () => {
  it("executes a skill script and captures output", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(skillRoot, "scripts", "echo.mjs"),
      "process.stdout.write(process.argv.slice(2).join(','));",
      "utf8",
    );

    const result = await runSkillScript({
      skillRoot,
      relativePath: "echo.mjs",
      args: ["one", "two"],
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("one,two");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  it("accepts scripts-prefixed paths", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(skillRoot, "scripts", "echo.mjs"),
      "process.stdout.write(process.argv.slice(2).join(','));",
      "utf8",
    );

    const result = await runSkillScript({
      skillRoot,
      relativePath: "scripts/echo.mjs",
      args: ["one", "two"],
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("one,two");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  it("passes custom environment variables to scripts", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(skillRoot, "scripts", "print-env.py"),
      "import os\nprint(os.environ.get('VIRTUAL_ENV', ''))\n",
      "utf8",
    );

    const result = await runSkillScript({
      skillRoot,
      relativePath: "print-env.py",
      args: [],
      env: {
        VIRTUAL_ENV: "/tmp/local-playground/.venv",
      },
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("/tmp/local-playground/.venv");
    expect(result.stderr).toBe("");
    expect(result.timedOut).toBe(false);
  });

  it("captures environment changes made by shell scripts", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(skillRoot, "scripts", "activate.sh"),
      [
        'export VIRTUAL_ENV="$PWD/.venv"',
        'export PATH="$VIRTUAL_ENV/bin:$PATH"',
      ].join("\n"),
      "utf8",
    );

    const result = await runSkillScript({
      skillRoot,
      relativePath: "activate.sh",
      args: [],
      env: {
        PATH: "/usr/bin",
      },
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.environmentChanges.captured).toBe(true);
    expect(result.environmentChanges.updated.VIRTUAL_ENV ?? "").toMatch(/\/skills\/sample-skill\/\.venv$/);
    expect(result.environmentChanges.updated.PATH).toContain(
      `${skillRoot}/.venv/bin`,
    );
  });

  it("captures removed environment variables from shell scripts", async () => {
    const skillRoot = await createTempSkillRoot();
    await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
    await writeFile(
      path.join(skillRoot, "scripts", "unset-env.sh"),
      'unset TEST_ENV_TO_REMOVE\n',
      "utf8",
    );

    const result = await runSkillScript({
      skillRoot,
      relativePath: "unset-env.sh",
      args: [],
      env: {
        PATH: "/usr/bin",
        TEST_ENV_TO_REMOVE: "value",
      },
      timeoutMs: 2_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.environmentChanges.captured).toBe(true);
    expect(result.environmentChanges.removed).toContain("TEST_ENV_TO_REMOVE");
  });

  it.skipIf(process.platform !== "win32")(
    "captures environment changes made by Windows command scripts",
    async () => {
      const skillRoot = await createTempSkillRoot();
      await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
      await writeFile(
        path.join(skillRoot, "scripts", "activate.cmd"),
        [
          "@echo off",
          'set "VIRTUAL_ENV=%CD%\\.venv"',
          'set "PATH=%VIRTUAL_ENV%\\Scripts;%PATH%"',
          "set TEST_ENV_TO_REMOVE=",
        ].join("\r\n"),
        "utf8",
      );

      const result = await runSkillScript({
        skillRoot,
        relativePath: "activate.cmd",
        args: [],
        env: {
          PATH: "C:\\Windows\\System32",
          TEST_ENV_TO_REMOVE: "value",
        },
        timeoutMs: 2_000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.environmentChanges.captured).toBe(true);
      expect(result.environmentChanges.updated.VIRTUAL_ENV ?? "").toMatch(
        /[\\/]skills[\\/]sample-skill[\\/]\.venv$/,
      );
      expect(result.environmentChanges.updated.PATH).toContain(
        path.join(skillRoot, ".venv", "Scripts"),
      );
      expect(result.environmentChanges.removed).toContain("TEST_ENV_TO_REMOVE");
      expect(result.environmentChanges.updated).not.toHaveProperty(
        "LOCAL_PLAYGROUND_ENV_CAPTURE_FILE",
      );
    },
  );

  it.skipIf(!hasPowerShellRuntime)(
    "captures environment changes made by PowerShell scripts",
    async () => {
      const skillRoot = await createTempSkillRoot();
      await mkdir(path.join(skillRoot, "scripts"), { recursive: true });
      await writeFile(
        path.join(skillRoot, "scripts", "activate.ps1"),
        [
          '$env:VIRTUAL_ENV = Join-Path $PWD ".venv"',
          '$env:PATH = "$($env:VIRTUAL_ENV);$($env:PATH)"',
          "Remove-Item Env:TEST_ENV_TO_REMOVE -ErrorAction SilentlyContinue",
        ].join("\n"),
        "utf8",
      );

      const result = await runSkillScript({
        skillRoot,
        relativePath: "activate.ps1",
        args: [],
        env: {
          PATH: "/usr/bin",
          TEST_ENV_TO_REMOVE: "value",
        },
        timeoutMs: 2_000,
      });

      expect(result.exitCode).toBe(0);
      expect(result.environmentChanges.captured).toBe(true);
      expect(result.environmentChanges.updated.VIRTUAL_ENV ?? "").toMatch(
        /[\\/]skills[\\/]sample-skill[\\/]\.venv$/,
      );
      expect(result.environmentChanges.removed).toContain("TEST_ENV_TO_REMOVE");
      expect(result.environmentChanges.updated).not.toHaveProperty(
        "LOCAL_PLAYGROUND_ENV_CAPTURE_FILE",
      );
    },
  );
});

function canRunCommand(command: string): boolean {
  const result = spawnSync(command, ["-Version"], {
    stdio: "ignore",
    timeout: 5_000,
  });
  return !result.error;
}

async function createTempSkillRoot(): Promise<string> {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "skill-runtime-"));
  tempDirectories.push(workspaceRoot);

  const skillRoot = path.join(workspaceRoot, "skills", "sample-skill");
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      "name: sample-skill",
      "description: Sample skill",
      "---",
      "# Sample",
    ].join("\n"),
    "utf8",
  );

  return skillRoot;
}
