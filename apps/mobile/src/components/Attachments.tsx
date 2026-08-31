import { useState } from "react";
import { Text, View } from "react-native";
import { Image } from "expo-image";
import type { Attachment } from "@ding/schemas";
import { formatBytes, formatDuration } from "@ding/client";
import { mediaSource } from "../api-config";
import { DocIcon, EyeIcon, PlayIcon } from "../icons";
import { useTheme } from "../theme";
import { AudioPlayer } from "./AudioPlayer";
import { DocumentViewer } from "./DocumentViewer";
import { MediaViewer } from "./MediaViewer";
import { Touchable } from "./Touchable";

const MAX_W = 240;

/**
 * What a message carried, rendered inside its bubble.
 *
 * Every one of these opened with `Linking.openURL` before, which handed the
 * phone a URL pointing at an authenticated endpoint. Whatever app answered had
 * no session, so every photo, video, voice note and PDF opened onto a 401. The
 * fix is the same in all four cases and it's the same idea: fetch it from
 * inside the app, which is the thing holding the credential.
 *
 *  - a photo opens in a full-screen viewer,
 *  - a video opens in the same viewer, with real playback controls,
 *  - a voice note or audio file plays in the bubble,
 *  - anything else opens in the document viewer, which reads PDFs and text in
 *    the app and hands everything else to the share sheet — where "open in",
 *    "save to Files" and "print" live. That was the *only* thing a document
 *    row did before, which made a PDF something you exported rather than
 *    something you could read while answering the message it came with.
 */
export function Attachments({ items, mine }: { items: Attachment[]; mine?: boolean }) {
  const { c } = useTheme();
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const [reading, setReading] = useState<Attachment | null>(null);

  if (!items.length) return null;

  return (
    <View className="gap-2 pt-1">
      {items.map((a) => {
        if (a.kind === "image" || a.kind === "sticker") {
          const ratio = a.width && a.height ? a.width / a.height : 4 / 3;
          return (
            <Touchable feel="chip"
              key={a.id}
              onPress={() => setViewing(a)}
              accessibilityRole="imagebutton"
              accessibilityLabel={`${a.filename || "Photo"}, tap to open`}
              className=""
            >
              <Image
                source={mediaSource(a.url)}
                style={{ width: MAX_W, height: MAX_W / ratio, borderRadius: 12, backgroundColor: c.surface2 }}
                contentFit="cover"
                // React Native's own <Image> has no disk cache worth the name,
                // so every scroll back past a photo in a long thread was a
                // fresh download and decode, landing as a hard pop-in. This
                // caches, and fades the image in over the placeholder tint
                // instead of swapping it.
                cachePolicy="memory-disk"
                transition={180}
              />
            </Touchable>
          );
        }

        if (a.kind === "video") {
          const ratio = a.width && a.height ? a.width / a.height : 16 / 9;
          return (
            <Touchable feel="chip"
              key={a.id}
              onPress={() => setViewing(a)}
              accessibilityRole="button"
              accessibilityLabel={`Video${a.durationMs ? `, ${formatDuration(a.durationMs)}` : ""}, tap to play`}
              style={{ width: MAX_W, height: MAX_W / ratio, backgroundColor: c.surface2 }}
              className="items-center justify-center overflow-hidden rounded-12"
            >
              {/* A play badge on the surface tint rather than a poster frame:
                  nothing in the pipeline extracts one, and a fake thumbnail is
                  worse than an honest placeholder. */}
              <View
                style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
                className="h-12 w-12 items-center justify-center rounded-full"
              >
                <View style={{ marginLeft: 3 }}>
                  <PlayIcon size={20} color="#fff" />
                </View>
              </View>
              {a.durationMs ? (
                <View
                  style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
                  className="absolute bottom-1.5 right-1.5 rounded-full px-2 py-0.5"
                >
                  <Text className="text-2xs font-medium text-white tabular-nums">
                    {formatDuration(a.durationMs)}
                  </Text>
                </View>
              ) : null}
            </Touchable>
          );
        }

        if (a.kind === "audio" || a.kind === "voice") {
          return <AudioPlayer key={a.id} att={a} mine={mine} />;
        }

        // Everything that isn't a photo, video or sound is a document row —
        // and every one of them opens, rather than only offering a download.
        // What the viewer can actually render is its problem, not the row's:
        // deciding here would mean a file that opens onto "no preview" looked
        // identical to one that doesn't open at all.
        return (
          <Touchable feel="slab"
            key={a.id}
            onPress={() => setReading(a)}
            accessibilityRole="button"
            accessibilityLabel={`${a.filename || a.kind}, ${formatBytes(a.size)}. Tap to open.`}
            style={{ backgroundColor: c.surface2, borderColor: c.border, maxWidth: MAX_W }}
            className="flex-row items-center gap-2.5 rounded-12 border px-3 py-2.5"
          >
            <View
              style={{ backgroundColor: c.brandTint }}
              className="h-8 w-8 items-center justify-center rounded-8"
            >
              <DocIcon size={16} color={c.brandStrong} />
            </View>
            <View className="flex-1">
              <Text numberOfLines={1} className="text-sm font-medium text-fg">
                {a.filename || a.kind}
              </Text>
              <Text className="text-2xs text-faint">{formatBytes(a.size)}</Text>
            </View>
            {/* An eye, not a download arrow. The arrow was honest about what the
                row used to do and is now the secondary action, inside. */}
            <EyeIcon size={16} color={c.textFaint} />
          </Touchable>
        );
      })}

      {/* Mounted only while something is open. The viewer holds a video player,
          and this component renders once per message — leaving it mounted would
          put a native player behind every bubble in the thread. */}
      {viewing ? <MediaViewer attachment={viewing} onClose={() => setViewing(null)} /> : null}
      {reading ? <DocumentViewer attachment={reading} onClose={() => setReading(null)} /> : null}
    </View>
  );
}
