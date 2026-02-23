/**
 * Home UI component module.
 */
import { FluentUI } from "~/components/home/shared/fluent";

const { Button } = FluentUI;

type UnauthenticatedPanelProps = {
  isStartingAzureLogin: boolean;
  onAzureLogin: () => void | Promise<void>;
};

export function UnauthenticatedPanel(props: UnauthenticatedPanelProps) {
  const { isStartingAzureLogin, onAzureLogin } = props;

  return (
    <section className="unauth-panel" aria-label="Azure sign-in required">
      <header className="chat-header unauth-panel-header">
        <div className="chat-header-row">
          <div className="chat-header-main">
            <div className="chat-header-title">
              <img className="chat-header-symbol" src="/foundry-symbol.svg" alt="" aria-hidden="true" />
              <h1>Local Playground</h1>
            </div>
          </div>
        </div>
      </header>

      <div className="unauth-panel-body">
        <Button
          type="button"
          appearance="primary"
          className="unauth-login-btn"
          title="Start Azure login in your browser."
          onClick={() => {
            void onAzureLogin();
          }}
          disabled={isStartingAzureLogin}
        >
          {isStartingAzureLogin ? "Starting Azure Login..." : "Azure Login"}
        </Button>
      </div>
    </section>
  );
}
