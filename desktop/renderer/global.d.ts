export {};

declare global {
  type DesktopServerStatus = {
    phase: "starting" | "running" | "error";
    message: string;
    url?: string;
  };

  interface Window {
    desktopApi?: {
      getServerStatus: () => Promise<DesktopServerStatus>;
      onServerStatus: (listener: (status: DesktopServerStatus) => void) => () => void;
    };
  }
}
