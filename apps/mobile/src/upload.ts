import { Platform } from "react-native";
import type { UploadFile } from "@ding/client";

/**
 * A local file, in whichever shape this platform's `FormData` can actually post.
 *
 * The two runtimes this app builds for disagree, and the disagreement is total:
 *
 *  - React Native's `FormData` takes `{ uri, name, type }` and streams the file
 *    off disk. Hand it a `Blob` and the native networking layer refuses the
 *    whole request with "Unsupported form data part".
 *  - A browser's `FormData` takes a `Blob` or `File`. Hand it `{ uri, name,
 *    type }` and it stringifies the object to "[object Object]", posts a text
 *    field, and the server answers "No file uploaded".
 *
 * Both failures have been shipped. The second one lived in the web export for
 * as long as voice notes existed; the first was a fix for it that tested
 * `typeof document` inside the shared client — and `document` is defined in
 * this app's native runtime, so every upload on a real phone took the browser
 * branch and died. Attachments and voice notes, both gone.
 *
 * So the test is `Platform.OS`, and it lives here rather than in the shared
 * client, because this is the only module in the stack that is entitled to know
 * which runtime it is. `@ding/client` can't import react-native, and it
 * shouldn't be guessing.
 */
export async function uploadable(
  uri: string,
  name: string,
  type: string,
): Promise<UploadFile | File> {
  if (Platform.OS !== "web") return { uri, name, type };
  // The web export: `uri` is a blob:/data: URL the browser can fetch back.
  const blob = await (await fetch(uri)).blob();
  return new File([blob], name, { type: blob.type || type });
}
