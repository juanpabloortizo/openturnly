import { useQuery } from "@tanstack/react-query";

/** How far (0–255 per channel) a pixel can be from the background and still count as it. */
const TOLERANCE = 28;
/** Below this alpha a pixel is see-through. */
const CLEAR = 16;

type Rgb = [number, number, number];

const lightness = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function difference(data: Uint8ClampedArray, pixel: number, [r, g, b]: Rgb) {
  const i = pixel * 4;
  return Math.max(
    Math.abs((data[i] ?? 0) - r),
    Math.abs((data[i + 1] ?? 0) - g),
    Math.abs((data[i + 2] ?? 0) - b),
  );
}

/** The pixels along the four edges. */
function edges(width: number, height: number) {
  const pixels: number[] = [];
  for (let x = 0; x < width; x++) pixels.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) pixels.push(y * width, y * width + width - 1);
  return pixels;
}

/** The middle value of each channel: the background, even with a few stray pixels. */
function median(data: Uint8ClampedArray, pixels: number[]): Rgb {
  const channel = (offset: number) => {
    const values = pixels.map((pixel) => data[pixel * 4 + offset] ?? 0).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? 0;
  };
  return [channel(0), channel(1), channel(2)];
}

/**
 * Clears the background reachable from the edges, like a paint bucket, so white inside the
 * logo (an eye, a letter) stays. Pixels on the border are softened instead of cut.
 */
function clearBackground(data: Uint8ClampedArray, width: number, height: number, background: Rgb) {
  const cleared = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const matches = (pixel: number) =>
    (data[pixel * 4 + 3] ?? 0) < CLEAR || difference(data, pixel, background) <= TOLERANCE;
  const visit = (pixel: number) => {
    if (cleared[pixel] || !matches(pixel)) return;
    cleared[pixel] = 1;
    queue[tail++] = pixel;
  };
  for (const pixel of edges(width, height)) visit(pixel);
  while (head < tail) {
    const pixel = queue[head++] ?? 0;
    const x = pixel % width;
    if (x > 0) visit(pixel - 1);
    if (x < width - 1) visit(pixel + 1);
    if (pixel >= width) visit(pixel - width);
    if (pixel < width * (height - 1)) visit(pixel + width);
  }
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (cleared[pixel]) {
      data[pixel * 4 + 3] = 0;
      continue;
    }
    const x = pixel % width;
    const touches =
      (x > 0 && cleared[pixel - 1]) ||
      (x < width - 1 && cleared[pixel + 1]) ||
      (pixel >= width && cleared[pixel - width]) ||
      (pixel < width * (height - 1) && cleared[pixel + width]);
    if (!touches) continue;
    // Anti-aliased edges are half background: they fade out instead of leaving a halo.
    const share = Math.min(1, (difference(data, pixel, background) - TOLERANCE) / (TOLERANCE * 2));
    data[pixel * 4 + 3] = Math.round((data[pixel * 4 + 3] ?? 0) * Math.max(0, share));
  }
}

/** The box around what can be seen, or null when the image is empty. */
function visibleBox(data: Uint8ClampedArray, width: number, height: number) {
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) < CLEAR * 1.5) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** True when what can be seen is mostly white: it would vanish on the white of the code. */
function mostlyLight(data: Uint8ClampedArray) {
  let total = 0;
  let weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = (data[i + 3] ?? 0) / 255;
    total += lightness(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0) * alpha;
    weight += alpha;
  }
  return weight > 0 && total / weight > 0.8;
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("canvas_unavailable");
  return { canvas, context };
}

/**
 * The logo ready for the middle of a QR code, whatever was uploaded. A plain light background
 * (white, light grey…) is removed and the empty margins trimmed, so it doesn't show as a box;
 * a white logo goes on a `badge` circle so it doesn't vanish on the code's white; a logo on a
 * colour or a photo keeps its background, with rounded corners. Returns a PNG data URL.
 */
export async function qrLogo(url: string, badge: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const source = canvasOf(width, height);
  source.context.drawImage(image, 0, 0, width, height);
  const pixels = source.context.getImageData(0, 0, width, height);
  const { data } = pixels;

  const border = edges(width, height);
  const solid = border.filter((pixel) => (data[pixel * 4 + 3] ?? 0) >= CLEAR);
  // Already cut out (a PNG with transparency) unless most of its edge can be seen.
  let cutOut = solid.length < border.length * 0.1;
  if (!cutOut) {
    const background = median(data, solid);
    const plain =
      solid.filter((pixel) => difference(data, pixel, background) <= TOLERANCE).length >=
      border.length * 0.9;
    if (plain && lightness(...background) > 0.75) {
      clearBackground(data, width, height, background);
      cutOut = true;
    }
  }

  if (!cutOut) {
    // A colour or a photo behind it is part of the logo: only the corners are softened.
    const rounded = canvasOf(width, height);
    rounded.context.beginPath();
    rounded.context.roundRect(0, 0, width, height, Math.min(width, height) * 0.2);
    rounded.context.clip();
    rounded.context.drawImage(source.canvas, 0, 0);
    return rounded.canvas.toDataURL("image/png");
  }

  source.context.putImageData(pixels, 0, 0);
  const box = visibleBox(data, width, height);
  if (!box) return url;
  const side = Math.max(box.width, box.height);
  if (mostlyLight(data)) {
    const size = Math.round(side * 1.45);
    const disc = canvasOf(size, size);
    disc.context.fillStyle = badge;
    disc.context.beginPath();
    disc.context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    disc.context.fill();
    disc.context.drawImage(
      source.canvas,
      box.x,
      box.y,
      box.width,
      box.height,
      (size - box.width) / 2,
      (size - box.height) / 2,
      box.width,
      box.height,
    );
    return disc.canvas.toDataURL("image/png");
  }
  const margin = Math.round(side * 0.04);
  const trimmed = canvasOf(box.width + margin * 2, box.height + margin * 2);
  trimmed.context.drawImage(
    source.canvas,
    box.x,
    box.y,
    box.width,
    box.height,
    margin,
    margin,
    box.width,
    box.height,
  );
  return trimmed.canvas.toDataURL("image/png");
}

/**
 * The business logo prepared for its QR code: undefined while it's being prepared, null without
 * a logo. If it can't be prepared, the logo as uploaded.
 */
export function useQrLogo(url: string | null, badge: string) {
  const prepared = useQuery({
    queryKey: ["qr-logo", url, badge],
    queryFn: () => qrLogo(url ?? "", badge),
    enabled: url !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
  if (url === null) return null;
  if (prepared.isError) return url;
  return prepared.data;
}
