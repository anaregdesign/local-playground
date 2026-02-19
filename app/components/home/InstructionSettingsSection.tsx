import type { ChangeEvent, RefObject } from "react";
import * as FluentUIComponents from "@fluentui/react-components";

function resolveFluentUIExports<T extends object>(moduleExports: T): T {
  const maybeDefault = Reflect.get(moduleExports, "default");
  if (maybeDefault && typeof maybeDefault === "object") {
    return maybeDefault as T;
  }

  return moduleExports;
}

const FluentUI = resolveFluentUIExports(FluentUIComponents);
const { Button, MessageBar, MessageBarBody, Spinner, Textarea } = FluentUI;

type InstructionDiffLineType = "context" | "added" | "removed";
type InstructionLanguageLike = "japanese" | "english" | "mixed" | "unknown";

type InstructionDiffLine = {
  type: InstructionDiffLineType;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  content: string;
};

type InstructionEnhanceComparisonLike = {
  extension: string;
  language: InstructionLanguageLike;
  diffLines: InstructionDiffLine[];
};

type InstructionSettingsSectionProps = {
  agentInstruction: string;
  instructionEnhanceComparison: InstructionEnhanceComparisonLike | null;
  describeInstructionLanguage: (language: InstructionLanguageLike) => string;
  isSending: boolean;
  isEnhancingInstruction: boolean;
  isSavingInstructionPrompt: boolean;
  canSaveAgentInstructionPrompt: boolean;
  canEnhanceAgentInstruction: boolean;
  canClearAgentInstruction: boolean;
  loadedInstructionFileName: string | null;
  instructionFileInputRef: RefObject<HTMLInputElement | null>;
  instructionFileError: string | null;
  instructionSaveError: string | null;
  instructionSaveSuccess: string | null;
  instructionEnhanceError: string | null;
  instructionEnhanceSuccess: string | null;
  onAgentInstructionChange: (value: string) => void;
  onInstructionFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onSaveInstructionPrompt: () => void | Promise<void>;
  onEnhanceInstruction: () => void | Promise<void>;
  onClearInstruction: () => void;
  onAdoptEnhancedInstruction: () => void;
  onAdoptOriginalInstruction: () => void;
};

export function InstructionSettingsSection(props: InstructionSettingsSectionProps) {
  const {
    agentInstruction,
    instructionEnhanceComparison,
    describeInstructionLanguage,
    isSending,
    isEnhancingInstruction,
    isSavingInstructionPrompt,
    canSaveAgentInstructionPrompt,
    canEnhanceAgentInstruction,
    canClearAgentInstruction,
    loadedInstructionFileName,
    instructionFileInputRef,
    instructionFileError,
    instructionSaveError,
    instructionSaveSuccess,
    instructionEnhanceError,
    instructionEnhanceSuccess,
    onAgentInstructionChange,
    onInstructionFileChange,
    onSaveInstructionPrompt,
    onEnhanceInstruction,
    onClearInstruction,
    onAdoptEnhancedInstruction,
    onAdoptOriginalInstruction,
  } = props;

  return (
    <section className="setting-group setting-group-agent-instruction">
      <div className="setting-group-header">
        <h3>Agent Instruction 🧾</h3>
        <p>System instruction used for the agent.</p>
      </div>
      {instructionEnhanceComparison ? (
        <section className="instruction-diff-panel" aria-label="Instruction diff review">
          <div className="instruction-diff-header">
            <p className="instruction-diff-title">🔀 Enhanced Diff Preview</p>
            <div className="instruction-diff-actions">
              <Button
                type="button"
                appearance="primary"
                size="small"
                title="Use the enhanced instruction text."
                onClick={onAdoptEnhancedInstruction}
                disabled={isSending || isEnhancingInstruction}
              >
                ✅ Adopt Enhanced
              </Button>
              <Button
                type="button"
                appearance="secondary"
                size="small"
                title="Keep the original instruction text."
                onClick={onAdoptOriginalInstruction}
                disabled={isSending || isEnhancingInstruction}
              >
                ↩️ Keep Original
              </Button>
            </div>
          </div>
          <p className="instruction-diff-meta">
            Format: .{instructionEnhanceComparison.extension} | Language:{" "}
            {describeInstructionLanguage(instructionEnhanceComparison.language)}
          </p>
          <div className="instruction-diff-table" role="table" aria-label="Instruction diff">
            {instructionEnhanceComparison.diffLines.map((line, index) => (
              <div
                key={`instruction-diff-${index}-${line.oldLineNumber ?? "n"}-${line.newLineNumber ?? "n"}`}
                className={`instruction-diff-row ${line.type}`}
                role="row"
              >
                <span className="instruction-diff-line-number old" aria-hidden="true">
                  {line.oldLineNumber ?? ""}
                </span>
                <span className="instruction-diff-line-number new" aria-hidden="true">
                  {line.newLineNumber ?? ""}
                </span>
                <span className={`instruction-diff-sign ${line.type}`} aria-hidden="true">
                  {line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
                </span>
                <code className="instruction-diff-content">{line.content.length > 0 ? line.content : " "}</code>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <>
          <Textarea
            id="agent-instruction"
            rows={6}
            title="System instruction text sent to the agent."
            value={agentInstruction}
            onChange={(_, data) => {
              onAgentInstructionChange(data.value);
            }}
            disabled={isSending || isEnhancingInstruction}
            placeholder="System instruction for the agent"
          />
          {isEnhancingInstruction ? (
            <div className="instruction-enhancing-state" role="status" aria-live="polite">
              <div className="instruction-enhancing-head">
                <Spinner size="tiny" />
                <span>Enhancing instruction with the selected Azure model...</span>
              </div>
              <div className="instruction-enhancing-track" aria-hidden="true">
                <span className="instruction-enhancing-bar" />
              </div>
            </div>
          ) : null}
          <div className="file-picker-row">
            <input
              id="agent-instruction-file"
              ref={instructionFileInputRef}
              className="file-input-hidden"
              type="file"
              accept=".md,.txt,.xml,.json,text/plain,text/markdown,application/json,application/xml,text/xml"
              onChange={(event) => {
                void onInstructionFileChange(event);
              }}
              disabled={isSending || isEnhancingInstruction}
            />
            <Button
              type="button"
              appearance="secondary"
              size="small"
              title="Load instruction content from a local file."
              onClick={() => instructionFileInputRef.current?.click()}
              disabled={isSending || isEnhancingInstruction}
            >
              📂 Load File
            </Button>
            <Button
              type="button"
              appearance="secondary"
              size="small"
              title="Save current instruction to a local file."
              onClick={() => {
                void onSaveInstructionPrompt();
              }}
              disabled={
                isSending ||
                isSavingInstructionPrompt ||
                isEnhancingInstruction ||
                !canSaveAgentInstructionPrompt
              }
            >
              {isSavingInstructionPrompt ? "💾 Saving..." : "💾 Save"}
            </Button>
            <Button
              type="button"
              appearance="primary"
              size="small"
              title="Enhance the instruction using the selected Azure model."
              onClick={() => {
                void onEnhanceInstruction();
              }}
              disabled={isSending || isEnhancingInstruction || !canEnhanceAgentInstruction}
            >
              {isEnhancingInstruction ? "✨ Enhancing..." : "✨ Enhance"}
            </Button>
            <Button
              type="button"
              appearance="secondary"
              size="small"
              title="Clear instruction text and related form values."
              onClick={onClearInstruction}
              disabled={isSending || isEnhancingInstruction || !canClearAgentInstruction}
            >
              🧹 Clear
            </Button>
            <span className="file-picker-name">{loadedInstructionFileName ?? "No file loaded"}</span>
          </div>
          <p className="field-hint">
            Supported: .md, .txt, .xml, .json (max 1MB). Click Save to choose file name and destination.
          </p>
        </>
      )}
      {instructionFileError ? (
        <MessageBar intent="error" className="setting-message-bar">
          <MessageBarBody>{instructionFileError}</MessageBarBody>
        </MessageBar>
      ) : null}
      {instructionSaveError ? (
        <MessageBar intent="error" className="setting-message-bar">
          <MessageBarBody>{instructionSaveError}</MessageBarBody>
        </MessageBar>
      ) : null}
      {instructionSaveSuccess ? (
        <MessageBar intent="success" className="setting-message-bar">
          <MessageBarBody>{instructionSaveSuccess}</MessageBarBody>
        </MessageBar>
      ) : null}
      {instructionEnhanceError ? (
        <MessageBar intent="error" className="setting-message-bar">
          <MessageBarBody>{instructionEnhanceError}</MessageBarBody>
        </MessageBar>
      ) : null}
      {instructionEnhanceSuccess ? (
        <MessageBar intent="success" className="setting-message-bar">
          <MessageBarBody>{instructionEnhanceSuccess}</MessageBarBody>
        </MessageBar>
      ) : null}
    </section>
  );
}
