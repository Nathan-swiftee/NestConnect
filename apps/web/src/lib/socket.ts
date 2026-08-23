/** The socket moved to `@ding/client`; it authenticates from the configuration
 *  applied in `main.tsx` (cookie here, bearer token on native). */
export { getSocket, resetSocket, type DingSocket } from "@ding/client";
