/**
 * Home UI component module.
 */
import * as FluentUIComponents from "@fluentui/react-components";

export function resolveFluentUIExports<T extends object>(moduleExports: T): T {
  const maybeDefault = Reflect.get(moduleExports, "default");
  if (maybeDefault && typeof maybeDefault === "object") {
    return maybeDefault as T;
  }

  return moduleExports;
}

export const FluentUI = resolveFluentUIExports(FluentUIComponents);
