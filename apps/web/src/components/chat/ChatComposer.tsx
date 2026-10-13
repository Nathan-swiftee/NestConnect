import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { CHAT_MESSAGE_MAX, mentionsToNames, namesToHandles, type ChatMessage, type ChatRoom, type Mentionable } from "@ding/schemas";
import { api, useChatMutation, useChatTypingSignal, useMe, useSendChatMessage } from "../../hooks";
import { formatDuration } from "../../lib/format";
import { AttachIcon, CheckIcon, EditIcon, EmojiIcon, MicIcon, PauseIcon, ReplyIcon, SendIcon, TrashIcon, XIcon } from "../../lib/icons";
import { Avatar } from "../Avatar";
import { StagedChip } from "../media/media";
import { useChatMedia } from "./useChatMedia";

const EMOJIS = [
  "😀", "😄", "😁", "😅", "😂", "🙂", "😉", "😊", "😍", "😘", "😎", "🤩", "🤗", "🤔", "😐", "😴",
  "🙃", "😇", "🥳", "😢", "😭", "😤", "😡", "😱", "🤯", "🥺", "😬", "👍", "👎", "👏", "🙏", "💪",
  "🙌", "👌", "🤝", "👋", "💯", "🔥", "✨", "🎉", "❤️", "💚", "💙", "✅", "❌", "⚠️", "⭐", "💡",
  "🚀", "🎯", "📦", "🚚", "📅", "⏰", "💬", "📞", "☕", "🍕",
];

/** Unsent words, per chat — switching chats and coming back finds them where they were. */
const drafts = new Map<string, string>();
const DRAFT_KEY = (id: string) => `nest.chat.draft.${id}`;
function loadDraft(id: string): string {
  if (drafts.has(id)) return drafts.get(id)!;
  try {
    return localStorage.getItem(DRAFT_KEY(id)) ?? "";
  } catch {
    return "";
  }
}
function saveDraft(id: string, text: string): void {
  drafts.set(id, text);
  try {
    if (text) localStorage.setItem(DRAFT_KEY(id), text);
    else localStorage.removeItem(DRAFT_KEY(id));
  } catch {
    /* private window: the in-memory copy is enough */
  }
}

/** What the chat around the composer can hand it: files dropped anywhere on the chat. */
export type ChatComposerHandle = { addFiles: (files: File[]) => void };

export const ChatComposer = forwardRef<
  ChatComposerHandle,
  {
    room: ChatRoom;
    people: Mentionable[];
    replyTo: ChatMessage | null;
    editing: ChatMessage | null;
    onCancelReply: () => void;
    onCancelEdit: () => void;
    onToast: (m: string) => void;
  }
>(function ChatComposer({ room, people, replyTo, editing, onCancelReply, onCancelEdit, onToast }, ref) {
  const me = useMe().data?.user;
  const mePerson = useMemo(
    () => (me ? { id: me.id, name: me.name, avatarColor: me.avatarColor ?? null, avatarUrl: me.avatarUrl ?? null } : null),
    [me],
  );
  const send = useSendChatMessage(room.id, mePerson);
  const edit = useChatMutation(({ id, body }: { id: string; body: string }) => api.editChatMessage(id, body));
  const { typed, stop } = useChatTypingSignal(room.id);
  const [text, setText] = useState(() => loadDraft(room.id));
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const media = useChatMedia(onToast, (att) => {
    const quoting = replyTo;
    onCancelReply();
    return send("", quoting, [att]);
  });
  useImperativeHandle(ref, () => ({ addFiles: (files) => (editing ? onToast("Finish editing first") : media.addFiles(files)) }), [editing, media, onToast]);

  // Editing puts the message in the box, with mentions shown by name.
  useEffect(() => {
    if (editing) {
      setText(mentionsToNames(editing.body, people));
      box.current?.focus();
    }
  }, [editing, people]);
  useEffect(() => {
    if (replyTo) box.current?.focus();
  }, [replyTo]);
  useEffect(() => {
    if (!editing) saveDraft(room.id, text);
  }, [room.id, text, editing]);
  // Grow with what's written, up to a point.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  // Only people in this chat can be mentioned in it.
  const inRoom = useMemo(() => {
    const ids = new Set(room.members.filter((m) => m.id !== me?.id).map((m) => m.id));
    return people.filter((p) => ids.has((p as Mentionable & { id?: string }).id ?? ""));
  }, [people, room.members, me?.id]);
  const matches = mention
    ? inRoom.filter((p) => p.name.toLowerCase().startsWith(mention.query.toLowerCase()) || p.name.toLowerCase().includes(` ${mention.query.toLowerCase()}`)).slice(0, 6)
    : [];

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value.slice(0, CHAT_MESSAGE_MAX);
    setText(v);
    if (!editing) typed();
    const caret = e.target.selectionStart ?? v.length;
    const before = v.slice(0, caret);
    const at = /(^|\s)@([^\s@]{0,24})$/.exec(before);
    setMention(at ? { query: at[2]!, start: caret - at[2]!.length - 1 } : null);
    setMentionIdx(0);
  };

  const pickMention = (p: Mentionable) => {
    if (!mention) return;
    const caret = box.current?.selectionStart ?? text.length;
    const next = `${text.slice(0, mention.start)}@${p.name} ${text.slice(caret)}`;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + p.name.length + 2;
      box.current?.focus();
      box.current?.setSelectionRange(pos, pos);
    });
  };

  const submit = async () => {
    const body = namesToHandles(text.trim(), people);
    if (!editing && media.uploading) return onToast("Still uploading — one moment");
    if (!body && (editing || !media.ready)) return;
    stop();
    setEmojiOpen(false);
    if (editing) {
      if (body === editing.body) {
        setText(loadDraft(room.id));
        return onCancelEdit();
      }
      edit.mutate({ id: editing.id, body }, { onError: (e) => onToast((e as Error).message) });
      // Back to whatever was being written before the edit started.
      setText(loadDraft(room.id));
      onCancelEdit();
      return;
    }
    setText("");
    saveDraft(room.id, "");
    const quoting = replyTo;
    onCancelReply();
    await send(body, quoting, media.take());
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (!files.length || editing) return;
    e.preventDefault();
    media.addFiles(files);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length) {
      if (e.key === "ArrowDown") return e.preventDefault(), setMentionIdx((i) => (i + 1) % matches.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setMentionIdx((i) => (i - 1 + matches.length) % matches.length);
      if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), pickMention(matches[mentionIdx]!);
      if (e.key === "Escape") return e.preventDefault(), setMention(null);
    }
    if (e.key === "Escape") {
      if (editing) {
        setText(loadDraft(room.id));
        return onCancelEdit();
      }
      if (replyTo) return onCancelReply();
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const insertEmoji = (emo: string) => {
    const el = box.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const next = text.slice(0, start) + emo + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + emo.length, start + emo.length);
    });
  };

  return (
    <div className="tc-composer">
      {(replyTo || editing) && (
        <div className="tc-composer__ctx">
          {editing ? <EditIcon /> : <ReplyIcon />}
          <div className="tc-composer__ctxbody">
            <span className="tc-composer__ctxwho">
              {editing ? "Edit message" : replyTo?.author?.id === me?.id ? "Replying to yourself" : `Replying to ${replyTo?.author?.name ?? ""}`}
            </span>
            <span className="tc-composer__ctxtext">{mentionsToNames((editing ?? replyTo)!.body, people)}</span>
          </div>
          <button
            type="button"
            className="iconbtn"
            aria-label={editing ? "Cancel editing" : "Cancel reply"}
            onClick={() => {
              if (editing) {
                setText(loadDraft(room.id));
                onCancelEdit();
              } else onCancelReply();
            }}
          >
            <XIcon />
          </button>
        </div>
      )}
      {media.staged.length > 0 && (
        <div className="comp-atts tc-composer__atts">
          {media.staged.map((st) => (
            <StagedChip key={st.localId} s={st} onRemove={() => media.remove(st.localId)} onRetry={() => media.retry(st.localId)} />
          ))}
        </div>
      )}
      <input
        ref={picker}
        type="file"
        multiple
        hidden
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          media.addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {media.voice.recording ? (
        <div className="comp-rec tc-rec" role="group" aria-label="Recording voice message">
          <button type="button" className="comp-rec__del" onClick={media.voice.cancel} title="Delete" aria-label="Delete recording">
            <TrashIcon />
          </button>
          <span className={"comp-rec__dot" + (media.voice.paused ? " paused" : "")} aria-hidden="true" />
          <span className="comp-rec__time tnum">{formatDuration(media.voice.secs * 1000)}</span>
          <span className="comp-rec__hint">{media.voice.paused ? "Paused" : "Recording…"}</span>
          <button
            type="button"
            className="comp-rec__pause"
            onClick={media.voice.togglePause}
            title={media.voice.paused ? "Resume" : "Pause"}
            aria-label={media.voice.paused ? "Resume recording" : "Pause recording"}
          >
            {media.voice.paused ? <MicIcon /> : <PauseIcon />}
          </button>
          <button type="button" className="tc-send" onClick={media.voice.send} title="Send" aria-label="Send voice message">
            <SendIcon />
          </button>
        </div>
      ) : (
      <div className="tc-composer__row">
        <div className="tc-composer__field">
          {emojiOpen && (
            <div className="emojipop tc-emojipop" role="menu" aria-label="Insert emoji">
              {EMOJIS.map((e) => (
                <button key={e} type="button" className="emojipop__e" onClick={() => insertEmoji(e)} aria-label={`Insert ${e}`}>
                  {e}
                </button>
              ))}
            </div>
          )}
          {mention && matches.length > 0 && (
            <div className="mentionpop tc-mentionpop" role="listbox" aria-label="Mention someone">
              {matches.map((p, i) => (
                <button
                  key={p.email}
                  type="button"
                  role="option"
                  aria-selected={i === mentionIdx}
                  className={i === mentionIdx ? "on" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(p);
                  }}
                >
                  <Avatar name={p.name} email={p.email} color={p.avatarColor} src={p.avatarUrl} size={22} fontSize={9} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className={"iconbtn" + (emojiOpen ? " on" : "")}
            aria-label="Emoji"
            title="Emoji"
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <EmojiIcon />
          </button>
          {!editing && (
            <button type="button" className="iconbtn" aria-label="Attach" title="Photos, videos and files" onClick={() => picker.current?.click()}>
              <AttachIcon />
            </button>
          )}
          <textarea
            ref={box}
            rows={1}
            value={text}
            placeholder={editing ? "Edit your message" : "Type a message"}
            aria-label="Message"
            onChange={onChange}
            onKeyDown={onKey}
            onPaste={onPaste}
            onBlur={() => window.setTimeout(() => setMention(null), 120)}
          />
        </div>
        {!editing && !text.trim() && !media.staged.length ? (
          // Nothing to send: the button records, as WhatsApp's does.
          <button type="button" className="tc-send" aria-label="Record a voice message" title="Record a voice message" onClick={() => void media.voice.start()}>
            <MicIcon />
          </button>
        ) : (
          <button
            type="button"
            className="tc-send"
            aria-label={editing ? "Save" : "Send"}
            disabled={editing ? !text.trim() : media.uploading || (!text.trim() && !media.ready)}
            onClick={() => void submit()}
          >
            {editing ? <CheckIcon /> : <SendIcon />}
          </button>
        )}
      </div>
      )}
    </div>
  );
});

