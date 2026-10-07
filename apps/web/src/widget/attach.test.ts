import { describe, expect, it } from "vitest";
import { NESTCHAT_MAX_ATTACHMENTS, NESTCHAT_MAX_UPLOAD_BYTES } from "@ding/schemas";
import { admit, fileSize, isPicture, refusal } from "./attach";

const file = (type: string, size = 1000) => ({ type, size });

describe("attaching a file in the chat", () => {
  it("takes what the server takes", () => {
    for (const t of ["image/jpeg", "image/png", "video/mp4", "audio/mpeg", "application/pdf", "text/plain"]) {
      expect(refusal(file(t))).toBeUndefined();
    }
  });

  it("turns away what the server would, before uploading it", () => {
    // An SVG passes "is it an image" and carries script; an unknown type is
    // what a browser reports for an .exe.
    expect(refusal(file("image/svg+xml"))).toMatch(/can’t be attached/);
    expect(refusal(file(""))).toMatch(/can’t be attached/);
    expect(refusal(file("application/x-msdownload"))).toMatch(/can’t be attached/);
    expect(refusal(file("image/png", NESTCHAT_MAX_UPLOAD_BYTES + 1))).toMatch(/too large/);
    expect(refusal(file("image/png", 0))).toMatch(/empty/);
  });

  it("keeps the good ones and says why the rest were left", () => {
    const { take, notice } = admit([file("image/png"), file("image/svg+xml"), file("application/pdf")], 0);
    expect(take).toHaveLength(2);
    expect(notice).toMatch(/can’t be attached/);
  });

  it("stops at the limit, counting what is already waiting", () => {
    const many = Array.from({ length: NESTCHAT_MAX_ATTACHMENTS }, () => file("image/png"));
    const { take, notice } = admit(many, 2);
    expect(take).toHaveLength(NESTCHAT_MAX_ATTACHMENTS - 2);
    expect(notice).toMatch(new RegExp(`up to ${NESTCHAT_MAX_ATTACHMENTS}`));
    expect(admit([file("image/png")], 0).notice).toBeUndefined();
  });

  it("draws photos inline and lists everything else", () => {
    expect(isPicture({ mime: "image/jpeg" })).toBe(true);
    expect(isPicture({ mime: "image/webp" })).toBe(true);
    expect(isPicture({ mime: "application/pdf" })).toBe(false);
    expect(isPicture({ mime: "image/svg+xml" })).toBe(false);
  });

  it("says a size somebody can read", () => {
    expect(fileSize(830 * 1024)).toBe("830 KB");
    expect(fileSize(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(fileSize(12)).toBe("1 KB");
  });
});
