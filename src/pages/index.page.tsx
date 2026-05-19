import { Link } from 'react-router'
import { ArrowRight, MessageSquare, Camera, Receipt } from "lucide-react";

import { PageSeo } from "@/components/seo";
import { CONFIG } from "@/config";

const DISPLAY_FONT =
  "'Source Serif 4', 'Iowan Old Style', 'Apple Garamond', Georgia, serif";

export default function IndexPage(): JSX.Element {
  return (
    <div className="flex flex-col">
      <PageSeo
        title="thriv.es movers — AI-Powered Moving Estimates in Minutes"
        description="Get AI-powered moving estimates in minutes. Snap a few photos of your belongings and receive an instant, transparent, itemized price breakdown — no in-person visit needed."
        canonical={CONFIG.canonical}
        jsonLd={{
          "@type": "WebApplication",
          name: "thriv.es movers",
          url: CONFIG.canonical,
          description:
            "AI-powered moving estimates. Snap photos of your items and get an instant, itemized moving price — no in-person visit required.",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
        }}
      />

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="px-4 pt-20 pb-20 md:pt-32 md:pb-28">
        <div className="container max-w-5xl">
          <p className="text-eyebrow mb-7">
            thriv.es movers · AI-powered estimates
          </p>

          <div className="grid md:grid-cols-[1fr_300px] gap-10 items-start">
            {/* Text side */}
            <div>
              <h1
                className="text-foreground mb-6 leading-[1.06]"
                style={{
                  fontFamily: DISPLAY_FONT,
                  fontSize: "clamp(48px, 6.5vw, 88px)",
                  fontWeight: 400,
                  fontStyle: "italic",
                }}
              >
                Your move,
                <br />
                priced in
                <br />
                minutes.
              </h1>

              <p className="text-lg text-muted-foreground max-w-md leading-relaxed mb-8">
                Snap a few photos of what you're moving. Our AI analyzes your
                items and returns an instant, itemized estimate - no in-person
                visit required.
              </p>

              <Link
                to="/estimate"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
                style={{ backgroundColor: "var(--thrive)" }}
              >
                Get your estimate
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>

            {/* Faux IDE / progress frame */}
            <div className="hidden md:block">
              <div className="frame shadow-sm">
                <div className="frame-bar">
                  <span className="frame-dot bg-red-400/60" />
                  <span className="frame-dot bg-yellow-400/60" />
                  <span className="frame-dot bg-green-400/60" />
                  <span
                    className="ml-2 text-[11px] text-muted-foreground"
                    style={{ fontFamily: "'JetBrains Mono', monospace" }}
                  >
                    estimate.tsx
                  </span>
                </div>
                <div className="p-5 space-y-3">
                  <FrameStep num="01" label="Chat about your move" done />
                  <FrameStep num="02" label="Upload photos" done />
                  <FrameStep num="03" label="Review inventory" active />
                  <FrameStep num="04" label="Get your estimate" />
                  <FrameStep num="05" label="Schedule the move" />
                  <div className="pt-3 border-t border-border">
                    <p
                      className="text-[11px] text-muted-foreground mb-2"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      → analyzing 4 images...
                    </p>
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: "62%",
                          backgroundColor: "var(--thrive)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section className="border-t border-border px-4 py-20">
        <div className="container max-w-5xl">
          <p className="text-eyebrow mb-10">How it works</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            <HowStep
              num="01"
              icon={<MessageSquare className="w-5 h-5" />}
              title="Chat"
              description="Tell us about your move - distance, floors, elevator access. Takes about two minutes."
            />
            <HowStep
              num="02"
              icon={<Camera className="w-5 h-5" />}
              title="Photograph"
              description="Upload 1–5 photos of your belongings. Any room, any angle - our AI handles the rest."
            />
            <HowStep
              num="03"
              icon={<Receipt className="w-5 h-5" />}
              title="Get your price"
              description="Receive a full itemized breakdown with a confidence rating. Schedule when you're ready."
            />
          </div>
        </div>
      </section>

      {/* ── Pull quote ──────────────────────────────────────────────────────── */}
      <section className="border-t border-border px-4 py-20">
        <div className="container max-w-3xl">
          <blockquote className="pull-quote">
            "No clipboards. No awkward walk-throughs.
            <br />
            Just photos and an answer."
          </blockquote>
        </div>
      </section>

      {/* ── CTA band ────────────────────────────────────────────────────────── */}
      <section
        className="border-t border-border px-4 py-20"
        style={{ backgroundColor: "var(--thrive-soft)" }}
      >
        <div className="container max-w-5xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h2
              className="text-foreground mb-1"
              style={{
                fontFamily: DISPLAY_FONT,
                fontSize: "clamp(28px, 3vw, 40px)",
                fontWeight: 400,
              }}
            >
              Ready for your estimate?
            </h2>
            <p className="text-muted-foreground text-base">
              It takes about five minutes.
            </p>
          </div>
          <Link
            to="/estimate"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift whitespace-nowrap"
            style={{ backgroundColor: "var(--thrive)" }}
          >
            Start for free
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────────── */

function FrameStep({
  num,
  label,
  done = false,
  active = false,
}: {
  num: string;
  label: string;
  done?: boolean;
  active?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-semibold"
        style={{
          backgroundColor: done
            ? "var(--thrive)"
            : active
              ? "var(--thrive-soft)"
              : "hsl(var(--muted))",
          color: done
            ? "#fff"
            : active
              ? "var(--thrive)"
              : "hsl(var(--muted-foreground))",
          outline: active ? `2px solid var(--thrive)` : undefined,
          outlineOffset: active ? "1px" : undefined,
        }}
      >
        {done ? "✓" : num}
      </span>
      <span
        className="text-sm"
        style={{
          fontFamily: "Inter, sans-serif",
          color: done
            ? "hsl(var(--muted-foreground))"
            : active
              ? "hsl(var(--foreground))"
              : "hsl(var(--muted-foreground))",
          fontWeight: active ? 500 : 400,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function HowStep({
  num,
  icon,
  title,
  description,
}: {
  num: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="text-eyebrow">{num}</span>
        <span style={{ color: "var(--thrive)" }}>{icon}</span>
      </div>
      <div>
        <h3
          className="text-foreground mb-2"
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "22px",
            fontWeight: 400,
          }}
        >
          {title}
        </h3>
        <p className="text-muted-foreground text-[15px] leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
