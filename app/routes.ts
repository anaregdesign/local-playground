/**
 * Route registry module.
 */
import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route(".well-known/*", "routes/well-known.ts"),
  route("mcp/.well-known/*", "routes/mcp.well-known.ts"),
  route("api/azure-projects", "routes/api.azure-connections.ts"),
  route(
    "api/azure-projects/:projectId/deployments",
    "routes/api.azure-project-deployments.ts",
  ),
  route("api/azure-selection", "routes/api.azure-selection.ts"),
  route("api/chat", "routes/api.chat.ts"),
  route("api/azure-session", "routes/api.azure-session.ts"),
  route("api/app-event-logs", "routes/api.app-event-logs.ts"),
  route("api/instruction-patches", "routes/api.instruction.ts"),
  route("api/threads/title-suggestions", "routes/api.thread-title.ts"),
  route("api/mcp-servers", "routes/api.mcp-servers.ts"),
  route("api/mcp-servers/:serverId", "routes/api.mcp-servers.$serverId.ts"),
  route("mcp", "routes/mcp.ts"),
  route("api/threads", "routes/api.threads.ts"),
  route("api/threads/:threadId", "routes/api.threads.$threadId.ts"),
  route("api/skills", "routes/api.skills.ts"),
  route(
    "api/skill-registries/:registryId/skills/*",
    "routes/api.skill-registries.$registryId.skills.$.ts",
  ),
] satisfies RouteConfig;
