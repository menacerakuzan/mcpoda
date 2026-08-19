/**
 * Chamfered note in the corner of the hero. It carries the honest framing early,
 * before anyone scrolls: this is a pipe to public data, not a verdict machine.
 */
export function HeroCard() {
  return (
    <div className="anim-slide-right hidden max-w-[300px] sm:block" style={{ animationDelay: "1100ms" }}>
      <span className="mb-[10px] inline-block bg-accent px-[6px] py-[2px] text-[12.5px] leading-[15.6px] font-medium text-white">
        БЕЗКОШТОВНО, БЕЗ РЕЄСТРАЦІЇ
      </span>

      <div className="relative p-[20px]">
        <svg
          className="pointer-events-none absolute inset-0 size-full"
          viewBox="0 0 300 168"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            points="0.5,0.5 299.5,0.5 299.5,167.5 30,167.5 0.5,137.5"
            fill="none"
            stroke="#6d8fff"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <p className="relative mb-[18px] text-[13px] leading-[18px] text-white">
          Ми не робимо власний ШІ і не збираємо нічого понад те, що держава вже опублікувала.
          Інструмент показує факти, висновок робить людина.
        </p>
        <a
          href="#limits"
          className="relative text-[13px] leading-[15.6px] text-accent-soft hover:underline"
        >
          ЧОГО ПРОЯВ НЕ РОБИТЬ
        </a>
      </div>
    </div>
  );
}
