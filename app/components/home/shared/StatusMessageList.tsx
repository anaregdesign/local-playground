import type { ComponentProps } from "react";
import { FluentUI } from "~/components/home/shared/fluent";

const { MessageBar, MessageBarBody, MessageBarTitle } = FluentUI;

type StatusMessageIntent = NonNullable<ComponentProps<typeof MessageBar>["intent"]>;

type StatusMessage = {
  intent: StatusMessageIntent;
  text: string | null | undefined;
  title?: string;
};

type StatusMessageListProps = {
  className?: string;
  messages: StatusMessage[];
};

function buildClassName(...values: Array<string | undefined>): string {
  return values.filter((value) => value && value.trim().length > 0).join(" ");
}

export function StatusMessageList(props: StatusMessageListProps) {
  const { className, messages } = props;

  return (
    <div className={className}>
      {messages.map((message, index) => {
        if (!message.text) {
          return null;
        }

        return (
          <MessageBar key={`${message.intent}-${index}`} intent={message.intent} className="setting-message-bar">
            <MessageBarBody>
              {message.title ? <MessageBarTitle>{message.title}</MessageBarTitle> : null}
              {message.text}
            </MessageBarBody>
          </MessageBar>
        );
      })}
    </div>
  );
}
