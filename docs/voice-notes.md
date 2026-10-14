# Voice notes

Every voice note plays where it sits: WhatsApp and website-chat conversations,
internal notes, Team Chat, the NestChat widget, on the web and in the app.

## Speed

Once a note has started, a pill appears beside it: **1×**. Each press steps
**1× → 1.25× → 1.5× → 2× → 1×**, as WhatsApp's does. The speed you pick
carries on to the next note you play (the web keeps it in the browser; the app
and the widget until they're closed). On the phone the pitch is corrected, so
2× is someone talking quickly, not a chipmunk.

## Transcribe

Under each voice note or audio file in the inbox and Team Chat (web and app) is
**Transcribe**. Tapping it:

1. sends that one recording to OpenAI's speech-to-text (`POST
   /media/:id/transcript`) — a browser's WebM/Ogg recording goes as the AAC
   copy the iPhone already plays;
2. keeps the words on the attachment (`Attachment.transcript`), so everyone
   sees them under the note from then on, on every device, and it's only paid
   for once. Two taps at once share the one request;
3. shows *No speech heard in this one* for a recording with no words.

Nothing is transcribed unless someone asks. A failure isn't kept: the button
says what went wrong and offers **Try again**.

Team Chat keeps a copy of each attachment as it was sent, so a chat reads the
words from the upload when it opens. A sender can't supply them: the server
drops a `transcript` sent with a message.

Website visitors get the speed pill but not Transcribe.

### Setting it up

**Settings › Integrations › AI › Transcription**: paste an OpenAI API key
(from platform.openai.com → API keys). It's stored encrypted, like the Claude
key, and never shown again. The model defaults to `gpt-4o-mini-transcribe`;
clear the box to go back to it. `OPENAI_API_KEY` / `OPENAI_TRANSCRIBE_MODEL` in
the environment work too, and a saved value wins. Claude can't listen to audio,
which is why this is a separate key.

Not available in the demo workspace.

`pnpm check:transcribe` covers the speeds and the server side.

## Sounds

Team Chat makes the inbox's WhatsApp sounds: the "sent" tick once the server
has your message, and the received sound for a new one — in the chat you have
open too, as a WhatsApp conversation does.
