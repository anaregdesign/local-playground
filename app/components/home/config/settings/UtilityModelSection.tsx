/**
 * Home UI component module.
 */
import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";
import type { ReasoningEffort } from "~/lib/home/shared/view-types";

const { Select, Spinner } = FluentUI;

type AzureConnectionLike = {
  id: string;
  projectName: string;
};

type UtilityModelSectionProps = {
  isAzureAuthRequired: boolean;
  isSending: boolean;
  isLoadingAzureConnections: boolean;
  isLoadingUtilityAzureDeployments: boolean;
  azureConnections: AzureConnectionLike[];
  selectedUtilityAzureConnectionId: string;
  selectedUtilityAzureDeploymentName: string;
  utilityAzureDeployments: string[];
  utilityReasoningEffort: ReasoningEffort;
  utilityReasoningEffortOptions: ReasoningEffort[];
  utilityAzureDeploymentError: string | null;
  onUtilityProjectChange: (projectId: string) => void;
  onUtilityDeploymentChange: (deploymentName: string) => void;
  onUtilityReasoningEffortChange: (value: ReasoningEffort) => void;
};

export function UtilityModelSection(props: UtilityModelSectionProps) {
  const {
    isAzureAuthRequired,
    isSending,
    isLoadingAzureConnections,
    isLoadingUtilityAzureDeployments,
    azureConnections,
    selectedUtilityAzureConnectionId,
    selectedUtilityAzureDeploymentName,
    utilityAzureDeployments,
    utilityReasoningEffort,
    utilityReasoningEffortOptions,
    utilityAzureDeploymentError,
    onUtilityProjectChange,
    onUtilityDeploymentChange,
    onUtilityReasoningEffortChange,
  } = props;

  return (
    <ConfigSection
      className="setting-group-utility-model"
      title="Utility Model 🧰"
      description="Used for instruction enhancement and utility workflows."
    >
      {isAzureAuthRequired ? (
        <p className="field-hint">Sign in from Azure Connection to configure Utility Model.</p>
      ) : (
        <>
          {isLoadingAzureConnections || isLoadingUtilityAzureDeployments ? (
            <p className="azure-loading-notice" role="status" aria-live="polite">
              <Spinner size="tiny" />
              {isLoadingAzureConnections
                ? "Loading projects from Azure..."
                : "Loading Utility deployment options..."}
            </p>
          ) : null}
          <label className="input-label" htmlFor="utility-model-project">
            Utility Project
          </label>
          <Select
            id="utility-model-project"
            value={selectedUtilityAzureConnectionId}
            onChange={(_, data) => {
              onUtilityProjectChange(data.value);
            }}
            disabled={isSending || isLoadingAzureConnections || azureConnections.length === 0}
            title="Select the Azure project used by Utility Model."
          >
            {azureConnections.length > 0 ? null : (
              <option value="">No Azure projects available</option>
            )}
            {azureConnections.map((connection) => (
              <option key={connection.id} value={connection.id}>
                {connection.projectName}
              </option>
            ))}
          </Select>
          <label className="input-label" htmlFor="utility-model-deployment">
            Utility Deployment
          </label>
          <Select
            id="utility-model-deployment"
            value={selectedUtilityAzureDeploymentName}
            onChange={(_, data) => {
              onUtilityDeploymentChange(data.value);
            }}
            disabled={
              isSending ||
              isLoadingAzureConnections ||
              isLoadingUtilityAzureDeployments ||
              !selectedUtilityAzureConnectionId
            }
            title="Select the Azure deployment used by Utility Model."
          >
            {utilityAzureDeployments.length > 0 ? null : (
              <option value="">No deployments available</option>
            )}
            {utilityAzureDeployments.map((deploymentName) => (
              <option key={deploymentName} value={deploymentName}>
                {deploymentName}
              </option>
            ))}
          </Select>
          <StatusMessageList
            messages={[
              {
                intent: "error",
                text: utilityAzureDeploymentError,
              },
            ]}
          />
          <label className="input-label" htmlFor="utility-model-reasoning-effort">
            Utility Reasoning Effort
          </label>
          <Select
            id="utility-model-reasoning-effort"
            value={utilityReasoningEffort}
            onChange={(_, data) => {
              if (
                data.value === "none" ||
                data.value === "low" ||
                data.value === "medium" ||
                data.value === "high"
              ) {
                onUtilityReasoningEffortChange(data.value);
              }
            }}
            disabled={isSending || isLoadingAzureConnections}
            title="Select reasoning effort for Utility Model runs."
          >
            {utilityReasoningEffortOptions.map((effort) => (
              <option key={effort} value={effort}>
                {formatReasoningEffortLabel(effort)}
              </option>
            ))}
          </Select>
        </>
      )}
    </ConfigSection>
  );
}

function formatReasoningEffortLabel(value: ReasoningEffort): string {
  if (value === "none") {
    return "None";
  }
  if (value === "low") {
    return "Low";
  }
  if (value === "medium") {
    return "Medium";
  }
  return "High";
}
