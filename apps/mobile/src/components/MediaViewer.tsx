import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, Text, View } from "react-native";
import { useVideoPlayer, VideoView } from "expo-video";
import type { Attachment } from "@ding/schemas";
import { formatBytes } from "@ding/client";
import { mediaSource } from "../api-config";
import { DownloadIcon, XIcon } from "../icons";
import { useInsets } from "../insets";
import { useThemeVars } from "../theme";
import { saveAttachment } from "../attachment-open";
import { useToast } from "./Toast";

/**
 * A photo or a video, full screen.
 *
 * Tapping one used to call `Linking.openURL` on the media endpoint — which is
 * behind the session guard, and a URL handed to the OS carries no session. The
 * phone opened a browser, the browser got a 401, and the user got a blank page.
 * That was "opening photos and videos doesn't work".
 *
 * So nothing leaves the app. `mediaSource` attaches the bearer token as a
 * header, `<Image>` and `expo-video` both accept headers on a remote source,
 * and the file is fetched by the app that already has the credentials. The one
 * thing that does still go out to the system — Share, which needs a real file —
 * downloads it here first, with the header, and hands over the local copy.
 */
export function MediaViewer({
  attachment,
  onClose,
}: {
  attachment: Attachment;
  onClose: () => void;
}) {
  const themeVars = useThemeVars();
  const insets = useInsets();
  const toast = useToast();
  const [saving, setSaving] = useState(false);

  const isVideo = attachment.kind === "video";
  // Null for a still: the hook has to run either way, and a player with no
  // source costs nothing.
  const player = useVideoPlayer(isVideo ? mediaSource(attachment.url) : null, (p) => {
    p.loop = false;
    p.play();
  });

  async function share() {
    if (saving) return;
    setSaving(true);
    const err = await saveAttachment(attachment);
    setSaving(false);
    if (err) toast({ text: err, tone: "error" });
  }

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* Black regardless of the app's theme — a photo viewer's ground is not a
          surface colour, it's the absence of one. The palette variables still
          have to be republished for the chrome on top of it: a Modal renders
          outside the tree that publishes them. */}
      <View style={[themeVars, { flex: 1, backgroundColor: "#000" }]}>
        <View
          style={{ paddingTop: insets.top + 8 }}
          className="absolute left-0 right-0 top-0 z-10 flex-row items-center gap-2 px-3 pb-3"
        >
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            hitSlop={12}
            style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          >
            <XIcon size={17} color="#fff" />
          </Pressable>

          <View className="min-w-0 flex-1">
            <Text numberOfLines={1} className="text-md font-medium text-white">
              {attachment.filename || (isVideo ? "Video" : "Photo")}
            </Text>
            {attachment.size ? (
              <Text className="text-2xs" style={{ color: "rgba(255,255,255,0.65)" }}>
                {formatBytes(attachment.size)}
              </Text>
            ) : null}
          </View>

          <Pressable
            onPress={() => void share()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Share or save"
            accessibilityState={{ busy: saving }}
            hitSlop={12}
            style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
            className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
          >
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <DownloadIcon size={18} color="#fff" />}
          </Pressable>
        </View>

        {isVideo ? (
          <VideoView player={player} style={{ flex: 1 }} contentFit="contain" nativeControls />
        ) : (
          // Dismiss on tap, the way every phone gallery does — the close button
          // is for thumbs that started at the top of the screen.
          <Pressable onPress={onClose} accessible={false} style={{ flex: 1 }}>
            <Image
              source={mediaSource(attachment.url)}
              style={{ flex: 1 }}
              resizeMode="contain"
              accessibilityLabel={attachment.filename || "Photo"}
            />
          </Pressable>
        )}
      </View>
    </Modal>
  );
}
