/**
 * Test module verifying runtime behavior.
 */
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
});

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
