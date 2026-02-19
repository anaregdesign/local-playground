import { FluentUI } from "~/components/home/fluent";
const { Button, MessageBar, MessageBarBody, Spinner } = FluentUI;

type AzureConnectionLike = {
  projectName: string;
  baseUrl: string;
  apiVersion: string;
};

type AzureConnectionSectionProps = {
  isAzureAuthRequired: boolean;
  isSending: boolean;
  isStartingAzureLogin: boolean;
  onAzureLogin: () => void | Promise<void>;
  isLoadingAzureConnections: boolean;
  isLoadingAzureDeployments: boolean;
  activeAzureConnection: AzureConnectionLike | null;
  selectedAzureDeploymentName: string;
  isStartingAzureLogout: boolean;
  onAzureLogout: () => void | Promise<void>;
  azureDeploymentError: string | null;
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
    selectedAzureDeploymentName,
    isStartingAzureLogout,
    onAzureLogout,
    azureDeploymentError,
    azureLogoutError,
    azureConnectionError,
  } = props;

  return (
    <section className="setting-group setting-group-azure-connection">
      <div className="setting-group-header">
        <h3>Azure Connection 🔐</h3>
        <p>Sign in/out for Playground access.</p>
      </div>
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
            <p className="azure-loading-notice" role="status" aria-live="polite">
              <Spinner size="tiny" />
              {isLoadingAzureConnections
                ? "Loading projects from Azure..."
                : "Loading deployments for the selected project..."}
            </p>
          ) : null}
          {activeAzureConnection ? (
            <dl className="azure-connection-summary" aria-label="Active Azure connection details">
              <div className="azure-connection-summary-row">
                <dt>Project</dt>
                <dd>{activeAzureConnection.projectName}</dd>
              </div>
              <div className="azure-connection-summary-row">
                <dt>Deployment</dt>
                <dd>{selectedAzureDeploymentName || "Not selected"}</dd>
              </div>
              <div className="azure-connection-summary-row">
                <dt>Endpoint</dt>
                <dd>{activeAzureConnection.baseUrl}</dd>
              </div>
              <div className="azure-connection-summary-row">
                <dt>API version</dt>
                <dd>{activeAzureConnection.apiVersion}</dd>
              </div>
            </dl>
          ) : (
            <p className="field-hint">No active Azure project.</p>
          )}
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
          {azureDeploymentError ? (
            <MessageBar intent="error" className="setting-message-bar">
              <MessageBarBody>{azureDeploymentError}</MessageBarBody>
            </MessageBar>
          ) : null}
          {azureLogoutError ? (
            <MessageBar intent="error" className="setting-message-bar">
              <MessageBarBody>{azureLogoutError}</MessageBarBody>
            </MessageBar>
          ) : null}
          {azureConnectionError ? (
            <MessageBar intent="error" className="setting-message-bar">
              <MessageBarBody>{azureConnectionError}</MessageBarBody>
            </MessageBar>
          ) : null}
        </>
      )}
    </section>
  );
}
