import { describe, expect, it } from "vitest";
import { emailFit } from "./email-fit";

describe("emailFit", () => {
  it("leaves an email that fits alone", () => {
    expect(emailFit(420, 450)).toEqual({ scale: 1, width: null });
    expect(emailFit(451, 450)).toEqual({ scale: 1, width: null }); // a pixel of rounding isn't overflow
  });

  it("shrinks a wide email to the column", () => {
    const fit = emailFit(600, 450);
    expect(fit.width).toBe(600);
    expect(fit.scale).toBeCloseTo(0.75);
    expect(600 * fit.scale).toBeCloseTo(450);
  });

  it("never scales up", () => {
    expect(emailFit(300, 900).scale).toBe(1);
  });

  it("does nothing before the column has a width", () => {
    expect(emailFit(600, 0)).toEqual({ scale: 1, width: null });
  });
});
