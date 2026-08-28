import { Text } from "react-native";
import { CameraIcon, DocIcon, ImageIcon } from "../icons";
import { useTheme } from "../theme";
import { Sheet } from "./Sheet";
import { Touchable } from "./Touchable";

/**
 * Where the file is coming from.
 *
 * A phone has three genuinely different answers and the OS puts each behind its
 * own permission, so they're three choices rather than one "attach" that has to
 * guess. Camera leads because on a phone the usual case is "photograph the thing
 * the customer is asking about".
 */
export function AttachSheet({
  visible,
  onClose,
  onCamera,
  onPhotos,
  onFiles,
}: {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onPhotos: () => void;
  onFiles: () => void;
}) {
  const { c } = useTheme();

  const rows = [
    { key: "camera", label: "Take a photo", Icon: CameraIcon, run: onCamera },
    { key: "photos", label: "Photo or video library", Icon: ImageIcon, run: onPhotos },
    { key: "files", label: "File", Icon: DocIcon, run: onFiles },
  ];

  return (
    <Sheet visible={visible} onClose={onClose}>
          {rows.map(({ key, label, Icon, run }, i) => (
            <Touchable feel="row"
              key={key}
              onPress={() => {
                onClose();
                // Let the sheet finish dismissing before the OS picker appears —
                // two modals mid-transition is how iOS ends up showing neither.
                setTimeout(run, 250);
              }}
              accessibilityRole="button"
              style={{ borderBottomColor: i === rows.length - 1 ? "transparent" : c.border }}
              className={`flex-row items-center gap-3 py-3.5 ${i === rows.length - 1 ? "" : "border-b"}`}
            >
              <Icon size={20} color={c.textMuted} />
              <Text className="text-lg font-medium text-fg">{label}</Text>
            </Touchable>
          ))}
    </Sheet>
  );
}
