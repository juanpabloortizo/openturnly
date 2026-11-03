import { Check, Download, ImagePlus, Palette, Printer, SlidersHorizontal } from "lucide-react";
import QRCodeStyling, { type Options } from "qr-code-styling";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { darkEnough, isLight, shade } from "../lib/brand.ts";
import { cn } from "../lib/cn.ts";
import { saveFile } from "../lib/export.ts";
import { errorMessage } from "../lib/forms.ts";
import { useQrLogo } from "../lib/logo.ts";
import { Modal } from "./controls.tsx";
import { toast } from "./toast.tsx";
import { Button, Field, Input } from "./ui.tsx";

/** Rounded dots in the brand's colour, with the logo (if any) in the middle. */
function qrOptions(url: string, color: string, logo: string | null, size: number): Options {
  // Light brand colours are darkened: phones need contrast with the white to read it.
  const ink = darkEnough(color);
  return {
    type: "svg",
    width: size,
    height: size,
    margin: Math.round(size * 0.04),
    data: url,
    ...(logo ? { image: logo } : {}),
    // The highest correction: the code still reads with its middle under the logo.
    qrOptions: { errorCorrectionLevel: logo ? "H" : "Q" },
    imageOptions: {
      hideBackgroundDots: true,
      imageSize: 0.4,
      margin: Math.round(size * 0.015),
      crossOrigin: "anonymous",
    },
    dotsOptions: {
      type: "rounded",
      gradient: {
        type: "linear",
        rotation: Math.PI / 4,
        colorStops: [
          { offset: 0, color: ink },
          { offset: 1, color: shade(ink, 0.4) },
        ],
      },
    },
    cornersSquareOptions: { type: "extra-rounded", color: shade(ink, 0.2) },
    cornersDotOptions: { type: "dot", color: ink },
    backgroundOptions: { color: "#ffffff" },
  };
}

// --- Poster ----------------------------------------------------------------------
// Sizes in pixels of the downloaded image: sharp enough to print as a poster.

const POSTER_WIDTH = 1600;
const POSTER_PADDING = 120;
/** The white card around the code; its padding is the quiet zone phones need. */
const CARD_SIZE = POSTER_WIDTH - POSTER_PADDING * 2;
const CARD_PADDING = 96;
const QR_SIZE = CARD_SIZE - CARD_PADDING * 2;

const POSTER_STYLES = [
  { value: "color", icon: Palette },
  { value: "white", icon: Printer },
] as const;
type PosterStyle = (typeof POSTER_STYLES)[number]["value"];

const font = (weight: number, size: number) =>
  `${weight} ${size}px "Inter Variable", ui-sans-serif, system-ui, sans-serif`;

/**
 * The biggest size (down to `min`) that fits the text in one line, else in two even lines,
 * else in as many lines as it takes at `min`.
 */
function fitText(
  context: CanvasRenderingContext2D,
  text: string,
  weight: number,
  [max, min]: [number, number],
) {
  const width = POSTER_WIDTH - POSTER_PADDING * 2;
  const widest = (lines: string[], size: number) => {
    context.font = font(weight, size);
    return Math.max(...lines.map((line) => context.measureText(line).width));
  };
  const fit = (lines: string[]) => {
    for (let size = max; size >= min; size -= 4) {
      if (widest(lines, size) <= width) return { size, lines };
    }
    return null;
  };
  const words = text.split(/\s+/);
  // The break that leaves both lines closest in length, so no word is left alone below.
  const [even] = words
    .slice(1)
    .map((_, index) => [words.slice(0, index + 1).join(" "), words.slice(index + 1).join(" ")])
    .sort((a, b) => widest(a, min) - widest(b, min));
  const fitted = fit([text]) ?? (even && fit(even));
  if (fitted) return fitted;
  context.font = font(weight, min);
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && context.measureText(`${last} ${word}`).width <= width) {
      lines[lines.length - 1] = `${last} ${word}`;
    } else lines.push(word);
  }
  return { size: min, lines };
}

/** The code in its card, with a line above (like "Book here") and one below (the name). */
function drawPoster(
  canvas: HTMLCanvasElement,
  {
    qr,
    color,
    style,
    heading,
    footer,
  }: {
    qr: ImageBitmap;
    color: string;
    style: PosterStyle;
    heading: string;
    footer: string;
  },
) {
  const context = canvas.getContext("2d");
  if (!context) return;
  const top = heading ? fitText(context, heading, 800, [136, 76]) : null;
  const bottom = footer ? fitText(context, footer, 600, [96, 56]) : null;
  const height = (text: typeof top, gap: number) =>
    text ? text.lines.length * Math.round(text.size * 1.18) + gap : 0;
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_PADDING * 2 + height(top, 72) + CARD_SIZE + height(bottom, 64);

  const onColor = style === "color";
  if (onColor) {
    const background = context.createLinearGradient(0, 0, 0, canvas.height);
    background.addColorStop(0, color);
    background.addColorStop(1, shade(color, 0.22));
    context.fillStyle = background;
  } else context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  const textColor = onColor ? (isLight(color) ? "#18181b" : "#ffffff") : null;
  context.textAlign = "center";
  context.textBaseline = "top";
  let y = POSTER_PADDING;
  const write = (text: typeof top, weight: number, fill: string, gap: number) => {
    if (!text) return;
    context.font = font(weight, text.size);
    context.fillStyle = fill;
    for (const line of text.lines) {
      context.fillText(line, POSTER_WIDTH / 2, y);
      y += Math.round(text.size * 1.18);
    }
    y += gap;
  };

  write(top, 800, textColor ?? darkEnough(color), 72);
  if (onColor) {
    context.fillStyle = "#ffffff";
    context.beginPath();
    context.roundRect(POSTER_PADDING, y, CARD_SIZE, CARD_SIZE, 72);
    context.fill();
  }
  context.drawImage(qr, POSTER_PADDING + CARD_PADDING, y + CARD_PADDING, QR_SIZE, QR_SIZE);
  y += CARD_SIZE + 64;
  write(bottom, 600, textColor ?? "#18181b", 0);
}

async function qrImage(url: string, color: string, logo: string | null) {
  const qr = new QRCodeStyling({
    ...qrOptions(url, color, logo, QR_SIZE),
    type: "canvas",
    margin: 0,
  });
  const blob = await qr.getRawData("png");
  if (!(blob instanceof Blob)) throw new Error("qr_failed");
  return createImageBitmap(blob);
}

/** The code for the poster, once its fonts are in: the bold may not have loaded yet. */
async function posterQr(url: string, color: string, logo: string | null) {
  const [qr] = await Promise.all([
    qrImage(url, color, logo),
    document.fonts.load(font(800, 100)),
    document.fonts.load(font(600, 100)),
  ]);
  return qr;
}

function savePoster(canvas: HTMLCanvasElement, fileName: string) {
  return new Promise<void>((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("image_failed"));
      saveFile(blob, `${fileName}.png`);
      resolve();
    }, "image/png"),
  );
}

/** The texts and background of the image, previewed exactly as it downloads. */
function PosterModal({
  open,
  onClose,
  url,
  color,
  logo,
  initialHeading,
  initialFooter,
  fileName,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  color: string;
  logo: string | null;
  initialHeading: string;
  initialFooter: string;
  fileName: string;
}) {
  const { t } = useTranslation();
  const [heading, setHeading] = useState(initialHeading);
  const [footer, setFooter] = useState(initialFooter);
  const [style, setStyle] = useState<PosterStyle>("color");
  const [qr, setQr] = useState<ImageBitmap | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    posterQr(url, color, logo)
      .then((image) => current && setQr(image))
      .catch((error) => toast.error(errorMessage(t, error)));
    return () => {
      current = false;
    };
  }, [open, url, color, logo, t]);

  useEffect(() => {
    if (open && qr && canvas.current) {
      drawPoster(canvas.current, {
        qr,
        color,
        style,
        heading: heading.trim(),
        footer: footer.trim(),
      });
    }
  }, [open, qr, color, style, heading, footer]);

  const download = () => {
    if (!canvas.current) return;
    savePoster(canvas.current, fileName)
      .then(onClose)
      .catch((error) => toast.error(errorMessage(t, error)));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={t("settings.qrPosterTitle")}
      description={t("settings.qrPosterHint")}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={download} disabled={!qr}>
            <Download className="size-4" aria-hidden />
            {t("settings.qrDownloadImage")}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="space-y-4">
          <Field label={t("settings.qrHeading")} optional hint={t("settings.qrHeadingHint")}>
            {(props) => (
              <Input
                {...props}
                value={heading}
                maxLength={40}
                onChange={(event) => setHeading(event.target.value)}
              />
            )}
          </Field>
          <Field label={t("settings.qrFooter")} optional hint={t("settings.qrFooterHint")}>
            {(props) => (
              <Input
                {...props}
                value={footer}
                maxLength={60}
                onChange={(event) => setFooter(event.target.value)}
              />
            )}
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-zinc-900">
              {t("settings.qrBackground")}
            </legend>
            <div className="grid gap-2">
              {POSTER_STYLES.map(({ value, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={style === value}
                  onClick={() => setStyle(value)}
                  className={cn(
                    "flex gap-3 rounded-xl border p-3 text-left transition-colors",
                    style === value
                      ? "border-brand-500 bg-brand-50/50"
                      : "border-zinc-200 hover:border-zinc-300",
                  )}
                >
                  <Icon
                    className={cn(
                      "mt-0.5 size-5 shrink-0",
                      style === value ? "text-brand-600" : "text-zinc-400",
                    )}
                    aria-hidden
                  />
                  <span>
                    <span className="block text-sm font-medium text-zinc-900">
                      {t(`settings.qrBackgrounds.${value}.label`)}
                    </span>
                    <span className="mt-0.5 block text-[13px] text-zinc-500">
                      {t(`settings.qrBackgrounds.${value}.hint`)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="max-sm:order-first">
          <p className="mb-1.5 text-sm font-medium text-zinc-900">{t("settings.previewTitle")}</p>
          <div className="relative grid min-h-48 place-items-center overflow-hidden rounded-lg bg-zinc-100 ring-1 ring-zinc-200 max-sm:mx-auto max-sm:w-44">
            <canvas
              ref={canvas}
              role="img"
              aria-label={t("settings.qrAlt", { url })}
              className={cn("block h-auto w-full", !qr && "invisible")}
            />
            {!qr && <span className="absolute text-sm text-zinc-400">{t("common.loading")}</span>}
          </div>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The booking page's QR code, shown as the image it downloads: a line on top, the code with the
 * logo in the middle and the name below. "Customize" changes those before downloading.
 */
export function BookingQr({
  url,
  color,
  logoUrl,
  name,
  locale,
  fileName,
}: {
  url: string;
  color: string;
  logoUrl: string | null;
  name: string;
  locale: string;
  fileName: string;
}) {
  const { t, i18n } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const logo = useQrLogo(logoUrl, darkEnough(color));
  const [ready, setReady] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  // The poster speaks to the business's customers, in the booking page's language.
  const heading = i18n.getFixedT(locale)("settings.qrHeadingDefault");

  useEffect(() => {
    // Drawn once the logo is ready, so the code doesn't show up first without it.
    if (logo === undefined) return;
    let current = true;
    posterQr(url, color, logo)
      .then((qr) => {
        if (!current || !canvas.current) return;
        drawPoster(canvas.current, { qr, color, style: "color", heading, footer: name });
        setReady(true);
      })
      .catch((error) => toast.error(errorMessage(t, error)));
    return () => {
      current = false;
    };
  }, [url, color, logo, heading, name, t]);

  const download = () => {
    if (!canvas.current) return;
    savePoster(canvas.current, fileName).catch((error) => toast.error(errorMessage(t, error)));
  };

  const features = [
    {
      done: Boolean(logoUrl),
      text: logoUrl ? t("settings.qrFeatures.logo") : t("settings.qrFeatures.noLogo"),
    },
    { done: true, text: t("settings.qrFeatures.texts") },
    { done: true, text: t("settings.qrFeatures.print") },
  ];

  return (
    <div className="flex flex-col items-center gap-5 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 sm:flex-row">
      <div className="relative w-32 shrink-0">
        {/* Sized like the poster from the start, so nothing jumps when it's drawn. */}
        <canvas
          ref={canvas}
          width={POSTER_WIDTH}
          height={2000}
          role="img"
          aria-label={t("settings.qrAlt", { url })}
          className={cn(
            "block h-auto w-full rounded-lg shadow-md ring-1 ring-zinc-950/5",
            !ready && "invisible",
          )}
        />
        {!ready && <div className="absolute inset-0 animate-pulse rounded-lg bg-zinc-200" />}
      </div>
      <div className="min-w-0 self-stretch sm:self-center">
        <h3 className="text-sm font-medium text-zinc-900">{t("settings.qrTitle")}</h3>
        <ul className="mt-2 space-y-1.5">
          {features.map(({ done, text }) => (
            <li key={text} className="flex gap-2 text-[13px] text-zinc-600">
              {done ? (
                <Check className="mt-0.5 size-3.5 shrink-0 text-brand-600" aria-hidden />
              ) : (
                <ImagePlus className="mt-0.5 size-3.5 shrink-0 text-zinc-400" aria-hidden />
              )}
              {text}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button size="sm" disabled={!ready} onClick={download}>
            <Download className="size-4" aria-hidden />
            {t("settings.qrDownload")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={logo === undefined}
            onClick={() => setCustomizing(true)}
          >
            <SlidersHorizontal className="size-4" aria-hidden />
            {t("settings.qrCustomize")}
          </Button>
        </div>
      </div>
      {logo !== undefined && (
        <PosterModal
          open={customizing}
          onClose={() => setCustomizing(false)}
          url={url}
          color={color}
          logo={logo}
          initialHeading={heading}
          initialFooter={name}
          fileName={fileName}
        />
      )}
    </div>
  );
}
