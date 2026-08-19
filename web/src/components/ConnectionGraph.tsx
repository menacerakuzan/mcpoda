import { useEffect, useRef, useState } from "react";
// type-only: erased at build time, so three.js stays out of the main bundle
import type * as THREE from "three";
import { Reveal } from "./Reveal";

const COLORS = {
  buyer: 0xffffff,
  supplier: 0x8f9aa6,
  person: 0x3d6bff,
};

/**
 * A rotating 3D view of the kind of graph the assistant produces: buyers, the
 * suppliers bidding on their tenders, and the people who show up inside several
 * of those suppliers at once. three.js is loaded only when the section comes
 * into view, so it never sits in the critical path of the landing page.
 */
export function ConnectionGraph() {
  const host = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let dispose: (() => void) | undefined;
    let cancelled = false;

    const start = async () => {
      const [three, { buildGraph }] = await Promise.all([
        import("three") as Promise<typeof THREE>,
        import("./graph-data"),
      ]);
      if (cancelled) return;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const { nodes, edges } = buildGraph();

      const scene = new three.Scene();
      const camera = new three.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0, 26);

      const renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      el.appendChild(renderer.domElement);
      renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y";

      const world = new three.Group();
      scene.add(world);

      // edges
      const plain: number[] = [];
      const flagged: number[] = [];
      edges.forEach((e) => {
        const a = nodes[e.a];
        const b = nodes[e.b];
        const target = e.flagged ? flagged : plain;
        target.push(a.x, a.y, a.z, b.x, b.y, b.z);
      });

      const makeLines = (points: number[], color: number, opacity: number) => {
        const geometry = new three.BufferGeometry();
        geometry.setAttribute("position", new three.Float32BufferAttribute(points, 3));
        const material = new three.LineBasicMaterial({ color, transparent: true, opacity });
        const lines = new three.LineSegments(geometry, material);
        world.add(lines);
        return { geometry, material };
      };

      const linePlain = makeLines(plain, 0xffffff, 0.2);
      const lineFlagged = makeLines(flagged, 0x3d6bff, 0.75);

      // nodes, one instanced mesh per kind so each keeps its own size and colour
      const nodeGeometry = new three.IcosahedronGeometry(1, 1);
      const instanced: THREE.InstancedMesh[] = [];
      const materials: THREE.Material[] = [];

      (["buyer", "supplier", "person"] as const).forEach((kind) => {
        const subset = nodes.filter((n) => n.kind === kind);
        if (!subset.length) return;
        const scale = kind === "buyer" ? 0.55 : kind === "person" ? 0.45 : 0.27;
        const material = new three.MeshBasicMaterial({
          color: COLORS[kind],
          transparent: true,
          opacity: kind === "supplier" ? 0.75 : 1,
        });
        const mesh = new three.InstancedMesh(nodeGeometry, material, subset.length);
        const matrix = new three.Matrix4();
        subset.forEach((n, i) => {
          matrix.makeScale(scale, scale, scale);
          matrix.setPosition(n.x, n.y, n.z);
          mesh.setMatrixAt(i, matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
        world.add(mesh);
        instanced.push(mesh);
        materials.push(material);
      });

      // centre the graph on its own bounding sphere and pull the camera back far
      // enough that no node leaves the frame at any rotation
      const bounds = new three.Box3().setFromPoints(
        nodes.map((n) => new three.Vector3(n.x, n.y, n.z)),
      );
      const bounding = bounds.getBoundingSphere(new three.Sphere());
      world.position.set(-bounding.center.x, -bounding.center.y, -bounding.center.z);

      const fitDistance = (aspect: number) => {
        const vFov = (camera.fov * Math.PI) / 180;
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
        const fov = Math.min(vFov, hFov);
        return (bounding.radius / Math.sin(fov / 2)) * 0.98;
      };

      const resize = () => {
        const { clientWidth: w, clientHeight: h } = el;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.position.z = fitDistance(camera.aspect);
        camera.updateProjectionMatrix();
      };
      resize();
      const observer = new ResizeObserver(resize);
      observer.observe(el);

      // drag to turn it, otherwise it drifts on its own
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      let velocityX = reduced ? 0 : 0.0016;
      let velocityY = 0;

      const onDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        renderer.domElement.setPointerCapture(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        velocityX = (e.clientX - lastX) * 0.0009;
        velocityY = (e.clientY - lastY) * 0.0009;
        lastX = e.clientX;
        lastY = e.clientY;
      };
      const onUp = () => {
        dragging = false;
      };

      renderer.domElement.addEventListener("pointerdown", onDown);
      renderer.domElement.addEventListener("pointermove", onMove);
      renderer.domElement.addEventListener("pointerup", onUp);
      renderer.domElement.addEventListener("pointercancel", onUp);

      world.rotation.set(0.28, 0.4, 0);

      let frame = 0;
      let visible = true;
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
      });
      io.observe(el);

      const tick = () => {
        frame = requestAnimationFrame(tick);
        if (!visible) return;
        if (!dragging) {
          velocityX += ((reduced ? 0 : 0.0016) - velocityX) * 0.03;
          velocityY *= 0.94;
        }
        world.rotation.y += velocityX;
        world.rotation.x = Math.max(-0.7, Math.min(0.7, world.rotation.x + velocityY));
        renderer.render(scene, camera);
      };
      tick();
      setReady(true);

      dispose = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        io.disconnect();
        renderer.domElement.removeEventListener("pointerdown", onDown);
        renderer.domElement.removeEventListener("pointermove", onMove);
        renderer.domElement.removeEventListener("pointerup", onUp);
        renderer.domElement.removeEventListener("pointercancel", onUp);
        [linePlain, lineFlagged].forEach(({ geometry, material }) => {
          geometry.dispose();
          material.dispose();
        });
        instanced.forEach((m) => m.dispose());
        materials.forEach((m) => m.dispose());
        nodeGeometry.dispose();
        renderer.dispose();
        el.removeChild(renderer.domElement);
      };
    };

    // only pay for three.js once the section is actually approaching
    const trigger = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          trigger.disconnect();
          void start();
        }
      },
      { rootMargin: "300px" },
    );
    trigger.observe(el);

    return () => {
      cancelled = true;
      trigger.disconnect();
      dispose?.();
    };
  }, []);

  return (
    <section className="border-t border-line py-24 sm:py-32">
      <div className="mx-auto max-w-[1240px] px-5 sm:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
          <Reveal>
            <h2 className="max-w-[18ch] font-display text-[clamp(26px,3.6vw,44px)] leading-[1.12] font-medium tracking-[-0.038em]">
              Зв'язки, які видно лише разом
            </h2>
            <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-dim">
              Замовник, постачальники з його торгів і люди, які фігурують одразу в кількох
              із цих компаній. Кожен реєстр окремо цього не показує, а разом видно структуру.
            </p>

            <ul className="mt-8 flex flex-col gap-3 text-[14.5px] text-dim">
              <li className="flex items-center gap-3">
                <span className="size-2.5 rounded-full bg-white" />
                Замовник
              </li>
              <li className="flex items-center gap-3">
                <span className="size-2.5 rounded-full bg-[#8f9aa6]" />
                Учасники торгів
              </li>
              <li className="flex items-center gap-3">
                <span className="size-2.5 rounded-full bg-accent" />
                Особа у кількох компаніях одночасно
              </li>
            </ul>

            <p className="mt-8 max-w-[48ch] font-mono text-[12px] leading-relaxed text-dim">
              Схема ілюстративна і побудована на згенерованих даних. Збіг у складі засновників
              сам собою не є порушенням, це лише привід подивитись уважніше.
            </p>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="relative overflow-hidden rounded-2xl border border-line bg-ink-2">
              <div ref={host} className="h-[380px] w-full sm:h-[460px]" />
              {!ready && (
                <div className="absolute inset-0 grid place-items-center font-mono text-[12px] text-dim">
                  побудова графа
                </div>
              )}
              <span className="pointer-events-none absolute right-4 bottom-4 font-mono text-[11px] text-dim">
                потягніть, щоб обертати
              </span>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
