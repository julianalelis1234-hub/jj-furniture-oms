"use client";

import { Printer, Share2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@/components/ui/button";

export function SlipQr({ value }: { value: string }) {
  return (
    <div className="shrink-0 bg-white p-1" aria-label="QR code to the customer status page">
      <QRCodeSVG value={value} size={96} level="M" marginSize={0} />
    </div>
  );
}

export function PrintButton() {
  return (
    <div className="ml-auto flex gap-2">
      <Button
        variant="outline"
        size="touch"
        onClick={async () => {
          const data = { title: document.title, url: window.location.origin + "/track" };
          if (navigator.share) await navigator.share(data).catch(() => undefined);
          else await navigator.clipboard?.writeText(data.url);
        }}
      >
        <Share2 aria-hidden /> Share link
      </Button>
      <Button size="touch" onClick={() => window.print()}>
        <Printer aria-hidden /> Print
      </Button>
    </div>
  );
}
