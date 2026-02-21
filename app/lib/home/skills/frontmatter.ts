import {
  AGENT_SKILL_DESCRIPTION_MAX_LENGTH,
  AGENT_SKILL_NAME_MAX_LENGTH,
  AGENT_SKILL_NAME_PATTERN,
} from "~/lib/constants";

export type SkillFrontmatter = {
  name: string;
  description: string;
};

export function parseSkillFrontmatter(content: string): SkillFrontmatter | null {
  const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length < 3 || lines[0]?.trim() !== "---") {
    return null;
  }

  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      closingIndex = index;
      break;
    }
  }

  if (closingIndex < 0) {
    return null;
  }

  const fields = parseFrontmatterLines(lines.slice(1, closingIndex));
  const name = normalizeSkillScalar(fields.name ?? "");
  const description = normalizeSkillScalar(fields.description ?? "");
  if (!name || !description) {
    return null;
  }

  return {
    name,
    description,
  };
}

export function validateSkillFrontmatter(
  frontmatter: SkillFrontmatter,
  expectedDirectoryName: string,
): string | null {
  const name = frontmatter.name.trim();
  const description = frontmatter.description.trim();
  const normalizedDirectoryName = expectedDirectoryName.trim();

  if (!name) {
    return "Skill frontmatter name is required.";
  }

  if (name.length > AGENT_SKILL_NAME_MAX_LENGTH) {
    return `Skill name must be ${AGENT_SKILL_NAME_MAX_LENGTH} characters or fewer.`;
  }

  if (!AGENT_SKILL_NAME_PATTERN.test(name)) {
    return "Skill name must use lower-case kebab-case.";
  }

  if (!description) {
    return "Skill description is required.";
  }

  if (description.length > AGENT_SKILL_DESCRIPTION_MAX_LENGTH) {
    return `Skill description must be ${AGENT_SKILL_DESCRIPTION_MAX_LENGTH} characters or fewer.`;
  }

  if (normalizedDirectoryName && normalizedDirectoryName !== name) {
    return `Skill directory name \"${normalizedDirectoryName}\" must match frontmatter name \"${name}\".`;
  }

  return null;
}

function parseFrontmatterLines(lines: string[]): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim() || line.trimStart().startsWith("#")) {
      index += 1;
      continue;
    }

    const keyMatch = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) {
      index += 1;
      continue;
    }

    const key = keyMatch[1] ?? "";
    const rawValue = keyMatch[2] ?? "";
    if (!key) {
      index += 1;
      continue;
    }

    if (/^[>|][+-]?$/.test(rawValue.trim())) {
      const blockRead = readBlockScalar(lines, index + 1);
      fields[key] = blockRead.value;
      index = blockRead.nextIndex;
      continue;
    }

    fields[key] = readInlineScalar(rawValue);
    index += 1;
  }

  return fields;
}

function readBlockScalar(
  lines: string[],
  startIndex: number,
): {
  value: string;
  nextIndex: number;
} {
  const blockLines: string[] = [];
  let index = startIndex;
  let indentSize = 0;

  for (let scanIndex = startIndex; scanIndex < lines.length; scanIndex += 1) {
    const scannedLine = lines[scanIndex] ?? "";
    if (!scannedLine.trim()) {
      continue;
    }

    const leadingSpaces = countLeadingSpaces(scannedLine);
    if (leadingSpaces > 0) {
      indentSize = leadingSpaces;
    }
    break;
  }

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (!line.trim()) {
      blockLines.push("");
      index += 1;
      continue;
    }

    const leadingSpaces = countLeadingSpaces(line);
    if (leadingSpaces === 0) {
      break;
    }

    const effectiveIndent = indentSize > 0 ? indentSize : 1;
    if (leadingSpaces < effectiveIndent) {
      break;
    }

    blockLines.push(line.slice(effectiveIndent));
    index += 1;
  }

  return {
    value: blockLines.join("\n").trim(),
    nextIndex: index,
  };
}

function readInlineScalar(rawValue: string): string {
  const value = rawValue.trim();
  if (!value) {
    return "";
  }

  if (value.startsWith("\"") && value.endsWith("\"") && value.length >= 2) {
    return value.slice(1, -1).replace(/\\\"/g, "\"").trim();
  }

  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
    return value.slice(1, -1).replace(/''/g, "'").trim();
  }

  const commentIndex = value.indexOf(" #");
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim();
}

function normalizeSkillScalar(value: string): string {
  return value.trim();
}

function countLeadingSpaces(value: string): number {
  const match = value.match(/^\s*/);
  return match?.[0]?.length ?? 0;
}
