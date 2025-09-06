import React, { useMemo, useRef, useState, useContext, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrthographicCamera,
  Edges,
  useCursor,
  ScrollControls,
  useScroll,
  Stats,
  useTexture,
} from "@react-three/drei";
import * as THREE from "three";

const DEBUG = true;

const StackScrollContext = React.createContext<{
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
} | null>(null);

export default function ClickableAxonStackDebug() {
  const camRef = useRef<THREE.OrthographicCamera>(null!);

  const IMAGES = useMemo<string[]>(
    () =>
      Array.from({ length: 52 }, (_, i) => `/stack-images/${String(i).padStart(3, "0")}.jpg`),
    []
  );

  const GAP = 0.2;
  const planeCount = IMAGES.length;

  const depth = (planeCount - 1) * GAP;
  const CAM_Y = Math.max(10, depth + 2);
  const pages = Math.max(2, 1 + depth / 10);

  useEffect(() => {
    console.log("Images list (first 5):", IMAGES.slice(0, 5), "total:", IMAGES.length);
  }, [IMAGES]);

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
            <LocalZScroller planes={planeCount} gap={GAP} overshoot={0.0} ease={0.08}>
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
    <group position={[0, planes * 0, 0]}>
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

function setTextureSRGB(tex: THREE.Texture) {
  const anyTex = tex as any;
  const anyTHREE = THREE as any;
  if ("colorSpace" in anyTex && anyTHREE.SRGBColorSpace !== undefined) {
    anyTex.colorSpace = anyTHREE.SRGBColorSpace;
  } else if ("encoding" in anyTex && anyTHREE.sRGBEncoding !== undefined) {
    anyTex.encoding = anyTHREE.sRGBEncoding;
  }
  tex.needsUpdate = true;
}

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

  const [hovered, setHovered] = useState(false);
  const expanded = (ctx?.expandedIndexRef?.current ?? null) === index;
  const [waitingToStage, setWaitingToStage] = useState(false);
  useCursor(hovered);

  const FALLBACK =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const tex = useTexture(src ?? FALLBACK);
  useEffect(() => {
    setTextureSRGB(tex);
  }, [tex]);

  useEffect(() => {
    const img = tex.image as HTMLImageElement | undefined;
    if (!img) return;
    const onload = () => console.log("✅ texture loaded:", src, img.width, img.height);
    const onerror = () => console.error("❌ texture failed:", src);
    img.addEventListener?.("load", onload as any);
    img.addEventListener?.("error", onerror as any);
    return () => {
      img.removeEventListener?.("load", onload as any);
      img.removeEventListener?.("error", onerror as any);
    };
  }, [tex, src]);

  const baseZ = useMemo(() => index * gap, [index, gap]);

  // behavior knobs (same as your working stack)
  const FRONT_SHIFT = 0;
  const PULL = 2.0;
  const ROTATE_SPD = 0.2;
  const MOVE_SPD = 0.18;
  const SCALE_EXPANDED = 4.6;
  const SCALE_SPD = 0.18;
  const OFF_SCREEN_X = 1.0;
  const OFF_SCREEN_Y = -0.6;
  const CENTER_NUDGE_X = -1.0;
  const CENTER_NUDGE_Y = 0.6;
  const RETURN_SPD = 0.18;
  const STAGE_GAP_ABS = 1;

  // temps
  const NEG_Z = useMemo(() => new THREE.Vector3(0, 0, -1), []);
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
    const isStagedHere = stagedIdx === index;
    const stageGapAbs = ctx?.stageGapRef?.current ?? 0;
    const g = ctx?.gap ?? gap;

    if (waitingToStage && isCenter) {
      ctx?.stageAt?.(index, STAGE_GAP_ABS);
      setWaitingToStage(false);
    }

    if (expanded) {
      const parent = ref.current.parent as THREE.Object3D;
      parent.getWorldQuaternion(tmpQParent);
      tmpQInv.copy(tmpQParent).invert();

      camera.getWorldDirection(tmpDir);
      tmpDir.multiplyScalar(-1).normalize();
      tmpQFace.setFromUnitVectors(NEG_Z, tmpDir);
      tmpQTarget.copy(tmpQInv).multiply(tmpQFace);
      ref.current.quaternion.slerp(tmpQTarget, ROTATE_SPD);

      camera.getWorldDirection(tmpFwd).normalize();
      tmpUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
      tmpRight.copy(tmpFwd).cross(tmpUp).normalize();

      const pull = tmpFwd.clone().multiplyScalar(-PULL);
      const offX = tmpRight.clone().multiplyScalar(OFF_SCREEN_X);
      const offY = tmpUp.clone().multiplyScalar(OFF_SCREEN_Y);
      const nudgeX = tmpRight.clone().multiplyScalar(CENTER_NUDGE_X);
      const nudgeY = tmpUp.clone().multiplyScalar(CENTER_NUDGE_Y);

      tmpWorld.set(0, 0, 0).add(pull).add(offX).add(offY).add(nudgeX).add(nudgeY);
      parent.worldToLocal(tmpLocal.copy(tmpWorld));
      ref.current.position.lerp(tmpLocal, MOVE_SPD);

      ref.current.scale.lerp(new THREE.Vector3(SCALE_EXPANDED, SCALE_EXPANDED, 1), SCALE_SPD);

      if (meshRef.current) meshRef.current.renderOrder = 10001;
      if (matRef.current) {
        matRef.current.transparent = false;
        matRef.current.depthTest = false;
        matRef.current.depthWrite = false;
        matRef.current.opacity = 1;
      }
      return;
    }

    // collapsed / staged
    ref.current.position.x += (0 - ref.current.position.x) * RETURN_SPD;
    if (Math.abs(ref.current.position.x) < 1e-4) ref.current.position.x = 0;

    let stageOffset = 0;
    if (stagedIdx != null && g > 0) {
      const k = stagedIdx;
      const delta = Math.max(0, stageGapAbs - g);
      if (index > k) stageOffset = +delta;
      else if (index < k) stageOffset = -delta;
    }

    const shouldLift = hovered || isCenter;
    const targetY = shouldLift ? lift : 0;
    ref.current.position.y += (targetY - ref.current.position.y) * liftSpeed;

    const targetZ = shouldLift ? baseZ + stageOffset - FRONT_SHIFT : baseZ + stageOffset;
    ref.current.position.z += (targetZ - ref.current.position.z) * 0.3;

    ref.current.quaternion.slerp(new THREE.Quaternion(), 0.2);
    ref.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.18);

    if (meshRef.current) meshRef.current.renderOrder = renderOrder;
    if (matRef.current) {
      matRef.current.transparent = false;
      matRef.current.depthTest = true;
      matRef.current.depthWrite = true;
      matRef.current.opacity = 1;
    }

    if (isStagedHere && !isCenter) ctx?.clearStage?.();
  });

  const handleClick = () => {
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
  };  

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
        {DEBUG && <Edges />}
      </mesh>
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
  snapEndThreshold = 0.995,
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

  const centerOn = React.useCallback(
    (index: number, opts?: { animate?: boolean }) => {
      if (!planes || !gap) return;
      const i = Math.max(0, Math.min(planes - 1, index));
      const targetZ = -(i * gap);
      const pLocal =
        autoDistance !== 0
          ? THREE.MathUtils.clamp(targetZ / autoDistance, 0, 1)
          : 0;
      const pGlobal = THREE.MathUtils.clamp(
        start + pLocal * (end - start),
        0,
        1
      );

      const el = (scroll as any).el as HTMLElement | undefined;
      if (!el) return;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      el.scrollTo({
        top: pGlobal * max,
        behavior: opts?.animate === false ? "auto" : "smooth",
      });
    },
    [planes, gap, autoDistance, start, end, scroll]
  );

  const stageAt = React.useCallback((index: number, gapAbs: number) => {
    stagedIndexRef.current = index;
    stageGapRef.current = Math.max(0, gapAbs);
  }, []);
  const clearStage = React.useCallback(() => {
    stagedIndexRef.current = null;
    stageGapRef.current = 0;
  }, []);

  useFrame(() => {
    const raw = scroll.offset;
    let p = THREE.MathUtils.clamp(
      (raw - start) / Math.max(1e-6, end - start),
      0,
      1
    );
    if (p > snapEndThreshold) p = 1;

    const zTarget = THREE.MathUtils.lerp(0, autoDistance, p);
    zRef.current = zTarget;

    if (typeof planes === "number" && typeof gap === "number" && gap > 0) {
      const idxFloat = -zTarget / gap;
      let idx = Math.round(idxFloat + 1e-4);
      idx = Math.max(0, Math.min(planes - 1, idx));
      centerIndexRef.current = idx;
    }

    zSmoothed.current += (zTarget - zSmoothed.current) * ease;
    ref.current.position.set(0, 0, zSmoothed.current);
  });

  const [expandedIndex, setExpandedIndexState] = useState<number | null>(null);
  const expandedIndexRef = useRef<number | null>(null);
  const setExpandedIndex = React.useCallback((idx: number | null) => {
    expandedIndexRef.current = idx;
    setExpandedIndexState(idx);
  }, []);

  return (
    <StackScrollContext.Provider
      value={{
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
      }}
    >
      <group ref={ref}>{children}</group>
    </StackScrollContext.Provider>
  );
}

function KeyboardNavigator({ planes }: { planes: number }) {
  const ctx = useContext(StackScrollContext);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
    
      if ((ctx?.expandedIndexRef?.current ?? null) !== null) {
        const gapAbs = (ctx?.stageGapRef?.current ?? 0) > 0 ? (ctx?.stageGapRef!.current as number) : 1;
        ctx?.stageAt?.(next, gapAbs);
        ctx?.centerOn?.(next);
        ctx?.setExpandedIndex?.(next);
        return;
      }
    
      ctx?.clearStage?.();
      ctx?.centerOn?.(next);
    };
    
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, planes]);

  return null;
}
