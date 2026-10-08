import type { ServeStaticModuleOptions } from "@nestjs/serve-static";

/**
 * How the API serves the built web app in production.
 *
 * Kept apart from AppModule (and free of Nest DI) so tools/check-privacy-route.ts
 * can mount exactly these options on a bare Express app and prove the public
 * pages resolve — the behaviour nobody sees locally, because Vite's dev server
 * does its own thing.
 *
 * `extensions: ["html"]` is what makes `/privacy` serve `privacy.html` (the
 * public privacy policy, its own Vite entry) instead of falling through to the
 * SPA's index.html, where the inbox would put it behind the login screen. It
 * runs inside express.static, so it only ever matches a file that exists in
 * the build; every other path still falls back to index.html as before.
 */
export function webStaticOptions(rootPath: string): ServeStaticModuleOptions {
  return {
    rootPath,
    exclude: ["/api/(.*)", "/health", "/health/(.*)", "/socket.io/(.*)"],
    serveStaticOptions: { extensions: ["html"] },
  };
}
