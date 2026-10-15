import type { ComponentProps } from "react";
import type { QRCodeSVG } from "qrcode.react";
import { LazyBoundary, lazyWithPreload } from "./lazyComponent";

type QrCodeProps = ComponentProps<typeof QRCodeSVG> & { size: number };

// The QR encoder is only needed for friend codes and invites, so it loads on demand.
const LazyQrCode = lazyWithPreload<QrCodeProps>(() =>
  import("qrcode.react").then((module) => module.QRCodeSVG)
);

export const preloadQrCode = LazyQrCode.preload;

/** QRCodeSVG with a blank square of the same size while the encoder loads. */
export function QrCode(props: QrCodeProps) {
  const placeholder = (
    <svg width={props.size} height={props.size} viewBox="0 0 1 1" aria-hidden="true" />
  );
  return (
    <LazyBoundary fallback={placeholder}>
      <LazyQrCode {...props} />
    </LazyBoundary>
  );
}
