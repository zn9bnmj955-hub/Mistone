"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@orgasport/ui";

type Labels = { scan: string; title: string; help: string; unsupported: string; denied: string; close: string };

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Opens the camera and reads a tournament QR code. Uses the native
 * BarcodeDetector when available, otherwise loads a small decoder on demand.
 * Hidden until JavaScript runs (the form works without it).
 */
export function QrScanButton({ labels, className }: { labels: Labels; className?: string }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- reveal the button once JS runs
  useEffect(() => setMounted(true), []);

  // Keyboard: focus the close button, Escape closes, focus returns to the trigger.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const trigger = triggerRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      trigger?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let raf = 0;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage(labels.unsupported);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (cancelled) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
      } catch {
        setMessage(labels.denied);
        return;
      }

      const BD = (globalThis as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const detector: Detector | null = BD ? new BD({ formats: ["qr_code"] }) : null;
      const jsQR = detector ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      const tick = async () => {
        if (cancelled) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          let value: string | undefined;
          if (detector) {
            const codes = await detector.detect(video).catch(() => []);
            value = codes[0]?.rawValue;
          } else if (jsQR && ctx) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            value = jsQR(img.data, img.width, img.height)?.data;
          }
          if (value) {
            stop();
            const match = value.match(/\/c\/([A-Za-z0-9]+)/);
            setOpen(false);
            router.push(`/tirage/aller?code=${encodeURIComponent(match?.[1] ?? value)}`);
            return;
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    function stop() {
      cancelAnimationFrame(raf);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
  }, [open, labels.unsupported, labels.denied, router]);

  if (!mounted) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setMessage(null);
          setOpen(true);
        }}
        className={className ?? "grid min-h-14 w-14 place-items-center rounded-[var(--radius)] bg-accent text-on-accent"}
        aria-label={labels.scan}
        title={labels.scan}
      >
        <Icon name="qr" size={26} />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label={labels.title} className="fixed inset-0 z-50 grid place-items-center bg-stage/80 p-4">
          <div className="grid w-full max-w-sm gap-3 rounded-[var(--radius-lg)] bg-surface p-4 text-ink">
            <div className="flex items-center justify-between">
              <p className="display text-2xl">{labels.title}</p>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="grid size-12 place-items-center rounded-full hover:bg-surface-2" aria-label={labels.close}>
                <Icon name="close" />
              </button>
            </div>
            {message ? (
              <p className="text-base">{message}</p>
            ) : (
              <>
                <video ref={videoRef} playsInline muted className="aspect-square w-full rounded-[var(--radius)] bg-stage object-cover" />
                <p className="text-sm text-ink-soft">{labels.help}</p>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
