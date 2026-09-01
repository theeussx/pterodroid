import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Versão/commit da documentação, lidos do Git na hora do build (responde ao
 * item C5 da auditoria: cada página deve indicar a que versão se refere).
 * Fora de um clone Git, cai gentilmente em fallbacks.
 */
function git(command: string): string {
  try {
    return execSync(command, { encoding: "utf8", cwd: path.resolve(__dirname, "../.."), stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
const DOCS_COMMIT = git("git rev-parse --short HEAD") || "main";
const DOCS_BRANCH = git("git rev-parse --abbrev-ref HEAD") || "main";
const DOCS_COMMIT_FULL = git("git rev-parse HEAD");
const DOCS_UPDATED_AT = git("git log -1 --format=%cs") || "";

// https://vite.dev/config/
export default defineConfig({
  // `vite-plugin-singlefile` força `base: "./"` por padrão, o que faz o Vite
  // reescrever URLs de assets do `public/` (ex.: o favicon) para caminhos
  // relativos. Como o site é servido na raiz do domínio (Vercel) e usa rotas
  // client-side como `/docs/...`, mantemos `base: "/"` para que os assets
  // resolvam de qualquer página.
  plugins: [react(), tailwindcss(), viteSingleFile({ overrideConfig: { base: '/' } })],
  define: {
    __DOCS_COMMIT__: JSON.stringify(DOCS_COMMIT),
    __DOCS_BRANCH__: JSON.stringify(DOCS_BRANCH),
    __DOCS_COMMIT_FULL__: JSON.stringify(DOCS_COMMIT_FULL),
    __DOCS_UPDATED_AT__: JSON.stringify(DOCS_UPDATED_AT),
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
