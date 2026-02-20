import { useEffect, useMemo } from "react";
import { StatusMessageList, type StatusMessage } from "~/components/home/shared/StatusMessageList";

const DEFAULT_AUTO_DISMISS_MS = 5000;

type AutoDismissStatusMessage = StatusMessage & {
  onClear?: () => void;
  dismissAfterMs?: number;
};

type AutoDismissStatusMessageListProps = {
  className?: string;
  messages: AutoDismissStatusMessage[];
};

export function AutoDismissStatusMessageList(props: AutoDismissStatusMessageListProps) {
  const { className, messages } = props;

  const dismissibleMessages = useMemo(
    () =>
      messages
        .map((message, index) => ({
          index,
          intent: message.intent,
          text: (message.text ?? "").trim(),
          dismissAfterMs: message.dismissAfterMs ?? DEFAULT_AUTO_DISMISS_MS,
          onClear: message.onClear,
        }))
        .filter(
          (message) =>
            message.intent !== "error" &&
            message.text.length > 0 &&
            typeof message.onClear === "function",
        ),
    [messages],
  );

  const dismissibleSignature = dismissibleMessages
    .map((message) => `${message.index}:${message.intent}:${message.dismissAfterMs}:${message.text}`)
    .join("|");

  useEffect(() => {
    if (dismissibleMessages.length === 0) {
      return;
    }

    const timeoutIds = dismissibleMessages.map((message) =>
      window.setTimeout(() => {
        message.onClear?.();
      }, message.dismissAfterMs),
    );

    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [dismissibleSignature]);

  const normalizedMessages: StatusMessage[] = messages.map((message) => ({
    intent: message.intent,
    title: message.title,
    text: message.text,
  }));

  return <StatusMessageList className={className} messages={normalizedMessages} />;
}
