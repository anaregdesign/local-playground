import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import "./styles.css";

type DesktopServerStatus = {
  phase: "starting" | "running" | "error";
  message: string;
  url?: string;
};

function DesktopShell() {
  const [status, setStatus] = useState<DesktopServerStatus>({
    phase: "starting",
    message: "Connecting to local backend...",
  });

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;

    const desktopApi = window.desktopApi;
    if (!desktopApi) {
      setStatus({
        phase: "error",
        message: "Desktop bridge is unavailable. Open this app from Electron.",
      });
      return;
    }

    void desktopApi
      .getServerStatus()
      .then((next) => {
        if (!active) {
          return;
        }
        setStatus(normalizeStatus(next));
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setStatus({
          phase: "error",
          message: `Failed to get server status: ${readErrorMessage(error)}`,
        });
      });

    unsubscribe = desktopApi.onServerStatus((next) => {
      if (!active) {
        return;
      }
      setStatus(normalizeStatus(next));
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const backendUrl = status.url?.trim() || "";
  const isRunning = status.phase === "running" && backendUrl.length > 0;

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Local Playground Desktop</Text>
          <Text style={styles.subtitle}>React Native Desktop Shell (macOS / Windows / Linux)</Text>
        </View>
        <View
          style={[
            styles.statusBadge,
            status.phase === "running"
              ? styles.statusRunning
              : status.phase === "error"
                ? styles.statusError
                : styles.statusStarting,
          ]}
        >
          {status.phase === "starting" ? <ActivityIndicator size="small" color="#244b65" /> : null}
          <Text style={styles.statusText}>{status.phase.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.statusPanel}>
        <Text style={styles.statusMessage}>{status.message}</Text>
        {backendUrl ? <Text style={styles.statusUrl}>{backendUrl}</Text> : null}
      </View>

      {isRunning ? (
        <View style={styles.frameWrap}>
          <iframe
            key={backendUrl}
            className="desktop-playground-frame"
            title="Local Playground"
            src={backendUrl}
          />
        </View>
      ) : (
        <ScrollView style={styles.helpPanel} contentContainerStyle={styles.helpPanelContent}>
          <Text style={styles.helpTitle}>How to run</Text>
          <Text style={styles.helpItem}>1. Run `npm run desktop:dev` for development mode.</Text>
          <Text style={styles.helpItem}>2. Or run `npm run desktop:start` for built mode.</Text>
          <Text style={styles.helpItem}>
            3. Ensure Azure sign-in is available (`az login`) before using chat.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              if (!backendUrl) {
                return;
              }

              window.open(backendUrl, "_blank", "noopener,noreferrer");
            }}
            style={({ pressed }) => [styles.openButton, pressed ? styles.openButtonPressed : null]}
          >
            <Text style={styles.openButtonText}>Open backend URL in browser</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

function normalizeStatus(value: DesktopServerStatus): DesktopServerStatus {
  if (!value || typeof value !== "object") {
    return {
      phase: "error",
      message: "Invalid desktop status payload.",
    };
  }

  const phase =
    value.phase === "running" || value.phase === "error" || value.phase === "starting"
      ? value.phase
      : "error";
  const message = typeof value.message === "string" ? value.message : "Unknown desktop status.";
  const url = typeof value.url === "string" ? value.url : undefined;

  return {
    phase,
    message,
    url,
  };
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    minHeight: "100%",
    padding: 16,
    backgroundColor: "#f3f5f7",
    gap: 12,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#1f2b36",
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: "#5d6b76",
  },
  statusBadge: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
  },
  statusRunning: {
    borderColor: "#4b8f3f",
    backgroundColor: "#eef7ed",
  },
  statusStarting: {
    borderColor: "#7fa6c3",
    backgroundColor: "#eaf2f9",
  },
  statusError: {
    borderColor: "#b3484f",
    backgroundColor: "#fff0f1",
  },
  statusText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#244b65",
  },
  statusPanel: {
    borderWidth: 1,
    borderColor: "#cfd7df",
    borderRadius: 10,
    backgroundColor: "#ffffff",
    padding: 12,
    gap: 4,
  },
  statusMessage: {
    fontSize: 14,
    color: "#2f3b45",
  },
  statusUrl: {
    fontSize: 12,
    color: "#6b7a88",
  },
  frameWrap: {
    flex: 1,
    minHeight: 0,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#cfd7df",
    overflow: "hidden",
    backgroundColor: "#ffffff",
  },
  helpPanel: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#cfd7df",
    borderRadius: 12,
    backgroundColor: "#ffffff",
  },
  helpPanelContent: {
    padding: 12,
    gap: 10,
  },
  helpTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1f2b36",
  },
  helpItem: {
    fontSize: 14,
    color: "#2f3b45",
    lineHeight: 20,
  },
  openButton: {
    marginTop: 8,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: "#89a7bf",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "#edf4fa",
  },
  openButtonPressed: {
    opacity: 0.8,
  },
  openButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#244b65",
  },
});

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Desktop renderer root element is missing.");
}
createRoot(rootElement).render(<DesktopShell />);
