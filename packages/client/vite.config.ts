import { defineConfig } from "vite";

// host: true exposes the client dev server on the LAN, mirroring the server's
// LAN accessibility (SPEC.md §10). No proxying needed in Phase 0 — the client
// is standalone until the Colyseus connection lands in Phase 1.
export default defineConfig({
  server: {
    host: true,
    port: 5173,
  },
});
