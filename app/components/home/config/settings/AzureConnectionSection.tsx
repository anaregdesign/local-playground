/**
 * Home UI component module.
 */
import { FluentUI } from "~/components/home/shared/fluent";
import { ConfigSection } from "~/components/home/shared/ConfigSection";
import { StatusMessageList } from "~/components/home/shared/StatusMessageList";

const { Button, Spinner } = FluentUI;

type AzureConnectionLike = {
  projectName: string;
  baseUrl: string;
  apiVersion: string;
};

type AzurePrincipalLike = {
  tenantId: string;
  principalId: string;
  displayName: string;
  principalName: string;
  principalType: "user" | "servicePrincipal" | "managedIdentity" | "unknown";
};

type AzureConnectionSectionProps = {
  isAzureAuthRequired: boolean;
  isSending: boolean;
  isStartingAzureLogin: boolean;
  onAzureLogin: () => void | Promise<void>;
  isLoadingAzureConnections: boolean;
  isLoadingAzureDeployments: boolean;
  activeAzureConnection: AzureConnectionLike | null;
  activeAzurePrincipal: AzurePrincipalLike | null;
  selectedPlaygroundAzureDeploymentName: string;
  isStartingAzureLogout: boolean;
  onAzureLogout: () => void | Promise<void>;
  azureLogoutError: string | null;
  azureConnectionError: string | null;
};

export function AzureConnectionSection(props: AzureConnectionSectionProps) {
  const {
    isAzureAuthRequired,
    isSending,
    isStartingAzureLogin,
    onAzureLogin,
    isLoadingAzureConnections,
    isLoadingAzureDeployments,
    activeAzureConnection,
    activeAzurePrincipal,
    selectedPlaygroundAzureDeploymentName,
    isStartingAzureLogout,
    onAzureLogout,
    azureLogoutError,
    azureConnectionError,
  } = props;

  return (
    <ConfigSection
      className="setting-group-azure-connection"
      title="Azure Connection 🔐"
      description="Sign in/out and review the active Playground model."
    >
      {isAzureAuthRequired ? (
        <Button
          type="button"
          appearance="primary"
          className="azure-login-btn"
          title="Start Azure login in your browser."
          onClick={() => {
            void onAzureLogin();
          }}
          disabled={isSending || isStartingAzureLogin}
        >
          {isStartingAzureLogin ? "🔐 Starting Azure Login..." : "🔐 Azure Login"}
        </Button>
      ) : (
        <>
          {isLoadingAzureConnections || isLoadingAzureDeployments ? (
            <div className="azure-loading-notice" role="status" aria-live="polite">
              <Spinner size="tiny" />
              {isLoadingAzureConnections
                ? "Loading projects from Azure..."
                : "Loading deployments for the selected project..."}
            </div>
          ) : null}
          {activeAzureConnection || activeAzurePrincipal ? (
            <dl className="azure-connection-summary" aria-label="Active Azure connection details">
              {activeAzurePrincipal ? (
                <>
                  <div className="azure-connection-summary-row">
                    <dt>Principal</dt>
                    <dd>{activeAzurePrincipal.displayName || activeAzurePrincipal.principalId}</dd>
                  </div>
                  {activeAzurePrincipal.principalName ? (
                    <div className="azure-connection-summary-row">
                      <dt>Principal name</dt>
                      <dd>{activeAzurePrincipal.principalName}</dd>
                    </div>
                  ) : null}
                  <div className="azure-connection-summary-row">
                    <dt>Principal type</dt>
                    <dd>{formatPrincipalTypeLabel(activeAzurePrincipal.principalType)}</dd>
                  </div>
                  <div className="azure-connection-summary-row">
                    <dt>Tenant ID</dt>
                    <dd>{activeAzurePrincipal.tenantId}</dd>
                  </div>
                  <div className="azure-connection-summary-row">
                    <dt>Principal ID</dt>
                    <dd>{activeAzurePrincipal.principalId}</dd>
                  </div>
                </>
              ) : null}
              <div className="azure-connection-summary-row">
                <dt>Playground project</dt>
                <dd>{activeAzureConnection?.projectName ?? "Not selected"}</dd>
              </div>
              <div className="azure-connection-summary-row">
                <dt>Playground deployment</dt>
                <dd>{selectedPlaygroundAzureDeploymentName || "Not selected"}</dd>
              </div>
              <div className="azure-connection-summary-row">
                <dt>Endpoint</dt>
                <dd>{activeAzureConnection?.baseUrl ?? "Not selected"}</dd>
              </div>
              <div className="azure-connection-summary-row">
                <dt>API version</dt>
                <dd>{activeAzureConnection?.apiVersion ?? "Not selected"}</dd>
              </div>
            </dl>
          ) : (
            <p className="field-hint">No active Azure project.</p>
          )}
          {activeAzureConnection || activeAzurePrincipal ? (
            <div className="azure-connection-actions">
              <Button
                type="button"
                appearance="outline"
                className="azure-logout-btn"
                title="Sign out from Azure for this app."
                onClick={() => {
                  void onAzureLogout();
                }}
                disabled={isSending || isLoadingAzureConnections || isStartingAzureLogout}
              >
                {isStartingAzureLogout ? "🚪 Logging Out..." : "🚪 Logout"}
              </Button>
            </div>
          ) : null}
          <StatusMessageList
            messages={[
              { intent: "error", text: azureLogoutError },
              { intent: "error", text: azureConnectionError },
            ]}
          />
        </>
      )}
    </ConfigSection>
  );
}

function formatPrincipalTypeLabel(
  principalType: AzurePrincipalLike["principalType"],
): string {
  if (principalType === "servicePrincipal") {
    return "Service principal";
  }
  if (principalType === "managedIdentity") {
    return "Managed identity";
  }
  if (principalType === "user") {
    return "User";
  }
  return "Unknown";
}
