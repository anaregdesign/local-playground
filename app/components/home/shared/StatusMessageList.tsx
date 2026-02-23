/**
 * Home UI component module.
 */
import type { ComponentProps } from "react";
import { CopyIconButton } from "~/components/home/shared/CopyIconButton";
import { FluentUI } from "~/components/home/shared/fluent";
import { copyTextToClipboard } from "~/lib/home/shared/clipboard";

const { MessageBar, MessageBarBody, MessageBarTitle } = FluentUI;

type StatusMessageIntent = NonNullable<ComponentProps<typeof MessageBar>["intent"]>;

export type StatusMessage = {
  intent: StatusMessageIntent;
  text: string | null | undefined;
  title?: string;
};

type StatusMessageListProps = {
  className?: string;
  messages: StatusMessage[];
};

export function StatusMessageList(props: StatusMessageListProps) {
  const { className, messages } = props;

  const handleCopyMessage = (message: StatusMessage) => {
    const parts = [message.title, message.text]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value));
    const text = parts.join("\n");
    if (!text) {
      return;
    }

    void copyTextToClipboard(text).catch(() => {
      /* no-op */
    });
  };

  return (
    <div className={className}>
      {messages.map((message, index) => {
        if (!message.text) {
          return null;
        }

        return (
          <MessageBar key={`${message.intent}-${index}`} intent={message.intent} className="setting-message-bar">
            <MessageBarBody className="status-message-body">
              <div className="status-message-main">
                {message.title ? <MessageBarTitle>{message.title}</MessageBarTitle> : null}
                <span className="status-message-text">{message.text}</span>
              </div>
              <CopyIconButton
                ariaLabel={message.title ? `${message.title} message copy` : "Message copy"}
                title={message.title ? `${message.title} message copy` : "Copy message"}
                className="status-message-copy-btn"
                onClick={() => {
                  handleCopyMessage(message);
                }}
              />
            </MessageBarBody>
          </MessageBar>
        );
      })}
    </div>
  );
}
