/**
 * The API client shared by the web app and the native apps: transport, the
 * endpoint list, the socket, the react-query hooks over both, and the
 * formatters that turn API values into the strings a person reads.
 *
 * Nothing in here touches the DOM. Everything that genuinely differs between a
 * browser and a phone — where the API lives, how the session travels, sound
 * cues, what sign-out means — is declared once through {@link configureClient}.
 *
 * The point is that an endpoint change is made in one place. Two copies of this
 * would drift within a release.
 */
export * from "./config";
export * from "./api";
export * from "./socket";
export * from "./format";
export * from "./email";
export * from "./hooks";
