import { ArrowRight } from "lucide-react";

interface IntroStepProps {
  onNext: () => void;
}

const DISPLAY_FONT = "'Source Serif 4', 'Iowan Old Style', Georgia, serif";

const STEPS = [
  {
    num: "01",
    label: "Chat",
    desc: "Tell us about your move - distance, floors, and elevator access.",
  },
  {
    num: "02",
    label: "Photograph",
    desc: "Upload 1–5 photos of your belongings. AI handles the inventory.",
  },
  {
    num: "03",
    label: "Review",
    desc: "Check the detected items and adjust anything that looks off.",
  },
  {
    num: "04",
    label: "Estimate",
    desc: "Receive a full itemized price with confidence rating.",
  },
  {
    num: "05",
    label: "Schedule",
    desc: "Book your moving date when you're ready to proceed.",
  },
];

export function IntroStep({ onNext }: IntroStepProps): JSX.Element {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-eyebrow mb-4">thriv.es movers</p>
        <h1
          className="text-foreground leading-tight mb-3"
          style={{
            fontFamily: DISPLAY_FONT,
            fontSize: "32px",
            fontWeight: 400,
            fontStyle: "italic",
          }}
        >
          Get your moving estimate
        </h1>
        <p className="text-muted-foreground text-[15px] leading-relaxed">
          This takes about five minutes. We'll walk you through everything.
        </p>
      </div>

      {/* Steps list */}
      <ol className="space-y-4">
        {STEPS.map((s) => (
          <li key={s.num} className="flex gap-4 items-start">
            <span
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold mt-0.5"
              style={{
                backgroundColor: "var(--thrive-soft)",
                color: "var(--thrive)",
              }}
            >
              {s.num}
            </span>
            <div>
              <p
                className="text-foreground font-medium text-sm mb-0.5"
                style={{
                  fontFamily: DISPLAY_FONT,
                  fontStyle: "italic",
                  fontWeight: 500,
                }}
              >
                {s.label}
              </p>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {s.desc}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {/* CTA */}
      <button
        onClick={onNext}
        className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-medium text-base text-white btn-lift"
        style={{ backgroundColor: "var(--thrive)" }}
      >
        Get started
        <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  );
}
