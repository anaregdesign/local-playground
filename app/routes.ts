/**
 * Route registry module.
 */
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/azure-connections", "routes/api.azure-connections.ts"),
  route("api/azure-selection", "routes/api.azure-selection.ts"),
  route("api/chat", "routes/api.chat.ts"),
  route("api/azure-login", "routes/api.azure-login.ts"),
  route("api/azure-logout", "routes/api.azure-logout.ts"),
  route("api/app-event-logs", "routes/api.app-event-logs.ts"),
  route("api/instruction", "routes/api.instruction.ts"),
  route("api/thread-title", "routes/api.thread-title.ts"),
  route("api/mcp-servers", "routes/api.mcp-servers.ts"),
  route("api/threads", "routes/api.threads.ts"),
  route("api/skills", "routes/api.skills.ts"),
] satisfies RouteConfig;
