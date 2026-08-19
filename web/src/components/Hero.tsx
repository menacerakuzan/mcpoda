import { useEffect, useRef } from "react";
import { ArrowDown } from "lucide-react";
import { LiquidMetalButton } from "./LiquidMetalButton";
import { GridLines } from "./GridLines";
import { HeroNodes } from "./HeroNodes";
import { HeroCard } from "./HeroCard";

const VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260813_115057_94c3699b-0fd1-4124-bcf3-3626bb8c1f77.mp4";

export function Hero() {
  const video = useRef<HTMLVideoElement>(null);

  // Autoplay stalls when the tab starts in the background, which leaves a frozen
  // first frame. Nudge playback whenever the element is ready or becomes visible.
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    const kick = () => void el.play().catch(() => {});
    el.addEventListener("canplay", kick);
    el.addEventListener("stalled", kick);
    document.addEventListener("visibilitychange", kick);
    kick();
    return () => {
      el.removeEventListener("canplay", kick);
      el.removeEventListener("stalled", kick);
      document.removeEventListener("visibilitychange", kick);
    };
  }, []);

  return (
    <section id="top" className="relative h-[100dvh] min-h-[640px] w-full overflow-hidden bg-ink">
      <video
        ref={video}
        className="anim-fade-in pointer-events-none absolute inset-0 size-full object-cover"
        src={VIDEO}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />

      {/* the footage is bright top-left where the headline sits, so the scrim is
          weighted to that corner instead of flattening the whole frame */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(105deg, rgba(6,7,10,.9) 0%, rgba(6,7,10,.62) 34%, rgba(6,7,10,.18) 62%, rgba(6,7,10,.42) 100%)",
        }}
      />
      {/* narrow screens put the copy straight over the brightest part of the frame */}
      <div
        className="pointer-events-none absolute inset-0 md:hidden"
        style={{
          background:
            "linear-gradient(180deg, rgba(6,7,10,.88) 0%, rgba(6,7,10,.78) 42%, rgba(6,7,10,.35) 68%, rgba(6,7,10,.6) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[38%]"
        style={{ background: "linear-gradient(180deg, transparent, var(--color-ink))" }}
      />

      <div className="relative z-10 size-full">
        <GridLines />
        <HeroNodes />

        <div className="absolute top-[132px] left-5 sm:top-[150px] md:top-[178px] md:left-[35px]">
          <h1
            className="anim-fade-up max-w-[300px] font-display text-[34px] leading-[1.04] font-medium tracking-[-0.045em] text-white sm:max-w-[460px] sm:text-[48px] md:max-w-[620px] md:text-[68px]"
            style={{ animationDelay: "400ms" }}
          >
            Державні дані <span className="text-accent-soft">мовою людини</span>
          </h1>

          <p
            className="anim-fade-up mt-7 max-w-[300px] text-[15px] leading-relaxed text-[#c6cad0] sm:max-w-[420px] sm:text-[17px]"
            style={{ animationDelay: "550ms" }}
          >
            Два MCP-сервери під'єднують Prozorro і НАЗК до вашого ШІ-асистента. П'ять рядків
            у налаштуваннях, далі просто питайте звичайними словами.
          </p>
        </div>

        <div className="absolute right-5 bottom-5 left-5 flex flex-col items-start justify-between gap-6 md:right-[35px] md:bottom-[35px] md:left-[35px] md:flex-row md:items-end md:gap-0">
          <div
            className="anim-fade-up flex flex-wrap items-center gap-3"
            style={{ animationDelay: "900ms" }}
          >
            <LiquidMetalButton href="#setup">Підключити за 2 хвилини</LiquidMetalButton>
            <a
              href="#asks"
              className="inline-flex h-13 items-center gap-2 rounded-full border border-white/18 px-7 text-[15px] font-semibold text-fg backdrop-blur-sm transition-colors hover:border-white/35 hover:bg-white/5"
            >
              Приклади запитів
              <ArrowDown className="size-4" strokeWidth={1.75} />
            </a>
          </div>

          <HeroCard />
        </div>
      </div>
    </section>
  );
}
