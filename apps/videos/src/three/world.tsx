import React, { useMemo } from "react";
import { useThree } from "@react-three/fiber";
import { ThreeCanvas } from "@remotion/three";
import { continueRender, delayRender, useVideoConfig } from "remotion";
import * as THREE from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { C, clamp01, mix, rand, ramp } from "../theme";
// The boule of the landing page (task V2): smooth, very dark silver, engraved « ORGASPORT ».
import { REST_SPIN, createEnvironment, poseBall, steelMaterial, type StageColors } from "../../../web/src/components/vitrine/ballModel";

/* ======================================================================== */
/* Shared helpers                                                            */
/* ======================================================================== */

export type V3 = [number, number, number];
const v = (p: V3) => new THREE.Vector3(p[0], p[1], p[2]);

/** Smooth camera / object track through timed keys (Catmull-Rom, ease at the ends). */
export function track(keys: Array<[number, V3]>, t: number): V3 {
  if (t <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (t >= last[0]) return last[1];
  let i = 1;
  while (keys[i][0] < t) i++;
  const [t0, p0] = keys[i - 1];
  const [t1, p1] = keys[i];
  const u = (t - t0) / (t1 - t0);
  const tan = (j: number): V3 => {
    if (j <= 0 || j >= keys.length - 1) return [0, 0, 0];
    const [ta, pa] = keys[j - 1];
    const [tb, pb] = keys[j + 1];
    const d = (t1 - t0) / (tb - ta);
    return [(pb[0] - pa[0]) * d, (pb[1] - pa[1]) * d, (pb[2] - pa[2]) * d];
  };
  const m0 = tan(i - 1);
  const m1 = tan(i);
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1;
  const h10 = u ** 3 - 2 * u ** 2 + u;
  const h01 = -2 * u ** 3 + 3 * u ** 2;
  const h11 = u ** 3 - u ** 2;
  return [0, 1, 2].map((k) => h00 * p0[k] + h10 * m0[k] + h01 * p1[k] + h11 * m1[k]) as V3;
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, srgb = true) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, ctx, canvas };
}

let cache: Record<string, THREE.Texture> = {};
function cached(key: string, make: () => THREE.Texture) {
  if (!cache[key]) cache[key] = make();
  return cache[key];
}

/** Soft line profile (bright in the middle) for the glow of the lines. */
const lineGlowTex = () =>
  cached("lineGlow", () =>
    canvasTexture(4, 64, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, "#000");
      g.addColorStop(0.5, "#fff");
      g.addColorStop(1, "#000");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 4, 64);
    }).tex,
  );

/** Round glow sprite (points, halos). */
const dotTex = () =>
  cached("dot", () =>
    canvasTexture(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.8)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }).tex,
  );

/**
 * Night stadium used as reflection map for the metal: black ground, blue horizon
 * haze, white softboxes (projectors) and a few blue light strips. No warm colors.
 */
const envTex = () =>
  cached("env", () => {
    const { tex } = canvasTexture(1024, 512, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, "#e4e8f0");
      g.addColorStop(0.22, "#8c94a8");
      g.addColorStop(0.44, "#2c3446");
      g.addColorStop(0.5, "#56648c");
      g.addColorStop(0.56, "#151922");
      g.addColorStop(0.75, "#07080c");
      g.addColorStop(1, "#030305");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 1024, 512);
      ctx.filter = "blur(5px)";
      ctx.fillStyle = "#ffffff";
      for (let k = 0; k < 6; k++) ctx.fillRect(k * 170 + 30, 70 + (k % 2) * 34, 96, 30);
      ctx.fillRect(380, 8, 260, 22);
      ctx.fillStyle = "#cfe0ff";
      ctx.fillRect(60, 236, 380, 12);
      ctx.fillStyle = "#4d7cff";
      ctx.fillRect(520, 232, 440, 16);
      ctx.fillStyle = "#2bb4ff";
      for (let k = 0; k < 5; k++) ctx.fillRect(0, 300 + k * 34, 1024, 3);
      ctx.filter = "none";
    });
    tex.mapping = THREE.EquirectangularReflectionMapping;
    return tex;
  });

/** Panel of the 3D bracket: rounded frame + accent block. */
const panelTex = () =>
  cached("panel", () =>
    canvasTexture(256, 80, (ctx) => {
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.roundRect(4, 4, 248, 72, 16);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.roundRect(14, 18, 8, 44, 4);
      ctx.fill();
    }).tex,
  );

/**
 * Atlas of the numbers 1–64 (8×8 cells) drawn with Saira. Waits for the font
 * (delayRender) so the very first frame already uses it.
 */
const numberAtlas = () =>
  cached("numbers", () => {
    const draw = (ctx: CanvasRenderingContext2D) => {
      ctx.clearRect(0, 0, 1024, 1024);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = "800 96px Saira";
      for (let i = 0; i < 64; i++) ctx.fillText(String(i + 1), (i % 8) * 128 + 64, Math.floor(i / 8) * 128 + 70);
    };
    const made = canvasTexture(1024, 1024, () => undefined);
    const redraw = () => {
      draw(made.ctx);
      made.tex.needsUpdate = true;
    };
    if (document.fonts.check("800 96px Saira")) redraw();
    else {
      const handle = delayRender("number atlas font");
      document.fonts.load("800 96px Saira").then(() => {
        redraw();
        continueRender(handle);
      });
    }
    return made.tex;
  });

/* ======================================================================== */
/* Canvas, scene setup, camera                                               */
/* ======================================================================== */

export function Stage3D({ children }: { children: React.ReactNode }) {
  const { width, height } = useVideoConfig();
  const vertical = height > width;
  return (
    <ThreeCanvas
      width={width}
      height={height}
      dpr={1}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      camera={{ fov: vertical ? 68 : 40, near: 0.1, far: 600, position: [0, 5, 10] }}
      style={{ background: C.stage }}
    >
      <SceneSetup />
      {children}
    </ThreeCanvas>
  );
}

function SceneSetup() {
  const scene = useThree((s) => s.scene);
  useMemo(() => {
    scene.background = new THREE.Color(C.stage);
    scene.environment = envTex();
    scene.fog = new THREE.FogExp2(C.stage, 0.016);
  }, [scene]);
  return (
    <>
      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 8, 6]} intensity={1.6} color="#dfe6ff" />
    </>
  );
}

/** Places the camera every frame. */
export function Cam({ pos, look, fog }: { pos: V3; look: V3; fog?: number }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  camera.position.set(...pos);
  camera.lookAt(...look);
  if (fog !== undefined && scene.fog instanceof THREE.FogExp2) scene.fog.density = fog;
  return null;
}

/** Reflective floor: a half-resolution mirror under a dark translucent veil. */
export function Floor({ veil = 0.8 }: { veil?: number }) {
  const { width, height } = useVideoConfig();
  const mirror = useMemo(() => {
    const m = new Reflector(new THREE.PlaneGeometry(600, 600), {
      textureWidth: Math.round(width / 2),
      textureHeight: Math.round(height / 2),
      color: 0x8890b0,
    });
    m.rotation.x = -Math.PI / 2;
    // Anti-flicker: the mirror and its veil are drawn first and never write depth, so the
    // lines, numbers and halos laid a few millimetres above them can't z-fight with them
    // in the distance (nothing in the scene is ever below the floor).
    (m.material as THREE.Material).depthWrite = false;
    return m;
  }, [width, height]);
  return (
    <>
      <primitive object={mirror} renderOrder={-2} />
      <mesh rotation-x={-Math.PI / 2} position-y={0.003} renderOrder={-1}>
        <planeGeometry args={[600, 600]} />
        <meshBasicMaterial color={C.stage} transparent opacity={veil} depthWrite={false} />
      </mesh>
    </>
  );
}

/* ======================================================================== */
/* Glowing bars (terrain lines, bracket connectors, map outline)             */
/* ======================================================================== */

export type Bar = { a: V3; b: V3; n?: V3 };

/**
 * Anti-flicker for thin neon lines: a bar is never drawn thinner than `uMinPx`
 * pixels on screen. When it would be, the quad is widened to that width and its
 * light is divided by the same factor (additive blending: same total light), so a
 * distant line stays a steady faint line instead of popping in and out between
 * pixels while the camera moves.
 */
function withMinWidth(mat: THREE.MeshBasicMaterial, minPx: number, res: { value: THREE.Vector2 }) {
  mat.onBeforeCompile = (s) => {
    s.uniforms.uRes = res;
    s.uniforms.uMinPx = { value: minPx };
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nuniform vec2 uRes;\nuniform float uMinPx;\nvarying float vOsFade;")
      .replace(
        "#include <project_vertex>",
        `vec4 osA = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed.x, 0.0, 0.0, 1.0);
        vec4 osB = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed.x, 1.0, 0.0, 1.0);
        float osPx = length((osB.xy / max(osB.w, 1e-3) - osA.xy / max(osA.w, 1e-3)) * uRes * 0.5);
        float osK = clamp(uMinPx / max(osPx, 1e-4), 1.0, 40.0);
        transformed.y *= osK;
        vOsFade = 1.0 / osK;
        #include <project_vertex>`,
      );
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vOsFade;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= vOsFade;");
  };
  mat.customProgramCacheKey = () => `osMinWidth${mat.map ? "Map" : ""}`;
  return mat;
}

/**
 * Instanced glowing bars: a thin core and a wide soft glow. `bright[i]` (0–1+)
 * and `grow[i]` (0–1, drawn from `a` to `b`) are updated every frame.
 */
export function Bars({
  bars,
  bright,
  grow,
  color,
  core = 0.07,
  glow = 0.7,
  glowStrength = 0.45,
}: {
  bars: Bar[];
  bright: ArrayLike<number>;
  grow?: ArrayLike<number>;
  color: string;
  core?: number;
  glow?: number;
  glowStrength?: number;
}) {
  const size = useThree((st) => st.size);
  const res = useMemo(() => ({ value: new THREE.Vector2() }), []);
  res.value.set(size.width, size.height);
  const meshes = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const coreMat = new THREE.MeshBasicMaterial({
      color: "#ffffff",
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const glowMat = coreMat.clone();
    glowMat.map = lineGlowTex();
    withMinWidth(coreMat, 1.5, res);
    withMinWidth(glowMat, 4, res);
    const a = new THREE.InstancedMesh(geo, coreMat, bars.length);
    const b = new THREE.InstancedMesh(geo, glowMat, bars.length);
    for (const m of [a, b]) {
      m.frustumCulled = false;
      for (let i = 0; i < bars.length; i++) m.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    return { a, b };
  }, [bars, res]);
  const base = new THREE.Color(color);
  const tmp = new THREE.Color();
  const mat = new THREE.Matrix4();
  const X = new THREE.Vector3();
  const Y = new THREE.Vector3();
  const Z = new THREE.Vector3();
  bars.forEach((bar, i) => {
    const g = grow ? grow[i] : 1;
    const A = v(bar.a);
    const B = v(bar.b);
    const len = A.distanceTo(B);
    X.subVectors(B, A).normalize();
    Z.set(...(bar.n ?? [0, 1, 0]));
    Y.crossVectors(Z, X).normalize();
    const mid = A.clone().addScaledVector(X, (len * g) / 2);
    for (const [mesh, w, s] of [
      [meshes.a, core, 1],
      [meshes.b, glow, glowStrength],
    ] as const) {
      mat.makeBasis(X, Y, Z);
      mat.scale(new THREE.Vector3(Math.max(0.0001, len * g + (mesh === meshes.b ? w * 0.5 : core)), w, 1));
      mat.setPosition(mid);
      mesh.setMatrixAt(i, mat);
      tmp.copy(base).multiplyScalar(bright[i] * s * (g > 0 ? 1 : 0));
      mesh.setColorAt(i, tmp);
    }
  });
  for (const m of [meshes.a, meshes.b]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  return (
    <>
      <primitive object={meshes.b} />
      <primitive object={meshes.a} />
    </>
  );
}

/** Instanced labels from the number atlas (value 1–64), facing `normal`. */
function Labels({
  items,
  lit,
  color,
  size,
  flat,
}: {
  items: Array<{ pos: V3; value: number }>;
  lit: ArrayLike<number>;
  color: string;
  size: number;
  flat?: boolean;
}) {
  const mesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const cell = new Float32Array(items.length);
    const litAttr = new Float32Array(items.length);
    items.forEach((it, i) => (cell[i] = it.value - 1));
    geo.setAttribute("aCell", new THREE.InstancedBufferAttribute(cell, 1));
    geo.setAttribute("aLit", new THREE.InstancedBufferAttribute(litAttr, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: numberAtlas() }, color: { value: new THREE.Color(color) } },
      vertexShader: `attribute float aCell; attribute float aLit; varying vec2 vUv; varying float vLit;
        void main(){ float col = mod(aCell, 8.0); float row = floor(aCell / 8.0);
          vUv = vec2((uv.x + col) / 8.0, (uv.y + 7.0 - row) / 8.0); vLit = aLit;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D map; uniform vec3 color; varying vec2 vUv; varying float vLit;
        void main(){ float a = texture2D(map, vUv).a; gl_FragColor = vec4(color * a * vLit, 1.0); }`,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    const m = new THREE.InstancedMesh(geo, mat, items.length);
    m.frustumCulled = false;
    const mtx = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(flat ? -Math.PI / 2 : 0);
    items.forEach((it, i) => {
      mtx.makeScale(size, size, 1).premultiply(rot).setPosition(...it.pos);
      m.setMatrixAt(i, mtx);
    });
    return m;
  }, [items, color, size, flat]);
  const attr = mesh.geometry.getAttribute("aLit") as THREE.InstancedBufferAttribute;
  for (let i = 0; i < items.length; i++) attr.setX(i, lit[i]);
  attr.needsUpdate = true;
  return <primitive object={mesh} />;
}

/** Floating luminous dust around a point. */
export function Dust3D({ t, center = [0, 0, 0], size = [40, 10, 40], count = 260, color = "#cdd6ff" }: { t: number; center?: V3; size?: V3; count?: number; color?: string }) {
  const pts = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: dotTex(),
      color,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    // A grain that drifts right past the lens grows to a big soft blob for one or
    // two frames and reads as a flash (seen in the 9:16 cut, wider field of view):
    // grains fade out smoothly as they come closer than a few metres to the camera.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying float vNearFade;")
        .replace("#include <project_vertex>", "#include <project_vertex>\nvNearFade = smoothstep(2.0, 5.0, -mvPosition.z);");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vNearFade;")
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.a *= vNearFade;");
    };
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    return p;
  }, [count, color]);
  const arr = (pts.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  for (let i = 0; i < count; i++) {
    // Slow, steady drift (no wrap-around: a grain never pops in or out of the frame).
    arr[i * 3] = center[0] + (rand(i) - 0.5) * size[0] + Math.sin(t * 0.4 + i) * 0.3;
    arr[i * 3 + 1] = center[1] + rand(i + 7) * size[1] + t * (0.04 + rand(i + 3) * 0.08);
    arr[i * 3 + 2] = center[2] + (rand(i + 13) - 0.5) * size[2];
  }
  pts.geometry.getAttribute("position").needsUpdate = true;
  return <primitive object={pts} />;
}

/**
 * The steel of the landing page's boule, lit by the same neutral grey studio
 * (createEnvironment), built once per renderer and shared by every boule.
 */
const steelByRenderer = new WeakMap<THREE.WebGLRenderer, THREE.MeshStandardMaterial>();
function useSteel() {
  const gl = useThree((s) => s.gl);
  let mat = steelByRenderer.get(gl);
  if (!mat) {
    mat = steelMaterial(1024, gl.capabilities.getMaxAnisotropy()).material;
    const colors: StageColors = {
      stage: new THREE.Color(C.stage),
      light: new THREE.Color(C.ink),
      line: new THREE.Color(C.blueSoft),
      haze: new THREE.Color(C.haze),
      accent: new THREE.Color(C.blueSoft),
    };
    mat.envMap = createEnvironment(gl, colors).texture;
    mat.emissive = new THREE.Color(C.accent);
    steelByRenderer.set(gl, mat);
  }
  return mat;
}

/** A pétanque boule (the one of the landing page). `rot`: spin around its axis; `glow`: blue emissive. */
export function Boule({ pos, radius = 0.5, rot = 0, glow = 0 }: { pos: V3; radius?: number; rot?: number; glow?: number }) {
  const mat = useSteel();
  const pose = useMemo(() => new THREE.Mesh(), []);
  poseBall(pose, REST_SPIN + rot);
  mat.emissiveIntensity = glow;
  return (
    <mesh position={pos} quaternion={pose.quaternion.clone()} scale={radius} material={mat}>
      <sphereGeometry args={[1, 128, 96]} />
    </mesh>
  );
}

/* ======================================================================== */
/* The boulodrome: 32 terrains (8 × 4), numbers and players                  */
/* ======================================================================== */

const TW = 3;
const TL = 12;
export const terrainCenter = (i: number): V3 => [((i % 8) - 3.5) * 4, 0, (Math.floor(i / 8) - 1.5) * 14];
const T12 = terrainCenter(11);

function rectBars(c: V3, w: number, l: number): Bar[] {
  const [x, , z] = c;
  const y = 0.012;
  return [
    { a: [x - w / 2, y, z - l / 2], b: [x + w / 2, y, z - l / 2] },
    { a: [x + w / 2, y, z - l / 2], b: [x + w / 2, y, z + l / 2] },
    { a: [x + w / 2, y, z + l / 2], b: [x - w / 2, y, z + l / 2] },
    { a: [x - w / 2, y, z + l / 2], b: [x - w / 2, y, z - l / 2] },
  ];
}

export const TERRAIN_BARS: Bar[] = Array.from({ length: 32 }, (_, i) => rectBars(terrainCenter(i), TW, TL)).flat();
const NUMBER_ITEMS = Array.from({ length: 32 }, (_, i) => {
  const c = terrainCenter(i);
  return { pos: [c[0], 0.02, c[2] + TL / 2 + 1.1] as V3, value: i + 1 };
});

/** Players as luminous sticks (instanced capsules). */
function Players({ on, t }: { on: ArrayLike<number>; t: number }) {
  const mesh = useMemo(() => {
    const geo = new THREE.CapsuleGeometry(0.12, 1.1, 2, 6);
    geo.translate(0, 0.67, 0);
    const mat = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
    const m = new THREE.InstancedMesh(geo, mat, 128);
    m.frustumCulled = false;
    for (let i = 0; i < 128; i++) m.setColorAt(i, new THREE.Color(i % 4 < 2 ? C.accentInk : C.blueInk));
    return m;
  }, []);
  const mtx = new THREE.Matrix4();
  for (let i = 0; i < 128; i++) {
    const tIdx = Math.floor(i / 4);
    const c = terrainCenter(tIdx);
    const side = i % 4 < 2 ? -1 : 1;
    const k = on[tIdx];
    const x = c[0] + (i % 2 ? 0.55 : -0.55) + Math.sin(t * 1.3 + i) * 0.12;
    const z = c[2] + side * (4.6 + rand(i) * 0.8);
    mtx.makeScale(1, Math.max(0.001, k), 1).setPosition(x, 0, z);
    mesh.setMatrixAt(i, mtx);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return <primitive object={mesh} />;
}

export function Boulodrome({ lines, on, t, color = C.blueSoft, numbers = true }: { lines: ArrayLike<number>; on: ArrayLike<number>; t: number; color?: string; numbers?: boolean }) {
  const bright = new Float32Array(TERRAIN_BARS.length);
  for (let i = 0; i < TERRAIN_BARS.length; i++) bright[i] = lines[Math.floor(i / 4)];
  return (
    <>
      <Bars bars={TERRAIN_BARS} bright={bright} color={color} />
      {numbers ? <Labels items={NUMBER_ITEMS} lit={on} color={C.accentInk} size={1.9} flat /> : null}
      <Players on={on} t={t} />
    </>
  );
}

/* ======================================================================== */
/* Scene 1: the ball drops, the boulodrome lights up, flyover (0–14 s)       */
/* ======================================================================== */

export function WorldScene({ t, mode, vertical }: { t: number; mode: "drop" | "title" | "outro"; vertical: boolean }) {
  const lines = new Float32Array(32);
  const on = new Float32Array(32);
  let cam: V3;
  let look: V3;
  let ball: V3 | null = null;
  let wave = -1;
  const impact = 2.4;
  if (mode === "drop") {
    wave = t > impact ? (t - impact) * 15 : -1;
    for (let i = 0; i < 32; i++) {
      const c = terrainCenter(i);
      const d = Math.hypot(c[0] - T12[0], c[2] - T12[2]);
      const w = wave < 0 ? 0 : clamp01((wave - d + 3) / 5);
      on[i] = i === 11 ? ramp(t, impact, impact + 0.6) : ramp(t, 6.4 + i * 0.11, 6.4 + i * 0.11 + 0.4);
      lines[i] = 0.4 * w + 0.8 * on[i];
    }
    const fall = clamp01(t / impact);
    const y = t < impact ? 5.6 - 5.1 * fall * fall : 0.5 + Math.max(0, Math.sin((Math.PI * (t - impact)) / 0.7)) * 0.3 * (t < impact + 0.7 ? 1 : 0);
    ball = [T12[0], y, T12[2]];
    const far = vertical ? 1.35 : 1;
    cam = track(
      [
        [0, [T12[0] + 3.4 * far, 1.4, T12[2] + 6.6 * far]],
        [impact, [T12[0] + 2.8 * far, 0.9, T12[2] + 4.6 * far]],
        [5.6, [T12[0] + 7 * far, 4.8, T12[2] + 11 * far]],
        [9.5, [6, 14 * far, 30 * far]],
        [12.6, [-4, 9, 8]],
        [14, [T12[0] + 0.3, 1.6, T12[2] + 3]],
      ],
      t,
    );
    look = track(
      [
        [0, [T12[0], 2.9, T12[2]]],
        [impact, [T12[0], 0.8, T12[2]]],
        [5.6, [T12[0], 0.4, T12[2]]],
        [9.5, [0, 0, -4]],
        [12.6, [T12[0], 0, T12[2]]],
        [14, [T12[0], 0.3, T12[2]]],
      ],
      t,
    );
  } else {
    for (let i = 0; i < 32; i++) {
      // Steady neons (no pulsing light: it reads as blinking once encoded).
      on[i] = ramp(t, 0.1 + i * 0.03, 0.6 + i * 0.03);
      lines[i] = 0.85 * on[i];
    }
    const a = mode === "title" ? mix(-0.5, 0.1, t / 8) : mix(0.4, -0.2, t / 15);
    const r = (mode === "title" ? 36 : mix(30, 44, t / 15)) * (vertical ? 1.25 : 1);
    const h = mode === "title" ? mix(18, 13, t / 8) : mix(10, 26, t / 15);
    cam = [Math.sin(a) * r, h, Math.cos(a) * r];
    look = [0, mode === "outro" && vertical ? -6 : 0, 0];
  }
  return (
    <Stage3D>
      <Cam pos={cam} look={look} fog={mode === "drop" ? mix(0.02, 0.011, ramp(t, 4, 8)) : 0.012} />
      <Floor />
      <Boulodrome lines={lines} on={on} t={t} />
      {ball ? <Boule pos={ball} rot={t * 0.6} /> : null}
      {wave > 0 && wave < 60 ? (
        <>
          <mesh rotation-x={-Math.PI / 2} position={[T12[0], 0.02, T12[2]]} scale={wave}>
            <ringGeometry args={[0.97, 1, 128]} />
            <meshBasicMaterial color="#cfe0ff" transparent opacity={clamp01(1 - wave / 50)} blending={THREE.AdditiveBlending} toneMapped={false} depthWrite={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[T12[0], 0.015, T12[2]]} scale={wave * 0.97}>
            <ringGeometry args={[0.8, 1, 128]} />
            <meshBasicMaterial color={C.blueSoft} transparent opacity={clamp01(0.35 - wave / 150)} blending={THREE.AdditiveBlending} toneMapped={false} depthWrite={false} />
          </mesh>
        </>
      ) : null}
      {mode === "drop" && t < impact + 0.3 ? (
        <mesh position={[T12[0], 0.03, T12[2]]} rotation-x={-Math.PI / 2} scale={mix(5, 1.6, clamp01(t / impact))}>
          <circleGeometry args={[1, 48]} />
          <meshBasicMaterial map={dotTex()} color="#9fb4ff" transparent opacity={0.25 + 0.6 * clamp01(t / impact) ** 2} blending={THREE.AdditiveBlending} toneMapped={false} depthWrite={false} />
        </mesh>
      ) : null}
      {mode === "drop" && t > impact && t < impact + 1.2 ? (
        <mesh position={[T12[0], 0.05, T12[2]]} rotation-x={-Math.PI / 2} scale={1 + (t - impact) * 3}>
          <circleGeometry args={[1, 48]} />
          <meshBasicMaterial map={dotTex()} color={C.accentInk} transparent opacity={1 - (t - impact) / 1.2} blending={THREE.AdditiveBlending} toneMapped={false} depthWrite={false} />
        </mesh>
      ) : null}
      <Dust3D t={t} center={mode === "drop" ? [T12[0], 0, T12[2]] : [0, 0, 0]} size={mode === "drop" ? [16, 5, 16] : [44, 10, 60]} />
    </Stage3D>
  );
}

/* ======================================================================== */
/* Scene 2: boules become data points that build the 3D bracket             */
/* ======================================================================== */

type Node = { level: number; side: number; idx: number; pos: V3; value: number; parent: number };

function buildBracket(vertical: boolean) {
  const nodes: Node[] = [];
  const W = vertical ? 1.05 : 1.95;
  const H = vertical ? 0.48 : 0.56;
  const place = (side: number, level: number, along: number): V3 =>
    vertical ? [along, 11 + side * (10 - level * 2.5), -6] : [side * (10.2 - level * 2.55), 5.2 + along, -6];
  // Leaves: 8 per side. Team numbers come from a fixed « draw ».
  const teams = [12, 31, 5, 44, 27, 8, 63, 19, 3, 50, 38, 14, 22, 57, 9, 41];
  const levelNodes: number[][] = [[], [], [], [], []];
  for (const side of [-1, 1]) {
    let prev: number[] = [];
    for (let j = 0; j < 8; j++) {
      const along = vertical ? (j - 3.5) * 1.16 : (3.5 - j) * 1.3;
      nodes.push({ level: 0, side, idx: j, pos: place(side, 0, along), value: teams[(side < 0 ? 0 : 8) + j], parent: -1 });
      prev.push(nodes.length - 1);
      levelNodes[0].push(nodes.length - 1);
    }
    for (let level = 1; level <= 3; level++) {
      const next: number[] = [];
      for (let j = 0; j < prev.length; j += 2) {
        const a = nodes[prev[j]];
        const b = nodes[prev[j + 1]];
        const along = vertical ? (a.pos[0] + b.pos[0]) / 2 : (a.pos[1] + b.pos[1]) / 2 - 5.2;
        const winner = rand(a.value * 7 + b.value) > 0.45 ? a.value : b.value;
        nodes.push({ level, side, idx: j / 2, pos: place(side, level, along), value: winner, parent: -1 });
        a.parent = b.parent = nodes.length - 1;
        next.push(nodes.length - 1);
        levelNodes[level].push(nodes.length - 1);
      }
      prev = next;
    }
  }
  const semis = levelNodes[3];
  const finalPos: V3 = vertical ? [0, 11, -6] : [0, 5.2, -6];
  nodes.push({ level: 4, side: 0, idx: 0, pos: finalPos, value: nodes[semis[0]].value, parent: -1 });
  for (const s of semis) nodes[s].parent = nodes.length - 1;
  // Elbow connectors child → parent.
  const conns: Array<{ bars: Bar[]; child: number; parent: number }> = [];
  nodes.forEach((n, i) => {
    if (n.parent < 0) return;
    const p = nodes[n.parent];
    const N: V3 = [0, 0, 1];
    if (vertical) {
      const y0 = n.pos[1] - Math.sign(n.pos[1] - p.pos[1]) * (H / 2);
      const y1 = p.pos[1] + Math.sign(n.pos[1] - p.pos[1]) * (H / 2);
      const ym = (y0 + y1) / 2;
      conns.push({ child: i, parent: n.parent, bars: [
        { a: [n.pos[0], y0, -6.05], b: [n.pos[0], ym, -6.05], n: N },
        { a: [n.pos[0], ym, -6.05], b: [p.pos[0], ym, -6.05], n: N },
        { a: [p.pos[0], ym, -6.05], b: [p.pos[0], y1, -6.05], n: N },
      ] });
    } else {
      const x0 = n.pos[0] - Math.sign(n.pos[0] - p.pos[0]) * (W / 2);
      const x1 = p.pos[0] + Math.sign(n.pos[0] - p.pos[0]) * (W / 2);
      const xm = (x0 + x1) / 2;
      conns.push({ child: i, parent: n.parent, bars: [
        { a: [x0, n.pos[1], -6.05], b: [xm, n.pos[1], -6.05], n: N },
        { a: [xm, n.pos[1], -6.05], b: [xm, p.pos[1], -6.05], n: N },
        { a: [xm, p.pos[1], -6.05], b: [x1, p.pos[1], -6.05], n: N },
      ] });
    }
  });
  return { nodes, conns, W, H };
}

const BOULES: Array<{ c: V3; r: number }> = [
  { c: [-0.7, 0.36, 0.3], r: 0.36 },
  { c: [0.55, 0.36, 0.5], r: 0.36 },
  { c: [0.1, 0.36, -0.7], r: 0.36 },
  { c: [-1.3, 0.36, -0.9], r: 0.36 },
  { c: [1.4, 0.36, -0.4], r: 0.36 },
  { c: [-0.2, 0.36, 1.4], r: 0.36 },
];
const COCHONNET: V3 = [0.05, 0.13, 0.05];
const PER_NODE = 26;

export function BracketScene({ t, vertical }: { t: number; vertical: boolean }) {
  const bk = useMemo(() => buildBracket(vertical), [vertical]);
  const total = bk.nodes.length * PER_NODE;
  const points = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      map: dotTex(),
      color: "#cfe0ff",
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    return p;
  }, [total]);
  const shatter = 2.7;
  const nodeStart = (n: Node, i: number) => 3.0 + n.level * 0.62 + rand(i * 3.1) * 0.35;
  const FLY = 1.5;
  const arr = (points.geometry.getAttribute("position") as THREE.BufferAttribute).array as Float32Array;
  bk.nodes.forEach((n, ni) => {
    for (let k = 0; k < PER_NODE; k++) {
      const pi = ni * PER_NODE + k;
      const src = BOULES[pi % BOULES.length];
      // Point on the boule surface (Fibonacci sphere).
      const fi = Math.floor(pi / BOULES.length);
      const yy = 1 - (2 * (fi + 0.5)) / Math.ceil(total / BOULES.length);
      const rr = Math.sqrt(1 - yy * yy);
      const th = fi * 2.39996;
      const dir: V3 = [Math.cos(th) * rr, yy, Math.sin(th) * rr];
      const push = 1 + 0.5 * ramp(t, shatter, shatter + 1.2);
      const s: V3 = [src.c[0] + dir[0] * src.r * push, src.c[1] + dir[1] * src.r * push, src.c[2] + dir[2] * src.r * push];
      // Target on the panel outline.
      const u = k / PER_NODE;
      const per = 2 * (bk.W + bk.H);
      let d = u * per;
      let tx: number;
      let ty: number;
      if (d < bk.W) [tx, ty] = [d - bk.W / 2, -bk.H / 2];
      else if ((d -= bk.W) < bk.H) [tx, ty] = [bk.W / 2, d - bk.H / 2];
      else if ((d -= bk.H) < bk.W) [tx, ty] = [bk.W / 2 - d, bk.H / 2];
      else [tx, ty] = [-bk.W / 2, bk.H / 2 - (d - bk.W)];
      const target: V3 = [n.pos[0] + tx, n.pos[1] + ty, n.pos[2]];
      const st = nodeStart(n, ni) + rand(pi) * 0.4;
      const kf = ramp(t, st, st + FLY, "inOut");
      const ctrl: V3 = [(s[0] + target[0]) / 2 + (rand(pi + 1) - 0.5) * 6, Math.max(s[1], target[1]) + 3 + rand(pi + 2) * 3, (s[2] + target[2]) / 2 + 2];
      const a = 1 - kf;
      const visible = t >= shatter - 0.05 ? 1 : 0;
      for (let c = 0; c < 3; c++) arr[pi * 3 + c] = visible ? a * a * s[c] + 2 * a * kf * ctrl[c] + kf * kf * target[c] : 9999;
      if (kf >= 1) arr[pi * 3 + 1] += Math.sin(t * 3 + pi) * 0.015;
    }
  });
  points.geometry.getAttribute("position").needsUpdate = true;

  // Panels, labels, connectors.
  const nodeOn = bk.nodes.map((n, i) => ramp(t, nodeStart(n, i) + FLY + 0.2, nodeStart(n, i) + FLY + 0.7));
  const winPath = new Set<number>();
  let w = bk.nodes.findIndex((n) => n.level === 0 && n.value === bk.nodes[bk.nodes.length - 1].value);
  while (w >= 0) {
    winPath.add(w);
    w = bk.nodes[w].parent;
  }
  const hl = ramp(t, 7.8, 8.6);
  const connBars = bk.conns.flatMap((c) => c.bars);
  const connGrow = new Float32Array(connBars.length);
  const connBright = new Float32Array(connBars.length);
  bk.conns.forEach((c, ci) => {
    const pn = bk.nodes[c.parent];
    const st = nodeStart(pn, c.parent) + FLY - 0.3;
    for (let b = 0; b < 3; b++) {
      connGrow[ci * 3 + b] = ramp(t, st + b * 0.15, st + b * 0.15 + 0.25, "linear");
      connBright[ci * 3 + b] = 0.7 + (winPath.has(c.child) ? hl * 1.2 : 0);
    }
  });
  const panelMesh = useMemo(() => {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ map: panelTex(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    const m = new THREE.InstancedMesh(geo, mat, bk.nodes.length);
    m.frustumCulled = false;
    const mtx = new THREE.Matrix4();
    bk.nodes.forEach((n, i) => {
      mtx.makeScale(bk.W, bk.H, 1).setPosition(...n.pos);
      m.setMatrixAt(i, mtx);
      m.setColorAt(i, new THREE.Color(0, 0, 0));
    });
    return m;
  }, [bk]);
  const blue = new THREE.Color(C.blueSoft);
  const amber = new THREE.Color(C.accent);
  bk.nodes.forEach((n, i) => {
    const col = blue.clone().lerp(amber, winPath.has(i) ? hl : 0).multiplyScalar(nodeOn[i] * 0.9);
    panelMesh.setColorAt(i, col);
  });
  if (panelMesh.instanceColor) panelMesh.instanceColor.needsUpdate = true;
  const labelItems = useMemo(
    () => bk.nodes.map((n) => ({ pos: [n.pos[0] + (vertical ? 0.06 : 0.1), n.pos[1] - 0.02, n.pos[2] + 0.02] as V3, value: n.value })),
    [bk, vertical],
  );

  // Camera: close on the boules, then up to frame the whole bracket.
  const end: V3 = vertical ? [0, 15.5, 19.2] : [0, 6.4, 16.5];
  const endLook: V3 = vertical ? [0, 15.5, -6] : [0, 4.6, -6];
  const cam = track(
    [
      [0, [3.4, 1.5, 4.6]],
      [2.6, [2.4, 1.2, 3.6]],
      [4.4, [1.5, 4.5, 9]],
      [7.2, end],
      [10.5, [end[0] - 0.8, end[1] + 0.2, end[2] - 1]],
    ],
    t,
  );
  const look = track(
    [
      [0, [0, 0.3, 0]],
      [2.6, [0, 0.3, 0]],
      [4.4, [0, 3.5, -3]],
      [7.2, endLook],
      [10.5, endLook],
    ],
    t,
  );
  const bouleScale = 1 - ramp(t, shatter, shatter + 0.35);
  const glow = ramp(t, 1.6, shatter) * 1.4;
  const terrain = useMemo(() => rectBars([0, 0, 0], 4, 8), []);
  return (
    <Stage3D>
      <Cam pos={cam} look={look} fog={0.018} />
      <Floor />
      <Bars bars={terrain} bright={[1, 1, 1, 1]} color={C.accent} />
      {bouleScale > 0.001
        ? BOULES.map((b, i) => <Boule key={i} pos={b.c} radius={b.r * bouleScale} rot={i + t * 0.2} glow={glow} />)
        : null}
      {bouleScale > 0.001 ? (
        <mesh position={COCHONNET} scale={0.13 * bouleScale}>
          <sphereGeometry args={[1, 24, 16]} />
          <meshStandardMaterial color="#2b6bff" roughness={0.45} emissive="#1f5bff" emissiveIntensity={0.3 + glow} />
        </mesh>
      ) : null}
      <primitive object={points} />
      <primitive object={panelMesh} />
      <Labels items={labelItems} lit={nodeOn} color="#ffffff" size={vertical ? 0.46 : 0.5} />
      <Bars bars={connBars} bright={connBright} grow={connGrow} color={C.blueSoft} core={0.04} glow={0.35} />
      <Dust3D t={t} center={[0, 0, -2]} size={[30, 14, 20]} count={200} />
    </Stage3D>
  );
}

/* ======================================================================== */
/* Scene 4: the boulodrome shrinks into a map of France full of tournaments  */
/* ======================================================================== */

const FR: Array<[number, number]> = [
  [51.05, 2.37], [50.96, 1.85], [50.72, 1.6], [50.4, 1.56], [50.06, 1.38], [49.93, 1.08], [49.76, 0.37], [49.49, 0.11],
  [49.42, 0.23], [49.28, -0.25], [49.39, -1.05], [49.67, -1.26], [49.64, -1.62], [49.72, -1.94], [49.37, -1.79],
  [48.84, -1.6], [48.64, -1.51], [48.65, -2.02], [48.53, -2.75], [48.78, -3.05], [48.82, -3.45], [48.73, -3.98],
  [48.6, -4.56], [48.36, -4.77], [48.04, -4.73], [47.8, -4.37], [47.87, -3.92], [47.73, -3.37], [47.48, -3.12],
  [47.53, -2.75], [47.29, -2.51], [47.27, -2.2], [47.11, -2.1], [46.95, -2.25], [46.69, -1.94], [46.49, -1.78],
  [46.16, -1.15], [45.94, -1.1], [45.62, -1.03], [45.51, -1.13], [45.0, -1.2], [44.63, -1.25], [44.2, -1.3],
  [43.64, -1.45], [43.48, -1.56], [43.37, -1.79], [43.1, -1.4], [42.95, -0.72], [42.8, -0.2], [42.7, 0.4],
  [42.65, 1.45], [42.5, 1.95], [42.45, 2.55], [42.44, 3.17], [42.53, 3.08], [42.91, 3.05], [43.17, 3.18],
  [43.28, 3.5], [43.4, 3.69], [43.53, 4.13], [43.45, 4.43], [43.4, 4.9], [43.3, 5.37], [43.21, 5.54], [43.1, 5.93],
  [43.03, 6.15], [43.27, 6.64], [43.42, 6.77], [43.55, 7.01], [43.7, 7.27], [43.78, 7.5], [44.1, 7.7], [44.4, 6.95],
  [44.9, 6.7], [45.25, 6.95], [45.5, 7.1], [45.83, 6.87], [46.39, 6.8], [46.4, 6.59], [46.2, 6.1], [46.6, 6.25],
  [46.95, 6.65], [47.3, 6.95], [47.5, 7.1], [47.58, 7.58], [48.0, 7.57], [48.58, 7.8], [48.97, 8.23], [49.08, 7.7],
  [49.15, 6.95], [49.47, 6.37], [49.55, 5.78], [49.8, 4.85], [50.15, 4.82], [49.98, 4.2], [50.33, 4.08],
  [50.6, 3.3], [50.8, 2.6], [51.05, 2.37],
];
const CORSE: Array<[number, number]> = [
  [43.0, 9.42], [42.7, 9.45], [42.1, 9.55], [41.59, 9.28], [41.39, 9.16], [41.7, 8.8], [41.92, 8.73], [42.25, 8.6],
  [42.57, 8.75], [42.68, 9.3], [43.0, 9.42],
];
const CITIES: Array<[number, number]> = [
  [48.86, 2.35], [45.76, 4.84], [43.3, 5.37], [43.6, 1.44], [44.84, -0.58], [47.22, -1.55], [50.63, 3.06], [48.58, 7.75],
  [43.61, 3.88], [43.7, 7.27], [48.11, -1.68], [45.78, 3.08], [47.32, 5.04], [48.39, -4.49], [42.7, 2.9], [45.19, 5.72],
  [45.83, 1.26], [47.39, 0.69], [49.26, 4.03], [49.18, -0.37], [43.3, -0.37], [43.95, 4.81], [47.9, 1.9], [49.44, 1.1],
  [49.12, 6.18], [47.24, 6.02], [46.58, 0.34], [46.16, -1.15], [47.47, -0.55], [48.0, 0.2], [49.89, 2.3], [43.84, 4.36],
  [43.12, 5.93], [45.9, 6.13], [41.93, 8.74], [42.7, 9.45], [44.2, 0.62], [43.93, 2.15], [45.44, 4.39], [47.75, 7.34],
  [43.49, -1.47], [47.66, -2.76], [48.3, 4.08], [48.69, 6.18], [48.45, 1.49], [43.34, 3.22], [43.68, 4.63], [46.8, 4.4],
];
const K = 12;
const ORIGIN: [number, number] = [44.93, 4.89]; // Valence: where our boulodrome is.
const geo = (lat: number, lon: number): V3 => [(lon - ORIGIN[1]) * 0.69 * K, 0.02, -(lat - ORIGIN[0]) * K];

export function FranceScene({ t, vertical }: { t: number; vertical: boolean }) {
  const outline = useMemo(() => {
    const bars: Bar[] = [];
    for (const poly of [FR, CORSE])
      for (let i = 0; i < poly.length - 1; i++) bars.push({ a: geo(...poly[i]), b: geo(...poly[i + 1]) });
    return bars;
  }, []);
  const grow = new Float32Array(outline.length);
  const bright = new Float32Array(outline.length);
  outline.forEach((_, i) => {
    const st = 1.6 + (i / outline.length) * 2.6;
    grow[i] = ramp(t, st, st + 0.12, "linear");
    bright[i] = 1;
  });
  const dots = useMemo(() => {
    const geom = new THREE.PlaneGeometry(1, 1);
    geom.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: dotTex(), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false });
    const halo = new THREE.InstancedMesh(geom, mat, CITIES.length);
    const ring = new THREE.InstancedMesh(new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }), CITIES.length);
    for (const m of [halo, ring]) {
      m.frustumCulled = false;
      for (let i = 0; i < CITIES.length; i++) m.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    return { halo, ring };
  }, []);
  const mtx = new THREE.Matrix4();
  CITIES.forEach((c, i) => {
    const p = geo(...c);
    const st = 3.2 + rand(i * 5) * 3.2;
    const k = ramp(t, st, st + 0.4);
    const pulse = 1 + 0.12 * Math.sin(t * 1.5 + i);
    const col = new THREE.Color(i % 4 === 3 ? C.cyanInk : C.accentInk);
    mtx.makeScale(4.2 * k * pulse, 1, 4.2 * k * pulse).setPosition(p[0], 0.05, p[2]);
    dots.halo.setMatrixAt(i, mtx);
    dots.halo.setColorAt(i, col.clone().multiplyScalar(k));
    const rk = ((t - st) % 1.6) / 1.6;
    mtx.makeScale(0.8 + rk * 5, 1, 0.8 + rk * 5).setPosition(p[0], 0.04, p[2]);
    dots.ring.setMatrixAt(i, mtx);
    // Each ripple fades in and out (never restarts at full brightness: no blink).
    dots.ring.setColorAt(i, col.clone().multiplyScalar(t > st ? (1 - rk) * Math.min(1, rk * 6) * 0.7 : 0));
  });
  for (const m of [dots.halo, dots.ring]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  const shrink = mix(1, 0.025, ramp(t, 0.3, 3.4, "inOut"));
  const on = new Float32Array(32).fill(1);
  const lines = new Float32Array(32).fill(0.9);
  // France spans ~85 × 115 units; its center is (-20, -19) from Valence.
  const center: V3 = [-20, 0, -19];
  const k = ramp(t, 0.2, 5.5, "inOut");
  const sideShift = vertical ? 0 : -26;
  const look: V3 = [mix(0, center[0] + sideShift, k), 0, mix(0, center[2] + (vertical ? 22 : 0), k)];
  const cam: V3 = [mix(10, look[0] + 0, k), mix(22, vertical ? 165 : 118, k), mix(30, look[2] + (vertical ? 55 : 60), k)];
  return (
    <Stage3D>
      <Cam pos={cam} look={look} fog={mix(0.012, 0.0012, k)} />
      <Floor veil={0.86} />
      <group scale={shrink}>
        <Boulodrome lines={lines} on={on} t={t} numbers={false} />
      </group>
      <Bars bars={outline} bright={bright} grow={grow} color={C.blueSoft} core={0.55} glow={5} glowStrength={0.55} />
      <primitive object={dots.ring} />
      <primitive object={dots.halo} />
      <mesh position={[0, 0.06, 0]} rotation-x={-Math.PI / 2} scale={mix(4, 7, ramp(t, 2.5, 3.5))}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={dotTex()} color="#ffffff" transparent opacity={ramp(t, 2.2, 3.2)} blending={THREE.AdditiveBlending} toneMapped={false} depthWrite={false} />
      </mesh>
    </Stage3D>
  );
}
