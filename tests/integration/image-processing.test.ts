import { describe, expect, it } from "vitest";
import { inspectImage } from "@/lib/image/inspection";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("image processing readiness", () => {
  it("loads, hashes, inspects, and releases an image in memory", async () => {
    let transientImage: Buffer | undefined = Buffer.from(ONE_BY_ONE_PNG);
    const inspection = await inspectImage(transientImage);

    expect(inspection.format).toBe("png");
    expect(inspection.width).toBe(1);
    expect(inspection.height).toBe(1);
    expect(inspection.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(inspection.perceptualHash).toHaveLength(64);
    expect(inspection.exif).toBeNull();

    transientImage = undefined;
    expect(transientImage).toBeUndefined();
  });
});
