// ClickableAxonStackDebug.tsx
import React, { useMemo, useRef, useState, useContext, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera, Edges, useCursor, ScrollControls, useScroll, Stats } from "@react-three/drei";
import * as THREE from "three";

const DEBUG = true;

const StackScrollContext = React.createContext<{
  zRef: React.MutableRefObject<number>;
  centerIndexRef: React.MutableRefObject<number>;
  gap: number;
  centerOn?: (index: number, opts?: { animate?: boolean }) => void;

  // 👇 new (staging)
  stagedIndexRef?: React.MutableRefObject<number | null>;
  stageGapRef?: React.MutableRefObject<number>; // desired absolute gap around centered card
  stageAt?: (index: number, gapAbs: number) => void;
  clearStage?: () => void;
} | null>(null);


export default function ClickableAxonStackDebug() {
  const camRef = useRef<THREE.OrthographicCamera>(null!);

  const PLANES = 200;
  const GAP = 0.2;

  // optional: make the scroll area scale with depth
  const depth = (PLANES - 1) * GAP;
  const CAM_Y = Math.max(10, depth + 2);
  const pages = Math.max(2, 1 + depth / 10);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <Canvas orthographic gl={{ antialias: true, alpha: true }}>
        <OrthographicCamera
          ref={camRef}
          makeDefault
          position={[0, CAM_Y, 0]}
          near={0.001} 
          far={5000}
          zoom={180}
          onUpdate={(c) => { c.lookAt(0, 0, 0); c.updateProjectionMatrix(); }}
        />
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 5, 5]} />

        <ScrollControls pages={pages} damping={0.15}>
          <group
            rotation={[
              THREE.MathUtils.degToRad(120),
              THREE.MathUtils.degToRad(35.264),
              0,
            ]}
          >
            {/* distance is computed from planes+gap */}
            <LocalZScroller planes={PLANES} gap={GAP} overshoot={0.0} ease={0.08}>
              <KeyboardNavigator planes={PLANES} />
              <AxonStack planes={PLANES} gap={GAP} width={1.6} height={1} lift={-0.25} liftSpeed={0.15} />
            </LocalZScroller>
          </group>
        </ScrollControls>
        {DEBUG && <Stats showPanel={0} className="r3f-stats" />} 
      </Canvas>
    </div>
  );
}

function AxonStack({
  planes = 8,
  gap = 0.2,
  width = 1.6,
  height = 1,
  lift = 1,
  liftSpeed = 0.15,
}: {
  planes?: number;
  gap?: number;
  width?: number;
  height?: number;
  lift?: number;
  liftSpeed?: number;
}) {
  const planeScale: [number, number] = [width, height];
  return (
    // here instead of (planes * 0) which equals 0, 
    <group position={[0, planes * 0, 0]}>
      {Array.from({ length: planes }).map((_, i) => (
        <Card
          key={i}
          index={i}
          gap={gap}
          size={planeScale}
          lift={lift}
          liftSpeed={liftSpeed}
          renderOrder={planes - i}
        />
      ))}
    </group>
  );
}

function Card({
  index,
  gap,
  size,
  lift,
  liftSpeed,
  renderOrder,
}: {
  index: number;
  gap: number;
  size: [number, number];
  lift: number;
  liftSpeed: number;
  renderOrder: number;
}) {
  const ctx = useContext(StackScrollContext); // may be null → we guard everywhere

  // refs
  const ref = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);                  // ← define before use
  const matRef = useRef<THREE.MeshStandardMaterial>(null!);

  // state
  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [waitingToStage, setWaitingToStage] = useState(false); // center → stage on arrival
  useCursor(hovered);

  const { camera } = useThree();

  const baseZ = useMemo(() => index * gap, [index, gap]);

  // ── knobs ─────────────────────────────────────────────────────────
  const FRONT_SHIFT = 0;       // tiny -Z bias while hovered/centered
  const PULL = 2.0;            // toward camera when expanded (world units)
  const ROTATE_SPD = 0.2;      // slerp factor/frame (rotation)
  const MOVE_SPD   = 0.18;     // lerp factor/frame (translation)
  const SCALE_EXPANDED = 4.6;
  const SCALE_SPD      = 0.18;
  const OFF_SCREEN_X   = 1.0;  // expanded lateral offset (right +, left -)
  const OFF_SCREEN_Y   = -0.6; // expanded vertical offset (up +, down -)
  const CENTER_NUDGE_X = -1.0; // fine centering tweaks in world units
  const CENTER_NUDGE_Y =  0.6;
  const RETURN_SPD     = 0.18; // how fast X returns to 0 when collapsing
  const STAGE_GAP_ABS  = 1;    // absolute gap while staged (your request)
  // ──────────────────────────────────────────────────────────────────

  // colors
  const COLOR_BASE  = useMemo(() => new THREE.Color("#4169e1"), []);
  const COLOR_HOVER = useMemo(() => new THREE.Color("#ffcc80"), []);

  // temps
  const NEG_Z      = useMemo(() => new THREE.Vector3(0, 0, -1), []);
  const tmpQParent = useMemo(() => new THREE.Quaternion(), []);
  const tmpQInv    = useMemo(() => new THREE.Quaternion(), []);
  const tmpQFace   = useMemo(() => new THREE.Quaternion(), []);
  const tmpQTarget = useMemo(() => new THREE.Quaternion(), []);
  const tmpDir     = useMemo(() => new THREE.Vector3(), []);
  const tmpWorld   = useMemo(() => new THREE.Vector3(), []);
  const tmpLocal   = useMemo(() => new THREE.Vector3(), []);
  const tmpRight   = useMemo(() => new THREE.Vector3(), []);
  const tmpUp      = useMemo(() => new THREE.Vector3(), []);
  const tmpFwd     = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!ref.current || !matRef.current) return;

    // null-safe readings from context
    const isCenter = (ctx?.centerIndexRef?.current ?? -1) === index;
    const stagedIdx = ctx?.stagedIndexRef?.current;                 // number | null | undefined
    const isStagedHere = stagedIdx === index;
    const stageGapAbs = ctx?.stageGapRef?.current ?? 0;
    const g = ctx?.gap ?? gap;

    // finish pending "center → stage"
    if (waitingToStage && isCenter) {
      ctx?.stageAt?.(index, STAGE_GAP_ABS);
      setWaitingToStage(false);
    }

    // auto-collapse if you scroll away
    if (expanded && !isCenter) setExpanded(false);

    // EXPANDED
    if (expanded) {
      const parent = ref.current.parent as THREE.Object3D;
      parent.getWorldQuaternion(tmpQParent);
      tmpQInv.copy(tmpQParent).invert();

      camera.getWorldDirection(tmpDir);        // cam → scene
      tmpDir.multiplyScalar(-1).normalize();   // scene → cam
      tmpQFace.setFromUnitVectors(NEG_Z, tmpDir);
      tmpQTarget.copy(tmpQInv).multiply(tmpQFace);
      ref.current.quaternion.slerp(tmpQTarget, ROTATE_SPD);

      // camera basis (world)
      camera.getWorldDirection(tmpFwd).normalize();
      tmpUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      tmpRight.copy(tmpFwd).cross(tmpUp).normalize();

      // center + offsets + pull toward camera
      const pull   = tmpFwd.clone().multiplyScalar(-PULL);
      const offX   = tmpRight.clone().multiplyScalar(OFF_SCREEN_X);
      const offY   = tmpUp.clone().multiplyScalar(OFF_SCREEN_Y);
      const nudgeX = tmpRight.clone().multiplyScalar(CENTER_NUDGE_X);
      const nudgeY = tmpUp.clone().multiplyScalar(CENTER_NUDGE_Y);

      tmpWorld.set(0, 0, 0).add(pull).add(offX).add(offY).add(nudgeX).add(nudgeY);
      parent.worldToLocal(tmpLocal.copy(tmpWorld));
      ref.current.position.lerp(tmpLocal, MOVE_SPD);

      // scale & draw-on-top
      ref.current.scale.lerp(new THREE.Vector3(SCALE_EXPANDED, SCALE_EXPANDED, 1), SCALE_SPD);
      if (meshRef.current) meshRef.current.renderOrder = 10000;
      matRef.current.transparent = true;
      matRef.current.opacity = 1;
      matRef.current.depthTest = false;
      matRef.current.depthWrite = false;

      matRef.current.color.lerp(COLOR_HOVER, 0.25);
      return;
    }

    // COLLAPSED / STAGED

    // return X to 0 (undo expanded lateral offsets)
    ref.current.position.x += (0 - ref.current.position.x) * RETURN_SPD;
    if (Math.abs(ref.current.position.x) < 1e-4) ref.current.position.x = 0;

    // staging offset along local Z (open a big gap around the staged/centered card)
    let stageOffset = 0;
    if (stagedIdx != null && g > 0) {
      const k = stagedIdx;
      const delta = Math.max(0, stageGapAbs - g); // extra space beyond normal gap
      if (index > k) stageOffset = +delta;        // cards after center move forward
      else if (index < k) stageOffset = -delta;   // cards before center move backward
      // index === k → 0 (center card stays at baseZ)
    }

    // hover/center lift
    const shouldLift = hovered || isCenter;
    const targetY = shouldLift ? lift : 0;
    ref.current.position.y += (targetY - ref.current.position.y) * liftSpeed;

    // Z with stage offset + optional pick bias
    const targetZ = shouldLift
      ? (baseZ + stageOffset - FRONT_SHIFT)
      : (baseZ + stageOffset);
    ref.current.position.z += (targetZ - ref.current.position.z) * 0.3;

    // relax rotation/scale + restore depth state
    ref.current.quaternion.slerp(new THREE.Quaternion(), 0.2);
    ref.current.scale.lerp(new THREE.Vector3(1, 1, 1), SCALE_SPD);

    if (meshRef.current) meshRef.current.renderOrder = renderOrder;
    matRef.current.transparent = false;
    matRef.current.opacity = 1;
    matRef.current.depthTest = true;
    matRef.current.depthWrite = true;

    // color
    matRef.current.color.lerp(shouldLift ? COLOR_HOVER : COLOR_BASE, 0.25);

    // if this card was staged but is no longer centered, clear staging
    if (isStagedHere && !isCenter) ctx?.clearStage?.();
  });

  // click flow: not centered → center+stage; centered→ stage; staged→ expand; expanded→ collapse
  const handleClick = () => {
    const isCenter = (ctx?.centerIndexRef?.current ?? -1) === index;
    const isStagedHere = (ctx?.stagedIndexRef?.current ?? null) === index;

    if (expanded) { setExpanded(false); return; }
    if (!isCenter) {
      ctx?.centerOn?.(index);
      setWaitingToStage(true);
      return;
    }
    if (!isStagedHere) {
      ctx?.stageAt?.(index, STAGE_GAP_ABS);
      return;
    }
    setExpanded(true);
  };

  return (
    <group ref={ref} position={[0, 0, baseZ]} renderOrder={renderOrder}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={(e) => { e.stopPropagation(); setHovered(false); }}
        onClick={(e) => { e.stopPropagation(); handleClick(); }}
      >
        <planeGeometry args={[size[0], size[1]]} />
        <meshStandardMaterial
          ref={matRef}
          side={THREE.DoubleSide}
          metalness={0.1}
          roughness={0.8}
        />
        {DEBUG && <Edges />}
      </mesh>

      {DEBUG && (
        <mesh position={[0, 0, 0.001]} visible={!expanded}>
          <planeGeometry args={[size[0], size[1]]} />
          <meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0.15} color={"red"} depthWrite={false} />
          <Edges />
        </mesh>
      )}
    </group>
  );
}

function LocalZScroller({
  children,
  distance,
  planes,
  gap,
  overshoot = 0,
  ease = 0.1,
  start = 0,
  end = 1,
  snapEndThreshold = 0.995, // if offset > this, treat as 1
}: {
  children: React.ReactNode;
  distance?: number;
  planes?: number;
  gap?: number;
  overshoot?: number;
  ease?: number;
  start?: number;
  end?: number;
  snapEndThreshold?: number;
}) {
  const ref = useRef<THREE.Group>(null!);
  const scroll = useScroll();

  // live values for children
  const zRef = useRef(0);            // raw/target z (not smoothed)
  const centerIndexRef = useRef(0);  // computed from raw z
  const zSmoothed = useRef(0);       // smoothed z for motion

  const autoDistance = useMemo(() => {
    if (typeof distance === "number") return distance;
    if (typeof planes === "number" && typeof gap === "number") {
      const depth = (planes - 1) * gap;
      return -(depth + overshoot);
    }
    return 0;
  }, [distance, planes, gap, overshoot]);

  const stagedIndexRef = useRef<number | null>(null);
  const stageGapRef = useRef<number>(0);

  const centerOn = React.useCallback((index: number, opts?: { animate?: boolean }) => {
    if (!planes || !gap) return;
    const i = Math.max(0, Math.min(planes - 1, index));
    const targetZ = -(i * gap);                                // we want this Z at center
    const pLocal = autoDistance !== 0 ? THREE.MathUtils.clamp(targetZ / autoDistance, 0, 1) : 0;
    const pGlobal = THREE.MathUtils.clamp(start + pLocal * (end - start), 0, 1);

    const el = (scroll as any).el as HTMLElement | undefined;  // drei’s internal scroll area
    if (!el) return;
    const max = Math.max(1, el.scrollHeight - el.clientHeight);
    el.scrollTo({ top: pGlobal * max, behavior: opts?.animate === false ? "auto" : "smooth" });
  }, [planes, gap, autoDistance, start, end, scroll]);

  const stageAt = React.useCallback((index: number, gapAbs: number) => {
    stagedIndexRef.current = index;
    stageGapRef.current = Math.max(0, gapAbs);
  }, []);
  const clearStage = React.useCallback(() => {
    stagedIndexRef.current = null;
    stageGapRef.current = 0;
  }, []);

  useFrame(() => {
    // raw offset 0..1 from ScrollControls (already damped internally)
    const raw = scroll.offset;

    // map to our start..end window
    let p = THREE.MathUtils.clamp((raw - start) / Math.max(1e-6, end - start), 0, 1);

    // snap tail so we actually reach the last card
    if (p > snapEndThreshold) p = 1;

    // target z for this frame (use RAW to compute center index)
    const zTarget = THREE.MathUtils.lerp(0, autoDistance, p);
    zRef.current = zTarget;

    // compute the centered index from the RAW target (not smoothed)
    if (typeof planes === "number" && typeof gap === "number" && gap > 0) {
      const idxFloat = -zTarget / gap;
      // small epsilon to bias rounding upward near the end
      let idx = Math.round(idxFloat + 1e-4);
      idx = Math.max(0, Math.min(planes - 1, idx));
      centerIndexRef.current = idx;
    }

    // smooth the actual motion of the group in Z
    zSmoothed.current += (zTarget - zSmoothed.current) * ease;
    ref.current.position.set(0, 0, zSmoothed.current);
  });

  return (
    <StackScrollContext.Provider value={{ zRef, centerIndexRef, gap: gap ?? 0.0001, centerOn, stagedIndexRef,
      stageGapRef,
      stageAt,
      clearStage }}>
      <group ref={ref}>{children}</group>
    </StackScrollContext.Provider>
  );
}

function KeyboardNavigator({ planes }: { planes: number }) {
  const ctx = useContext(StackScrollContext);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs/textareas or if meta keys are down
      const target = e.target as HTMLElement | null;
      const isTyping =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          (target as any).isContentEditable);

      if (isTyping || e.altKey || e.ctrlKey || e.metaKey) return;

      let step = 0;
      if (e.key === "ArrowRight") step = +1;
      else if (e.key === "ArrowLeft") step = -1;
      else return;

      e.preventDefault();

      const current = ctx?.centerIndexRef?.current ?? 0;
      const next = Math.max(0, Math.min(planes - 1, current + step));

      // clear any staging gap so it's just the "hover/center" effect
      ctx?.clearStage?.();

      // scroll to the next centered index (smooth)
      ctx?.centerOn?.(next);
    };

    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, planes]);

  return null;
}
