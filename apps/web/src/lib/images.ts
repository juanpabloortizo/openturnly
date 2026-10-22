/**
 * Shrinks a photo in the browser before uploading, so the server needs no image library
 * and the booking page loads fast. Logos are cropped square; covers keep their shape.
 */
export async function prepareImage(file: File, kind: "logo" | "cover"): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_unavailable");

  if (kind === "logo") {
    const side = Math.min(bitmap.width, bitmap.height);
    const size = Math.min(side, 400);
    canvas.width = size;
    canvas.height = size;
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
  } else {
    const scale = Math.min(1, 1600 / bitmap.width, 900 / bitmap.height);
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
  bitmap.close();

  const toBlob = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  // WebP is smaller; browsers that can't encode it fall back to JPEG.
  const webp = await toBlob("image/webp");
  if (webp?.type === "image/webp") return webp;
  const jpeg = await toBlob("image/jpeg");
  if (!jpeg) throw new Error("image_invalid");
  return jpeg;
}
