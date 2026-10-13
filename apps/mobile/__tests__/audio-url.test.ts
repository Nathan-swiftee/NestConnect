/**
 * Which file the app plays: a browser's recording (WebM or Ogg Opus) is asked
 * for as the server's AAC copy, because the iPhone's player can't open either
 * and never says so. Everything else is played as it is.
 */
import { playableUrl } from "../src/audio-url";

describe("playableUrl", () => {
  it("asks for the AAC copy of a Chrome or Firefox recording", () => {
    expect(playableUrl({ url: "/api/media/att_1", mime: "audio/webm;codecs=opus" })).toBe("/api/media/att_1?as=m4a");
    expect(playableUrl({ url: "/api/media/att_2", mime: "audio/ogg" })).toBe("/api/media/att_2?as=m4a");
  });
  it("keeps any query the URL already has", () => {
    expect(playableUrl({ url: "/api/media/att_1?v=2", mime: "audio/webm" })).toBe("/api/media/att_1?v=2&as=m4a");
  });
  it("plays what a phone already can as it is", () => {
    expect(playableUrl({ url: "/api/media/att_3", mime: "audio/mp4" })).toBe("/api/media/att_3");
    expect(playableUrl({ url: "/api/media/att_4", mime: "audio/mpeg" })).toBe("/api/media/att_4");
  });
});
