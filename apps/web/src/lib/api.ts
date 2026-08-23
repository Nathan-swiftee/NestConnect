/**
 * The API client lives in `@ding/client`, shared with the native apps so an
 * endpoint change is made once. This re-export keeps every existing
 * `from "../lib/api"` import working; the web's own configuration (same-origin
 * base URL, cookie session) is applied in `main.tsx`.
 */
export { api, type ApiError, type CreateUserResult, type MeResponse, type SidebarViews, type ViewItem } from "@ding/client";
