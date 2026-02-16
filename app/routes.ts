import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/azure-connections", "routes/api.azure-connections.ts"),
  route("api/chat", "routes/api.chat.ts"),
  route("api/azure-login", "routes/api.azure-login.ts"),
  route("api/azure-logout", "routes/api.azure-logout.ts"),
  route("api/mcp-servers", "routes/api.mcp-servers.ts"),
] satisfies RouteConfig;
