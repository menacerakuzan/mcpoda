import { useEffect, useRef, useState } from "react";
import {
  ShaderMount,
  liquidMetalFragmentShader,
  getShaderColorFromString,
} from "@paper-design/shaders";

type Props = {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
};

const IDLE_SPEED = 0.9;
const HOVER_SPEED = 1.6;
const PRESS_SPEED = 2.6;
/** Reduced motion still gets a drift, just slow enough not to pull the eye. */
const CALM_SPEED = 0.25;

/**
 * Primary CTA. The metal sheen is a real WebGL shader, so the button reads as
 * the most alive thing on the page: it is the one action we want people to take.
 * Everything else on the page stays still.
 */
export function LiquidMetalButton({ children, href, onClick, className = "" }: Props) {
  const shaderHost = useRef<HTMLSpanElement>(null);
  const mount = useRef<ShaderMount | null>(null);
  const idle = useRef(IDLE_SPEED);
  const [pressed, setPressed] = useState(false);
  /** Set when WebGL is unavailable or the shader refuses to compile. */
  const [plain, setPlain] = useState(false);

  useEffect(() => {
    const host = shaderHost.current;
    if (!host) return;

    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    idle.current = calm.matches ? CALM_SPEED : IDLE_SPEED;

    // A browser that cannot give us WebGL — an old Safari, a machine with the
    // GPU blocked, a user in a low-power mode — must still get a button that
    // looks deliberate rather than an empty rim, and the failure must not take
    // the rest of the effect down with it.
    let instance: ShaderMount;
    try {
      instance = new ShaderMount(
        host,
        liquidMetalFragmentShader,
        {
          u_colorBack: getShaderColorFromString("#132a6b"),
          u_colorTint: getShaderColorFromString("#8fb0ff"),
          u_image: undefined,
          u_isImage: false,
          u_repetition: 3.4,
          u_softness: 0.62,
          u_shiftRed: 0.28,
          u_shiftBlue: 0.34,
          u_contour: 0.42,
          u_distortion: 0.12,
          u_angle: 42,
          u_shape: 0,
          u_fit: 2,
          u_scale: 0.9,
          u_rotation: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_offsetX: 0.08,
          u_offsetY: -0.08,
          u_worldWidth: 0,
          u_worldHeight: 0,
        },
        undefined,
        idle.current,
      );
    } catch {
      setPlain(true);
      return;
    }

    mount.current = instance;

    // The mount stops its own loop when the tab hides or the element scrolls out
    // of view. Without this it can come back parked on a still frame.
    const resume = () => instance.setSpeed?.(idle.current);
    const onPreferenceChange = () => {
      idle.current = calm.matches ? CALM_SPEED : IDLE_SPEED;
      resume();
    };
    document.addEventListener("visibilitychange", resume);
    calm.addEventListener("change", onPreferenceChange);

    return () => {
      document.removeEventListener("visibilitychange", resume);
      calm.removeEventListener("change", onPreferenceChange);
      instance.dispose();
      mount.current = null;
    };
  }, []);

  const speed = (value: number) => mount.current?.setSpeed?.(value);

  const Tag = href ? "a" : "button";

  return (
    <Tag
      href={href}
      onClick={onClick}
      onMouseEnter={() => speed(HOVER_SPEED)}
      onMouseLeave={() => {
        setPressed(false);
        speed(idle.current);
      }}
      onPointerDown={() => {
        setPressed(true);
        speed(PRESS_SPEED);
      }}
      onPointerUp={(e) => {
        setPressed(false);
        // touch has no hover to fall back to, so settle straight to idle there
        speed(e.pointerType === "mouse" ? HOVER_SPEED : idle.current);
      }}
      className={`group relative inline-flex h-13 items-center justify-center overflow-hidden rounded-full px-8 transition-transform duration-200 ${
        pressed ? "scale-[0.985]" : "hover:-translate-y-0.5"
      } ${className}`}
      style={{
        boxShadow: pressed
          ? "inset 0 2px 6px rgba(0,0,0,.5), 0 0 0 1px rgba(109,143,255,.35)"
          : "0 0 0 1px rgba(109,143,255,.35), 0 10px 30px -12px rgba(61,107,255,.75)",
      }}
    >
      {/* the metal lives in the rim; the face stays dark so the label keeps its contrast */}
      <span
        ref={shaderHost}
        className="shader-pill absolute inset-0 rounded-full"
        // Without WebGL the rim would be empty and the button would read as
        // broken, so it falls back to a static sheen in the same colours.
        style={
          plain
            ? { background: "linear-gradient(135deg, #2d4a9e 0%, #8fb0ff 45%, #132a6b 100%)" }
            : undefined
        }
      />
      <span
        className="pointer-events-none absolute inset-[1.5px] rounded-full"
        style={{
          background: "linear-gradient(180deg, #1b2130 0%, #05070c 100%)",
          boxShadow: pressed
            ? "inset 0 2px 5px rgba(0,0,0,.55)"
            : "inset 0 1px 0 rgba(255,255,255,.09)",
        }}
      />
      <span className="pointer-events-none relative z-10 text-[15px] font-semibold tracking-tight text-white">
        {children}
      </span>
    </Tag>
  );
}
