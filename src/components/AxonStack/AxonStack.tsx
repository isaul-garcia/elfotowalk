// ClickableAxonStackDebug (cleaned)
// - Organized imports
// - Removed unused imports and redundancies
// - Centralized constants and helpers
// - Wrapped debug logs with DEBUG guard
// - Kept ALL behavior/animations/controls intact

import React, { useMemo, useRef, useState, useContext, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrthographicCamera,
  useCursor,
  ScrollControls,
  useScroll,
  Stats,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";

// ────────────────────────────────────────────────────────────────────────────────
// Config / Debug
// ────────────────────────────────────────────────────────────────────────────────
const DEBUG = true;

// 1×1 transparent GIF as texture fallback
const FALLBACK_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

// Reusable constants
const VEC_NEG_Z = new THREE.Vector3(0, 0, -1);

// ────────────────────────────────────────────────────────────────────────────────
// Context
// ────────────────────────────────────────────────────────────────────────────────
type StackCtx = {
  zRef: React.MutableRefObject<number>;
  centerIndexRef: React.MutableRefObject<number>;
  gap: number;
  centerOn?: (index: number, opts?: { animate?: boolean }) => void;
  stagedIndexRef?: React.MutableRefObject<number | null>;
  stageGapRef?: React.MutableRefObject<number>;
  stageAt?: (index: number, gapAbs: number) => void;
  clearStage?: () => void;
  expandedIndex: number | null;
  expandedIndexRef: React.MutableRefObject<number | null>;
  setExpandedIndex?: (idx: number | null) => void;
  lastExpandedIndexRef: React.MutableRefObject<number | null>;
  expandedSwitchLockRef: React.MutableRefObject<number>;
  navLockRef: React.MutableRefObject<number>;
} | null;

const StackScrollContext = React.createContext<StackCtx>(null);

// ────────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────────
function setTextureSRGB(tex: THREE.Texture) {
  // Compatibility across Three.js versions
  const anyTex = tex as any;
  const anyTHREE = THREE as any;
  if ("colorSpace" in anyTex && anyTHREE.SRGBColorSpace !== undefined) {
    anyTex.colorSpace = anyTHREE.SRGBColorSpace;
  } else if ("encoding" in anyTex && anyTHREE.sRGBEncoding !== undefined) {
    anyTex.encoding = anyTHREE.sRGBEncoding;
  }
  tex.needsUpdate = true;
}

// ────────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────────
export default function ClickableAxonStackDebug() {
  const camRef = useRef<THREE.OrthographicCamera>(null!);
  const clearStageRef = useRef<(() => void) | null>(null); 
  const collapseExpandedRef = useRef<(() => void) | null>(null);

  const IMAGES = useMemo<string[]>(
    () => Array.from({ length: 52 }, (_, i) => `/stack-images/${String(i).padStart(3, "0")}.jpg`),
    []
  );

  const GAP = 0.2;
  const planeCount = IMAGES.length;

  const depth = (planeCount - 1) * GAP;
  const CAM_Y = Math.max(10, depth + 2);
  const pages = Math.max(2, 1 + depth / 10);

  useEffect(() => {
    if (!DEBUG) return;
    console.log("Images list (first 5):", IMAGES.slice(0, 5), "total:", IMAGES.length);
  }, [IMAGES]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <Canvas
        orthographic
        gl={{ antialias: true, alpha: true }}
        onPointerMissed={() => {
          if (DEBUG) console.log("clicked background");
          clearStageRef.current?.();
          collapseExpandedRef.current?.();
        }}
      >
        <OrthographicCamera
          ref={camRef}
          makeDefault
          position={[0, CAM_Y, 0]}
          near={0.001}
          far={5000}
          zoom={180}
          onUpdate={(c) => {
            c.lookAt(0, 0, 0);
            c.updateProjectionMatrix();
          }}
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
            <LocalZScroller planes={planeCount} gap={GAP} overshoot={0.0} ease={0.08} clearStageExternalRef={clearStageRef} collapseExpandedExternalRef={collapseExpandedRef}>
              <KeyboardNavigator planes={planeCount} />
              <AxonStack
                images={IMAGES}
                planes={planeCount}
                gap={GAP}
                width={1.6}
                height={1}
                lift={-0.25}
                liftSpeed={0.15}
              />
            </LocalZScroller>
          </group>
        </ScrollControls>

        {DEBUG && <Stats showPanel={0} className="r3f-stats" />}
      </Canvas>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// AxonStack
// ────────────────────────────────────────────────────────────────────────────────
function AxonStack({
  images,
  planes = 8,
  gap = 0.2,
  width = 1.6,
  height = 1,
  lift = 1,
  liftSpeed = 0.15,
}: {
  images?: string[];
  planes?: number;
  gap?: number;
  width?: number;
  height?: number;
  lift?: number;
  liftSpeed?: number;
}) {
  const planeScale: [number, number] = [width, height];

  return (
    <group position={[0, 0, 0]}>
      {Array.from({ length: planes }).map((_, i) => (
        <Card
          key={i}
          src={images && images.length ? images[i % images.length] : undefined}
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

// ────────────────────────────────────────────────────────────────────────────────
// Card (single plane)
// ────────────────────────────────────────────────────────────────────────────────
// Behavior knobs (kept identical to original intent)
const CARD_FRONT_SHIFT = 0;
const CARD_PULL = 2.0;
const CARD_ROTATE_SPD = 0.2;
const CARD_MOVE_SPD = 0.18;
const CARD_SCALE_EXPANDED = 4.6;
const CARD_SCALE_SPD = 0.18;
const CARD_OFF_SCREEN_X = 1.0;
const CARD_OFF_SCREEN_Y = -0.6;
const CARD_CENTER_NUDGE_X = -1.0;
const CARD_CENTER_NUDGE_Y = 0.6;
const CARD_RETURN_SPD = 0.18;
const CARD_STAGE_GAP_ABS = 1;
const EXPANDED_RENDER_ORDER = 1_000_000;

function Card({
  src,
  index,
  gap,
  size,
  lift,
  liftSpeed,
  renderOrder,
}: {
  src?: string;
  index: number;
  gap: number;
  size: [number, number];
  lift: number;
  liftSpeed: number;
  renderOrder: number;
}) {
  const ctx = useContext(StackScrollContext);
  const { camera } = useThree();

  const ref = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  const matRef = useRef<THREE.MeshBasicMaterial>(null!);
  const imgSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const fitTRef = useRef(0); // 0 = cover, 1 = contain
  const FIT_SPD = 0.18;

  const [hovered, setHovered] = useState(false);
  const expanded = (ctx?.expandedIndexRef?.current ?? null) === index;
  const [waitingToStage, setWaitingToStage] = useState(false);
  useCursor(hovered);

  // Texture
  const tex = useTexture(src ?? FALLBACK_DATA_URL);
  useEffect(() => setTextureSRGB(tex), [tex]);

  useEffect(() => {
    const img = tex.image as HTMLImageElement | undefined;
    if (!img) return;
  
    const apply = () => {
      if (DEBUG) console.log("✅ texture loaded:", src, img.width, img.height);
      imgSizeRef.current = { w: img.width || 0, h: img.height || 0 };
    };
    const fail = () => {
      if (DEBUG) console.error("❌ texture failed:", src);
    };
  
    // If the image is already available (cache), record immediately
    if ((img as any).complete && img.width && img.height) {
      apply();
    }
  
    img.addEventListener?.("load", apply as any);
    img.addEventListener?.("error", fail as any);
    return () => {
      img.removeEventListener?.("load", apply as any);
      img.removeEventListener?.("error", fail as any);
    };
  }, [tex, src]);  
  

  const baseZ = useMemo(() => index * gap, [index, gap]);

  // Temps
  const tmpQParent = useMemo(() => new THREE.Quaternion(), []);
  const tmpQInv = useMemo(() => new THREE.Quaternion(), []);
  const tmpQFace = useMemo(() => new THREE.Quaternion(), []);
  const tmpQTarget = useMemo(() => new THREE.Quaternion(), []);
  const tmpDir = useMemo(() => new THREE.Vector3(), []);
  const tmpWorld = useMemo(() => new THREE.Vector3(), []);
  const tmpLocal = useMemo(() => new THREE.Vector3(), []);
  const tmpRight = useMemo(() => new THREE.Vector3(), []);
  const tmpUp = useMemo(() => new THREE.Vector3(), []);
  const tmpFwd = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    if (!ref.current) return;

    const isCenter = (ctx?.centerIndexRef?.current ?? -1) === index;
    const stagedIdx = ctx?.stagedIndexRef?.current;
    const stageGapAbs = ctx?.stageGapRef?.current ?? 0;
    const g = ctx?.gap ?? gap;

    const switchLock = ctx?.expandedSwitchLockRef?.current ?? 0;
    const lastExpanded = ctx?.lastExpandedIndexRef?.current ?? null;
    const snapNow = expanded && switchLock > 0;
    
    const targetFit = expanded ? 1 : 0;
    if (snapNow) {
      fitTRef.current = 1;                 // instant contain on switch
    } else {
      fitTRef.current += (targetFit - fitTRef.current) * FIT_SPD;
      if (Math.abs(targetFit - fitTRef.current) < 1e-4) fitTRef.current = targetFit;
    }

    // Prepare texture mapping with current fitT
    const iw = imgSizeRef.current.w;
    const ih = imgSizeRef.current.h;
    let containFx = 1, containFy = 1;

    if (iw > 0 && ih > 0) {
      const cover = computeCoverParams(iw, ih, size[0], size[1]);
      const t = fitTRef.current; // already snapped when snapNow

      const repeatX = THREE.MathUtils.lerp(cover.repeatX, 1, t);
      const repeatY = THREE.MathUtils.lerp(cover.repeatY, 1, t);
      const offsetX = THREE.MathUtils.lerp(cover.offsetX, 0, t);
      const offsetY = THREE.MathUtils.lerp(cover.offsetY, 0, t);

      const contain = containScaleFactors(iw, ih, size[0], size[1]);
      containFx = contain.fx;
      containFy = contain.fy;

      tex.center.set(0.5, 0.5);
      tex.wrapS = THREE.ClampToEdgeWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.repeat.set(repeatX, repeatY);
      tex.offset.set(offsetX, offsetY);
      // no need to set needsUpdate every frame
    }

    if (waitingToStage && isCenter) {
      ctx?.stageAt?.(index, CARD_STAGE_GAP_ABS);
      setWaitingToStage(false);
    }

    if (expanded) {
      // Expanded pose: face camera, pull forward, and scale up
      const switchLock = ctx?.expandedSwitchLockRef?.current ?? 0;

      const parent = ref.current.parent as THREE.Object3D;
      parent.getWorldQuaternion(tmpQParent);
      tmpQInv.copy(tmpQParent).invert();

      camera.getWorldDirection(tmpDir);
      tmpDir.multiplyScalar(-1).normalize();
      tmpQFace.setFromUnitVectors(VEC_NEG_Z, tmpDir);
      tmpQTarget.copy(tmpQInv).multiply(tmpQFace);

      // Snap rotation on the very first frames of an expanded arrow switch
      if (switchLock > 0) {
        ref.current.quaternion.copy(tmpQTarget);
      } else {
        ref.current.quaternion.slerp(tmpQTarget, CARD_ROTATE_SPD);
      }

      camera.getWorldDirection(tmpFwd).normalize();
      tmpUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      tmpRight.copy(tmpFwd).cross(tmpUp).normalize();

      const pull = tmpFwd.clone().multiplyScalar(-CARD_PULL);
      const offX = tmpRight.clone().multiplyScalar(CARD_OFF_SCREEN_X);
      const offY = tmpUp.clone().multiplyScalar(CARD_OFF_SCREEN_Y);
      const nudgeX = tmpRight.clone().multiplyScalar(CARD_CENTER_NUDGE_X);
      const nudgeY = tmpUp.clone().multiplyScalar(CARD_CENTER_NUDGE_Y);

      tmpWorld.set(0, 0, 0).add(pull).add(offX).add(offY).add(nudgeX).add(nudgeY);
      parent.worldToLocal(tmpLocal.copy(tmpWorld));

      const anisotropicTarget = new THREE.Vector3(
        CARD_SCALE_EXPANDED * (iw > 0 ? THREE.MathUtils.lerp(1, containFx, fitTRef.current) : 1),
        CARD_SCALE_EXPANDED * (iw > 0 ? THREE.MathUtils.lerp(1, containFy, fitTRef.current) : 1),
        1
      );
    
      if (switchLock > 0) {
        ref.current.position.copy(tmpLocal);
        ref.current.scale.copy(anisotropicTarget);     // snap scale on switch
      } else {
        ref.current.position.lerp(tmpLocal, CARD_MOVE_SPD);
        ref.current.scale.lerp(anisotropicTarget, CARD_SCALE_SPD);
      }

      if (meshRef.current) meshRef.current.renderOrder = EXPANDED_RENDER_ORDER;
      ref.current.renderOrder = EXPANDED_RENDER_ORDER;
      if (matRef.current) {
        matRef.current.transparent = false;
        matRef.current.depthTest = false;
        matRef.current.depthWrite = false;
        matRef.current.depthFunc = THREE.AlwaysDepth;
        matRef.current.polygonOffset = true;
        matRef.current.polygonOffsetFactor = -1;
        matRef.current.polygonOffsetUnits = -4;
        matRef.current.opacity = 1;
      }
      return;
    }

    // Collapsed / staged behavior
    ref.current.position.x += (0 - ref.current.position.x) * CARD_RETURN_SPD;
    if (Math.abs(ref.current.position.x) < 1e-4) ref.current.position.x = 0;

    let stageOffset = 0;
    if (stagedIdx != null && g > 0) {
      const k = stagedIdx;
      const delta = Math.max(0, stageGapAbs - g);
      if (index > k) stageOffset = +delta;
      else if (index < k) stageOffset = -delta;
    }

    const isStaged = stagedIdx === index;
    const navLock = ctx?.navLockRef?.current ?? 0;
    const shouldLift = !isStaged && (navLock > 0 ? isCenter : (hovered || isCenter));
    const targetY = shouldLift ? lift : 0;
    ref.current.position.y += (targetY - ref.current.position.y) * liftSpeed;

    const targetZ = shouldLift ? baseZ + stageOffset - CARD_FRONT_SHIFT : baseZ + stageOffset;
    if (switchLock > 0 && lastExpanded === index) {
      ref.current.position.x = 0;
      ref.current.position.y = targetY;
      ref.current.position.z = targetZ;
    } else {
      ref.current.position.z += (targetZ - ref.current.position.z) * 0.3;
    }

    if (switchLock > 0 && lastExpanded === index) {
      ref.current.quaternion.copy(new THREE.Quaternion());
    } else {
      ref.current.quaternion.slerp(new THREE.Quaternion(), 0.2);
    }
    if (switchLock > 0 && lastExpanded === index) {
      ref.current.scale.set(1, 1, 1);
    } else {
      ref.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.18);
    }

    if (meshRef.current) meshRef.current.renderOrder = renderOrder;
    if (ref.current) ref.current.renderOrder = 0;
    if (matRef.current) {
      matRef.current.transparent = false;
      matRef.current.depthTest = true;
      matRef.current.depthWrite = true;
      matRef.current.opacity = 1;
    }

    // Stage persists; it will follow the center in LocalZScroller
  });

  const handleClick = useCallback(() => {
    const isCenter = (ctx?.centerIndexRef?.current ?? -1) === index;
    const isStagedHere = (ctx?.stagedIndexRef?.current ?? null) === index;

    if (expanded) {
      ctx?.setExpandedIndex?.(null);
      return;
    }
    if (!isCenter) {
      ctx?.centerOn?.(index);
      setWaitingToStage(true);
      return;
    }
    if (!isStagedHere) {
      ctx?.stageAt?.(index, 1);
      return;
    }
    ctx?.setExpandedIndex?.(index);
  }, [ctx, expanded, index]);

  return (
    <group ref={ref} position={[0, 0, baseZ]} renderOrder={renderOrder}>
      <mesh
        ref={meshRef}
        rotation={[0, 0, Math.PI]}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          setHovered(false);
        }}
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
      >
        <planeGeometry args={[size[0], size[1]]} />
        <meshBasicMaterial
          ref={matRef}
          map={tex}
          toneMapped={false}
          transparent={false}
          opacity={1}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// LocalZScroller: manages scroll → local Z and center index tracking
// ────────────────────────────────────────────────────────────────────────────────
function LocalZScroller({
  children,
  distance,
  planes,
  gap,
  overshoot = 0,
  ease = 0.1,
  start = 0,
  end = 1,
  snapEndThreshold = 0.995,
  clearStageExternalRef, 
  collapseExpandedExternalRef,
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
  clearStageExternalRef?: React.MutableRefObject<(() => void) | null>;
  collapseExpandedExternalRef?: React.MutableRefObject<(() => void) | null>;
}) {
  const ref = useRef<THREE.Group>(null!);
  const scroll = useScroll();

  const zRef = useRef(0);
  const centerIndexRef = useRef(0);
  const zSmoothed = useRef(0);

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
  const lastExpandedIndexRef = useRef<number | null>(null);
  const expandedSwitchLockRef = useRef<number>(0);
  const navLockRef = useRef<number>(0);

  const centerOn = useCallback(
    (index: number, opts?: { animate?: boolean }) => {
      if (!planes || !gap) return;
      const i = Math.max(0, Math.min(planes - 1, index));
      const targetZ = -(i * gap);
      const pLocal = autoDistance !== 0 ? THREE.MathUtils.clamp(targetZ / autoDistance, 0, 1) : 0;
      const pGlobal = THREE.MathUtils.clamp(start + pLocal * (end - start), 0, 1);

      const el = (scroll as any).el as HTMLElement | undefined;
      if (!el) return;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: pGlobal * max, behavior: (opts?.animate === false || navLockRef.current > 0) ? "auto" : "smooth" });
    },
    [planes, gap, autoDistance, start, end, scroll]
  );

  const stageAt = useCallback((index: number, gapAbs: number) => {
    stagedIndexRef.current = index;
    stageGapRef.current = Math.max(0, gapAbs);
  }, []);

  const clearStage = useCallback(() => {
    stagedIndexRef.current = null;
    stageGapRef.current = 0;
  }, []);


  const [expandedIndex, setExpandedIndexState] = useState<number | null>(null);
  const expandedIndexRef = useRef<number | null>(null);
  const setExpandedIndex = useCallback((idx: number | null) => {
    expandedIndexRef.current = idx;
    setExpandedIndexState(idx);
  }, []);

  const collapseExpanded = useCallback(() => {
    if (expandedIndexRef.current != null) {
      setExpandedIndex(null);
      if (DEBUG) console.log("expanded collapsed via background click");
    }
  }, [setExpandedIndex]);

  useEffect(() => {
    if (!clearStageExternalRef) return;
    clearStageExternalRef.current = clearStage;
    return () => {
      clearStageExternalRef.current = null;
    };
  }, [clearStageExternalRef, clearStage]);

  useEffect(() => {
    if (!collapseExpandedExternalRef) return;
    collapseExpandedExternalRef.current = collapseExpanded;
    return () => { collapseExpandedExternalRef.current = null; };
  }, [collapseExpandedExternalRef, collapseExpanded]);

  useFrame(() => {
    const raw = scroll.offset;
    let p = THREE.MathUtils.clamp((raw - start) / Math.max(1e-6, end - start), 0, 1);
    if (p > snapEndThreshold) p = 1;

    const zTarget = THREE.MathUtils.lerp(0, autoDistance, p);
    zRef.current = zTarget;

    // center index will be computed from zSmoothed below for stability

    zSmoothed.current += (zTarget - zSmoothed.current) * ease;

    // Compute stable center index from the SMOOTHED z to avoid jitter
    if (navLockRef.current > 0) {
      navLockRef.current -= 1;
    } else {
      const idxFloatSmoothed = gap && gap > 0 ? -zSmoothed.current / gap : 0;
      let nearest = Math.round(idxFloatSmoothed);
      nearest = Math.max(0, Math.min((planes ?? 1) - 1, nearest));

      // Hysteresis: require ~0.35 index movement before switching center
      if (typeof planes === "number" && typeof gap === "number" && gap > 0) {
        const prevCenter = (centerIndexRef as any).prev ?? 0;
        let idxStable = nearest;
        if (Math.abs(idxFloatSmoothed - prevCenter) < 0.35) {
          idxStable = prevCenter;
        }
        centerIndexRef.current = idxStable;
        (centerIndexRef as any).prev = idxStable;
      }
    }

    ref.current.position.set(0, 0, zSmoothed.current);

    // one-shot lock to skip expand/return lerps on keypress
    if (expandedSwitchLockRef.current > 0) expandedSwitchLockRef.current -= 1;

    // If a stage exists, make it follow the current center index
    if (stagedIndexRef.current !== null && stageGapRef.current > 0) {
      if (stagedIndexRef.current !== centerIndexRef.current) {
        stagedIndexRef.current = centerIndexRef.current;
      }
    }
  });

  const contextValue = useMemo(
    () => ({
      zRef,
      centerIndexRef,
      gap: gap ?? 0.0001,
      centerOn,
      stagedIndexRef,
      stageGapRef,
      stageAt,
      clearStage,
      expandedIndex,
      expandedIndexRef,
      setExpandedIndex,
      lastExpandedIndexRef,
      expandedSwitchLockRef,
      navLockRef,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gap, centerOn, stageAt, clearStage, expandedIndex]
  );

  return (
    <StackScrollContext.Provider value={contextValue}>
      <group ref={ref}>{children}</group>
    </StackScrollContext.Provider>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Keyboard navigation: ← / →
// ────────────────────────────────────────────────────────────────────────────────
function KeyboardNavigator({ planes }: { planes: number }) {
  const ctx = useContext(StackScrollContext);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping = !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || (target as any).isContentEditable);
      if (isTyping || e.altKey || e.ctrlKey || e.metaKey) return;

      let step = 0;
      if (e.key === "ArrowRight") step = +1;
      else if (e.key === "ArrowLeft") step = -1;
      else return;

      const isExpanded = (ctx?.expandedIndexRef?.current ?? null) !== null;
      if (!isExpanded) return;
      e.preventDefault();

      const current = ctx?.centerIndexRef?.current ?? 0;
      const next = Math.max(0, Math.min(planes - 1, current + step));

      // Synchronously set center to avoid jitter on keypress
      if (ctx?.centerIndexRef) {
        (ctx.centerIndexRef as any).prev = next;
        ctx.centerIndexRef.current = next;
      }
      if (ctx?.navLockRef) ctx.navLockRef.current = 2;

      if ((ctx?.expandedIndexRef?.current ?? null) !== null) {
        const gapAbs = (ctx?.stageGapRef?.current ?? 0) > 0 ? (ctx?.stageGapRef!.current as number) : 1;
        if (ctx?.stagedIndexRef) ctx.stagedIndexRef.current = next;
        if (ctx?.centerIndexRef) {
          (ctx.centerIndexRef as any).prev = next;
          ctx.centerIndexRef.current = next;
        }
        ctx?.stageAt?.(next, gapAbs);
        ctx?.centerOn?.(next);
        if (ctx?.lastExpandedIndexRef) ctx.lastExpandedIndexRef.current = ctx?.expandedIndexRef?.current ?? null;
        if (ctx?.expandedSwitchLockRef) ctx.expandedSwitchLockRef.current = 4; // snap switch for a couple frames
        ctx?.setExpandedIndex?.(next);
        return;
      }

      const hasStage = ((ctx?.stageGapRef?.current ?? 0) > 0) || ((ctx?.stagedIndexRef?.current ?? null) !== null);
      if (hasStage) {
        const gapAbs = (ctx?.stageGapRef?.current ?? 0) > 0 ? (ctx?.stageGapRef!.current as number) : 1;
        if (ctx?.stagedIndexRef) ctx.stagedIndexRef.current = next;
        ctx?.stageAt?.(next, gapAbs); // keep stage and pass the gap to the new center
        ctx?.centerOn?.(next);
      } else {
        ctx?.centerOn?.(next);
      }
    };

    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, planes]);

  return null;
}

// Compute cover cropping for a fixed plane (no squish)
function computeCoverParams(
  iw: number,
  ih: number,
  planeW: number,
  planeH: number
) {
  const planeAR = planeW / planeH;
  const imgAR = iw / ih;

  if (imgAR > planeAR) {
    // Image wider → crop left/right
    const sx = planeAR / imgAR; // 0..1 of width to show
    return { repeatX: sx, repeatY: 1, offsetX: (1 - sx) * 0.5, offsetY: 0 };
  } else {
    // Image taller → crop top/bottom
    const sy = imgAR / planeAR; // 0..1 of height to show
    return { repeatX: 1, repeatY: sy, offsetX: 0, offsetY: (1 - sy) * 0.5 };
  }
}

// Given full-texture mapping (repeat=1,1), scale the plane so the image is not distorted (contain)
function containScaleFactors(
  iw: number,
  ih: number,
  planeW: number,
  planeH: number
) {
  const planeAR = planeW / planeH;
  const imgAR = iw / ih;
  // We'll keep Y factor at 1 and scale X to match the image aspect
  // so (W * fx) / (H * 1) = imgAR  => fx = imgAR / planeAR
  const fx = imgAR / planeAR;
  const fy = 1;
  return { fx, fy };
}
