import React, { useMemo, useRef, useState, useContext, useEffect, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import {
  OrthographicCamera,
  useCursor,
  ScrollControls,
  useScroll,
} from "@react-three/drei";
import * as THREE from "three";
import "./AxonStack.css"
import fotowalkLogo from "../../assets/EF3_TYPE.png";
import shortLogo from "../../assets/endmarks_short_logo.png";
import LoaderOverlay from "../LoaderOverlay/LoaderOverlay";
import { wireLoadingGate } from "../LoaderOverlay/LoadingGate";

// ── DEBUG TEST KNOBS ─────────────────────────────────────────
const TEST = {
  PAGES_SCALE: 0.5,        // >1 = DOM scroll area bigger; <1 = smaller
  OVERSHOOT: 0,          // positive adds more scroll distance at both ends
  GAP_BASE_MULT: 1,      // scales your base card spacing GAP
  GROUP_GAP_OVERRIDE: -1 // -1 = use real stageGap; otherwise force a number (e.g. 0, 2, 8)
};

// ── BEHAVIOR KNOBS ─────────────────────────────────────────
const CARD_FRONT_SHIFT = 0;
const CARD_PULL = 2.0;
const CARD_ROTATE_SPD = 0.2;
const CARD_MOVE_SPD = 0.18;
const CARD_SCALE_SPD = 0.18;
const CARD_RETURN_SPD = 0.18;
const CARD_SCALE_EXPANDED_DESKTOP_LANDSCAPE = 4.25;
const CARD_SCALE_EXPANDED_DESKTOP_PORTRAIT = 3.75;
const CARD_SCALE_EXPANDED_MOBILE_LANDSCAPE = 1.5;
const CARD_SCALE_EXPANDED_MOBILE_PORTRAIT = 2.85;
const CARD_OFF_SCREEN_X = 1.0;
const CARD_OFF_SCREEN_Y = -0.75;
const CARD_CENTER_NUDGE_X = -1.0;
const CARD_CENTER_NUDGE_Y = 0.6;
const CARD_STAGE_GAP_ABS = 2;
const EXPANDED_RENDER_ORDER = 1_000_000;
const STAGE_GAP_WHEN_STAGED = 2;
const STAGE_GAP_WHEN_EXPANDED = 10;
const BACKDROP_FADE_SPD = 0.18;
// ────────────────────────────────────────────────────────────────────────────────
// Config / Debug
// ────────────────────────────────────────────────────────────────────────────────
const DEBUG = true;

// 1×1 transparent GIF as texture fallback
const FALLBACK_DATA_URL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

// Reusable constants
const VEC_NEG_Z = new THREE.Vector3(0, 0, -1);

const SHARED_PLANE_GEOM = new THREE.PlaneGeometry(1, 1); // for card face & backdrop
const SHARED_BOX_GEOM = new THREE.BoxGeometry(1, 1, 1);
THREE.Cache.enabled = true;

// ────────────────────────────────────────────────────────────────────────────────
// Windowed texture loader (lazy-load only near the center, dispose when far)
// ────────────────────────────────────────────────────────────────────────────────
function useManagedTexture(
  src: string | undefined,
  index: number,
  onImageReady?: (img: HTMLImageElement) => void
) {
  const ctx = React.useContext(StackScrollContext);
  const isMobile = useIsMobile(768);

  // "How many cards around the center should have real textures?"
  const WINDOW_AHEAD = isMobile ? 30 : 55;   // load ahead of center
  const WINDOW_BEHIND = isMobile ? 30 : 55;   // load behind center

  const loaderRef = React.useRef(new THREE.TextureLoader());
  const loadingRef = React.useRef(false);
  const [tex, setTex] = React.useState<THREE.Texture | null>(null);

  // Load once when near; dispose when far.
  useFrame(() => {
    const center = ctx?.centerIndexRef?.current ?? 0;
    const near =
      index >= center - WINDOW_BEHIND && index <= center + WINDOW_AHEAD;

    if (near) {
      if (!tex && !loadingRef.current && src) {
        loadingRef.current = true;
        loaderRef.current.load(
          src,
          (t) => {
            // sampling tuned for photos; no mipmaps to save memory
            t.minFilter = THREE.LinearFilter;
            t.magFilter = THREE.LinearFilter;
            t.generateMipmaps = false;

            // sRGB for correct color in newer/older three versions
            setTextureSRGB(t);

            // Report image size to the card (for cover/contain math)
            const img = t.image as HTMLImageElement | undefined;
            if (img && onImageReady) onImageReady(img);

            setTex(t);
            loadingRef.current = false;
          },
          undefined,
          () => {
            // onError
            loadingRef.current = false;
          }
        );
      }
    } else {
      if (tex) {
        tex.dispose();                 // free GPU + system memory
        setTex(null);
      }
    }
  });

  // Cleanup if card unmounts while texture is loaded
  React.useEffect(() => {
    return () => {
      if (tex) tex.dispose();
    };
  }, [tex]);

  return tex;
}

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
  stagedRangeStartRef?: React.MutableRefObject<number | null>;
  stagedRangeEndRef?: React.MutableRefObject<number | null>;
  stageRangeAt?: (start: number, end: number, gapAbs: number) => void;
  expandedIndex: number | null;
  expandedIndexRef: React.MutableRefObject<number | null>;
  setExpandedIndex?: (idx: number | null) => void;
  lastExpandedIndexRef: React.MutableRefObject<number | null>;
  expandedSwitchLockRef: React.MutableRefObject<number>;
  navLockRef: React.MutableRefObject<number>;
  groupIndexMapRef?: React.MutableRefObject<number[] | null>;
  groupsCountRef?: React.MutableRefObject<number>;
  groupGapsActiveRef?: React.MutableRefObject<boolean>;
  focusGroupRef?: React.MutableRefObject<number>;
  groupNamesRef?: React.MutableRefObject<string[] | null>;
} | null;

type StackNavApi = {
  goTo: (index: number, opts?: { animate?: boolean }) => void;
  goToAndStage: (index: number, gapAbs?: number) => void;
  goToRangeAndStage: (start: number, end: number, gapAbs?: number) => void; // NEW
  goToGroupAndStage: (start: number, end: number, gapAbs?: number) => void;
  clearStage: () => void;
  setAutoScroll: (velPxPerSec: number) => void; // positive = scroll down/forward
  stopAutoScroll: () => void;
};

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
  useEffect(() => { wireLoadingGate(); }, []);
  const isMobile = useIsMobile(768);

  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [centeredIdx, setCenteredIdx] = useState(0);
  const [namesOpen, setNamesOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  const camRef = useRef<THREE.OrthographicCamera>(null!);
  const clearStageRef = useRef<(() => void) | null>(null);
  const collapseExpandedRef = useRef<(() => void) | null>(null);

  const navApiRef = useRef<StackNavApi | null>(null);

  const namesContainerRef = useRef<HTMLDivElement>(null);
  const namesListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = namesListRef.current;
    const host = namesContainerRef.current;
    if (!el || !host) return;

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const maxScroll = Math.max(1, scrollHeight - clientHeight);

      // thumb size proportional to viewport vs content
      const thumbH = (clientHeight / scrollHeight) * 100;
      // top offset proportional to scrollTop within remaining track
      const thumbTop = (scrollTop / maxScroll) * (100 - thumbH);

      host.style.setProperty("--thumb-height", `${thumbH}%`);
      host.style.setProperty("--thumb-top", `${thumbTop}%`);
    };

    // run once now
    update();

    // events
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      el.removeEventListener("scroll", update as any);
      window.removeEventListener("resize", update);
    };
  }, []);

  const TOTAL_IMAGES = 389;

  const IMAGES = useMemo<string[]>(
    () => Array.from({ length: TOTAL_IMAGES }, (_, i) => `/stack-images/thumb/${String(i).padStart(3, "0")}.jpg`),
    []
  );

  // const GAP = 0.18;
  const GAP = 0.18 * TEST.GAP_BASE_MULT;

  // Gap intro animation (0 → GAP after loader)
  const [gapAnimT, setGapAnimT] = useState(0); // 0..1
  const rafRef = useRef<number | null>(null);

  const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
  const ANIMATED_GAP = useMemo(
    () => THREE.MathUtils.lerp(0.0001, GAP, easeOutCubic(gapAnimT)),
    [gapAnimT, GAP]
  );

  const startGapIntro = useCallback((ms = 600) => {
    // cancel any prior loop
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);

    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / ms;
      if (t >= 1) {
        setGapAnimT(1);
        rafRef.current = null;
        return;
      }
      setGapAnimT(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    setGapAnimT(0);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);


  useEffect(() => {
    const onDone = () => startGapIntro(600);
    window.addEventListener("loader:done", onDone);
    return () => window.removeEventListener("loader:done", onDone);
  }, [startGapIntro]);

  const planeCount = IMAGES.length;

  const ANCHORS = useMemo<Photographer[]>(() => {
    const safe = (i: number) => Math.max(0, Math.min(planeCount - 1, i));
    return [
      // { name: "Adrianna Figueroa", instagram: "adrianafigue", indices: [safe(0), safe(3)] },
      { name: "Adrianna Figueroa", indices: [safe(0), safe(3)] },
      { name: "Adriel Ildefonso", indices: [safe(4), safe(7)] },
      { name: "Alex Lopez", indices: [safe(8), safe(17)] },
      { name: "Alondra Ramos", indices: [safe(18), safe(29)] },
      { name: "Ambar Yezabeth Cosme Pabon", indices: [safe(30), safe(31)] },
      { name: "Andrea Pérez Molina", indices: [safe(32), safe(40)] },
      { name: "Ariana González Palaez", indices: [safe(41), safe(47)] },
      { name: "Aurelio Rodríguez", indices: [safe(48), safe(58)] },
      { name: "Carlos-René Ramírez", indices: [safe(59), safe(61)] },
      { name: "Carolina Robles", indices: [safe(62), safe(69)] },
      { name: "Christian Soto", indices: [safe(70), safe(76)] },
      { name: "David Rodríguez", indices: [safe(77), safe(83)] },
      { name: "Erika Pérez", indices: [safe(84), safe(92)] },
      { name: `Gabriel "Saga" Saldaña`, indices: [safe(93), safe(123)] },
      { name: "Gabriel Morales", indices: [safe(124), safe(129)] },
      { name: "gabriel soria flecha", indices: [safe(130), safe(134)] },
      { name: "giancarlos merced", indices: [safe(135), safe(144)] },
      { name: "giuliana conty", indices: [safe(145), safe(146)] },
      { name: "irene montes", indices: [safe(147), safe(150)] },
      { name: "ivan valdes", indices: [safe(151), safe(157)] },
      { name: "jaime castillo", indices: [safe(158), safe(165)] },
      { name: "jason josel riopedre cuevas", indices: [safe(166), safe(172)] },
      { name: "javier pagán", indices: [safe(173), safe(184)] },
      { name: "jean martínez", indices: [safe(185), safe(192)] },
      { name: "john velez", indices: [safe(193), safe(204)] },
      { name: "jorge echevarría", indices: [safe(205), safe(207)] },
      { name: "josé gonzález", indices: [safe(208), safe(210)] },
      { name: "juan diego lastra", indices: [safe(211), safe(227)] },
      { name: "kevin padilla", indices: [safe(228), safe(229)] },
      { name: "leida nazario", indices: [safe(230), safe(234)] },
      { name: "lorenzo rodriguez", indices: [safe(235), safe(239)] },
      { name: "malia ramos", indices: [safe(240), safe(250)] },
      { name: "maricely galvan", indices: [safe(252), safe(259)] },
      { name: "moises sierra", indices: [safe(260), safe(264)] },
      { name: "nahiara alicea", indices: [safe(265), safe(267)] },
      { name: "natasha colón", indices: [safe(268), safe(271)] },
      { name: "rafael lopez", indices: [safe(272), safe(281)] },
      { name: "rafael ruiz", indices: [safe(282), safe(285)] },
      { name: "reynaldo rodriguez", indices: [safe(286), safe(290)] },
      { name: "richaliz diaz", indices: [safe(291), safe(305)] },
      { name: "robert torres", indices: [safe(306), safe(328)] },
      { name: "rodolfo barrios", indices: [safe(329), safe(337)] },
      { name: "rolando haddock", indices: [safe(338), safe(348)] },
      { name: "samantha ortiz", indices: [safe(349), safe(362)] },
      { name: "sergio lopez", indices: [safe(363), safe(372)] },
      { name: "sigfredo alexae vazquez", indices: [safe(373), safe(377)] },
      { name: "yetzel gonzález", indices: [safe(378), safe(383)] },
      { name: "zabdiel abreu sánchez", indices: [safe(384), safe(388)] },
    ];
  }, [planeCount]);

  const GROUP_RANGES = useMemo<[number, number][]>(() => {
    return ANCHORS.map(({ indices }) => {
      const [a, b] = indices;
      return [Math.min(a, b), Math.max(a, b)] as [number, number];
    });
  }, [ANCHORS]);

  const GROUP_NAMES = useMemo<string[]>(() => ANCHORS.map(a => a.name), [ANCHORS]);

  const baseDepth = (planeCount - 1) * GAP;
  const CAM_Y = Math.max(10, baseDepth + 2);
  const groupsCount = GROUP_RANGES.length;
  const extraPerBreakMax = Math.max(
    0,
    Math.max(STAGE_GAP_WHEN_STAGED, STAGE_GAP_WHEN_EXPANDED) - GAP
  );
  const extraDepthMax = Math.max(0, (groupsCount - 1) * extraPerBreakMax);
  const effectiveDepthMax = baseDepth + extraDepthMax;

  // const pages = Math.max(2, 1 + effectiveDepthMax / 10);
  const pagesBase = Math.max(2, 1 + effectiveDepthMax / 10);
  const pages = pagesBase * TEST.PAGES_SCALE;

  useEffect(() => {
    if (!DEBUG) return;
    console.log("Images list (first 5):", IMAGES.slice(0, 5), "total:", IMAGES.length);
  }, [IMAGES]);

  type Photographer = { name: string; instagram?: string; indices: [number, number] };
  const expandedName = useMemo<Photographer | null>(() => {
    if (expandedIdx == null) return null;
    for (let gi = 0; gi < GROUP_RANGES.length; gi++) {
      const [s, e] = GROUP_RANGES[gi];
      if (expandedIdx >= s && expandedIdx <= e) return ANCHORS[gi];
    }
    return null;
  }, [expandedIdx, GROUP_RANGES, ANCHORS]);

  type ExpandedInfo = {
    current: number;  // 1-based
    total: number;
    start: number;
    end: number;
  };

  const expandedInfo = useMemo<ExpandedInfo | null>(() => {
    if (expandedIdx == null) return null;

    for (let gi = 0; gi < GROUP_RANGES.length; gi++) {
      const [s, e] = GROUP_RANGES[gi]; // already ordered in your GROUP_RANGES
      if (expandedIdx >= s && expandedIdx <= e) {
        const total = e - s + 1;
        const current = Math.min(Math.max(expandedIdx - s + 1, 1), total); // clamp, 1-based
        return { current, total, start: s, end: e };
      }
    }
    return null;
  }, [expandedIdx, GROUP_RANGES]);

  const introActive = gapAnimT < 0.999;
  const fired = useRef(false);

  const selectGroup = useCallback(
    (start: number, end: number) => {
      const go = () =>
        navApiRef.current?.goToGroupAndStage(start, end, STAGE_GAP_WHEN_STAGED);

      // Desktop: go immediately
      if (!isMobile) {
        go();
        return;
      }

      // Mobile: if the sheet is already closed, just go
      if (!namesOpen) {
        go();
        return;
      }

      // Mobile: close the sheet, then wait for the transition to end
      const el = namesContainerRef.current;
      setNamesOpen(false);

      if (el) {
        let fired = false;

        const onEnd = (ev: TransitionEvent) => {
          // We only need it once; any property is fine (opacity/transform)
          if (fired) return;
          fired = true;
          el.removeEventListener("transitionend", onEnd as any);
          go();
        };

        el.addEventListener("transitionend", onEnd as any, { once: true });

        // Safety fallback in case transitionend doesn’t fire
        setTimeout(() => {
          if (fired) return;
          fired = true;
          el.removeEventListener("transitionend", onEnd as any);
          go();
        }, 500); // keep in sync with your CSS duration
      } else {
        // No element? Fallback to a simple delay
        setTimeout(go, 500);
      }
    },
    [isMobile, namesOpen]
  );

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <LoaderOverlay onDone={() => { if (!fired.current) { fired.current = true; startGapIntro(600); } }} />

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
          zoom={160}
          onUpdate={(c) => {
            c.lookAt(0, 0, 0);
            c.updateProjectionMatrix();
          }}
        />

        <ambientLight intensity={0} />
        <directionalLight position={[5, 5, 5]} />

        <ScrollControls pages={pages} damping={0}>
          <group
            rotation={[
              THREE.MathUtils.degToRad(120),
              THREE.MathUtils.degToRad(35.264),
              0,
            ]}
          >
            <LocalZScroller
              planes={planeCount}
              gap={ANIMATED_GAP}
              overshoot={TEST.OVERSHOOT}
              ease={0.12}
              clearStageExternalRef={clearStageRef}
              collapseExpandedExternalRef={collapseExpandedRef}
              navApiExternalRef={navApiRef}
              groupRanges={GROUP_RANGES}
              groupNames={GROUP_NAMES}
              onExpandedChange={setExpandedIdx}
              onCenterChange={setCenteredIdx}
            >
              <KeyboardNavigator planes={planeCount} />
              <AxonStack
                images={IMAGES}
                planes={planeCount}
                gap={ANIMATED_GAP}
                width={1.6}
                height={1}
                lift={introActive ? 0 : -0.25}
                liftSpeed={introActive ? 0 : 0.15}
                groupRanges={GROUP_RANGES}
              />
            </LocalZScroller>
          </group>
        </ScrollControls>

        {/* {DEBUG && <Stats showPanel={0} className="r3f-stats" />} */}
      </Canvas>

      {/* MOBILE BURGER */}
      {isMobile && expandedIdx === null && (
        <button
          className={`axon-burger ab-r ${namesOpen ? "is-active" : ""}`}
          aria-label="Open photographers"
          onClick={() => setNamesOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
      )}

      {expandedIdx === null && (
        <>
          <button
            className={`axon-burger ab-l ${infoOpen ? "is-active" : ""}`}
            aria-label="Open photographers"
            onClick={() => setInfoOpen((v) => !v)}
          >
            𝓲
          </button>

          <div
            className={`axon-info ${infoOpen ? "is-open" : ""}`}
          >
            <span>
              hola this is info
            </span>
          </div>
        </>
      )}

      {/* NAMES LIST */}
      <div
        ref={namesContainerRef}
        aria-hidden={expandedIdx !== null}
        className={`axon-names ${expandedIdx !== null ? "is-hidden" : ""} ${namesOpen ? "is-open" : ""}`}
      >
        <div>
          <div ref={namesListRef} className="axon-names__list">
            {ANCHORS.map((a) => {
              const [start, end] = a.indices;
              const active = centeredIdx >= start && centeredIdx <= end;
              return (
                <button
                  key={a.name}
                  className={`axon-names__btn ${active ? "is-active" : ""}`}
                  onClick={() => selectGroup(start, end)}
                  title={`${a.name} (${start}–${end})`}
                >
                  {a.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* CITY + DATE (top-left) */}
      {!isMobile && (
        <div className="axon-meta">
          ponce, pr
          <br />
          <span className="axon-meta__date">21.06.2025</span>
        </div>
      )}

      {/* TITLE (top-center) */}
      <div className="axon-title">
        <img src={fotowalkLogo} alt="Logo" />
      </div>

      {/* LOGO (bottom-center) */}
      <div className="axon-logo">
        <img src={shortLogo} alt="Logo" />
      </div>

      {isMobile && expandedIdx === null && (
        <ElasticKnob
          onVelocity={(pxPerSec) => navApiRef.current?.setAutoScroll(pxPerSec)}
          onRelease={() => navApiRef.current?.stopAutoScroll()}
        />
      )}

      {/* EXPANDED OVERLAY */}
      {expandedName && (
        <div className="axon-expanded">
          <div>
            <div className="axon-expanded__arrows">

              {isMobile ? (
                <>
                  <HoldArrow dir={-1} />
                  <HoldArrow dir={+1} />
                </>
              ) : (
                <>
                  <button
                    className="axon-expanded__arrowBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft" }));
                    }}
                    aria-label="Previous"
                  >
                    ←
                  </button>
                  <button
                    className="axon-expanded__arrowBtn"
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
                    }}
                    aria-label="Next"
                  >
                    →
                  </button>
                </>
              )}

            </div>

            <div className="axon-expanded__name">{expandedName.name}</div>{expandedInfo && (
              <div className="axon-expanded__count">
                ({expandedInfo.current}/{expandedInfo.total})
              </div>
            )}

            {expandedName.instagram && (
              <span className="axon-expanded__ig">
                instagram:{" "}
                <a
                  href={`https://instagram.com/${expandedName.instagram}`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open @${expandedName.instagram} on Instagram`}
                >
                  @{expandedName.instagram}
                </a>
              </span>
            )}
          </div>
        </div>
      )}
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
  showTicksEvery = 5,
  tickOffset = 0.08,      // margin beyond card edge
  tickLength = 0.14,      // visual length of the line
  tickThickness = 0.006,  // line thickness
  tickSide = "right" as "left" | "right", // which side of the card
  groupRanges,
}: {
  images?: string[];
  planes?: number;
  gap?: number;
  width?: number;
  height?: number;
  lift?: number;
  liftSpeed?: number;
  showTicksEvery?: number;
  tickOffset?: number;
  tickLength?: number;
  tickThickness?: number;
  tickSide?: "left" | "right";
  groupRanges?: [number, number][];

}) {
  const planeScale: [number, number] = [width, height];

  const groupStartSet = React.useMemo(() => {
    if (!groupRanges || groupRanges.length === 0) return null;
    const s = new Set<number>();
    for (const [start] of groupRanges) s.add(start);
    return s;
  }, [groupRanges]);

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
          showTick={groupStartSet ? groupStartSet.has(i) : (showTicksEvery > 0 && i % showTicksEvery === 0)}
          tickSide={tickSide}
          tickOffset={tickOffset}
          tickLength={tickLength}
          tickThickness={tickThickness}
          isLast={i === planes - 1}
        />
      ))}
    </group>
  );
}

// ────────────────────────────────────────────────────────────────────────────────
// Card (single plane)
// ────────────────────────────────────────────────────────────────────────────────

function Card({
  src,
  index,
  gap,
  size,
  lift,
  liftSpeed,
  renderOrder,
  showTick = false,
  tickSide = "right",
  tickOffset = 0.8,
  tickLength = 0.14,
  tickThickness = 0.006,
  isLast = false
}: {
  src?: string;
  index: number;
  gap: number;
  size: [number, number];
  lift: number;
  liftSpeed: number;
  renderOrder: number;
  showTick?: boolean;
  tickSide?: "left" | "right";
  tickOffset?: number;
  tickLength?: number;
  tickThickness?: number;
  isLast?: boolean
}) {
  const isMobile = useIsMobile(768);
  const { CARD_Z_LERP: Z_LERP } = useMotionTuning();

  const lastTickLength = isLast ? tickLength : tickLength; // shorter at the end

  const ctx = useContext(StackScrollContext);
  const { camera } = useThree();

  const ref = useRef<THREE.Group>(null!);
  const meshRef = useRef<THREE.Mesh>(null!);
  const imgSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const fitTRef = useRef(0); // 0 = cover, 1 = contain
  const FIT_SPD = 0.18;
  const backdropRef = useRef<THREE.Mesh>(null!);
  const backdropMatRef = useRef<THREE.MeshBasicMaterial>(null!);
  const tickRef = useRef<THREE.Mesh>(null!);

  const [hovered, setHovered] = useState(false);
  const expanded = (ctx?.expandedIndexRef?.current ?? null) === index;
  const [waitingToStage, setWaitingToStage] = useState(false);
  useCursor(hovered);

  const frontMat = React.useMemo(() => makeBaseFrontMaterial(), []);
  const matRef = useRef<THREE.MeshBasicMaterial>(frontMat);

  // Texture
  // Managed / windowed texture loading
  const onTexReady = React.useCallback((img: HTMLImageElement) => {
    if (DEBUG) console.log("✅ texture loaded:", src, img.width, img.height);
    imgSizeRef.current = { w: img.width || 0, h: img.height || 0 };
  }, [src]);

  const tex = useManagedTexture(src ?? FALLBACK_DATA_URL, index, onTexReady);

  React.useEffect(() => {
    if (!matRef.current) return;
    // map must be Texture | null (not undefined)
    matRef.current.map = tex ?? null;
    matRef.current.needsUpdate = true;
  }, [tex]);


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
    const stagedIdx = ctx?.stagedIndexRef?.current ?? null;
    const rangeStart = ctx?.stagedRangeStartRef?.current ?? null;
    const rangeEnd = ctx?.stagedRangeEndRef?.current ?? null;
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
    let containFx = 1, containFy = 1;

    const iw = imgSizeRef.current.w;
    const ih = imgSizeRef.current.h;
    const planeIsPortrait = size[1] >= size[0];
    const isPortrait = (iw > 0 && ih > 0) ? (ih >= iw) : planeIsPortrait;

    const expandedBaseScale = isMobile
      ? (isPortrait ? CARD_SCALE_EXPANDED_MOBILE_PORTRAIT : CARD_SCALE_EXPANDED_MOBILE_LANDSCAPE)
      : (isPortrait ? CARD_SCALE_EXPANDED_DESKTOP_PORTRAIT : CARD_SCALE_EXPANDED_DESKTOP_LANDSCAPE);

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

      // Only mutate the texture when it exists
      if (tex) {
        tex.center.set(0.5, 0.5);
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.offset.set(offsetX, offsetY);
        // If you see stale UVs, uncomment next line:
        // tex.needsUpdate = true;
      }
    }

    if (waitingToStage && isCenter) {
      // If group gaps are active, do NOT single-stage; just center (and the lift will apply).
      if (!ctx?.groupGapsActiveRef?.current) {
        ctx?.stageAt?.(index, CARD_STAGE_GAP_ABS);
      }
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
        expandedBaseScale * (iw > 0 ? THREE.MathUtils.lerp(1, containFx, fitTRef.current) : 1),
        expandedBaseScale * (iw > 0 ? THREE.MathUtils.lerp(1, containFy, fitTRef.current) : 1),
        1
      );

      if (switchLock > 0) {
        ref.current.position.copy(tmpLocal);
        ref.current.scale.copy(anisotropicTarget);     // snap scale on switch
      } else {
        ref.current.position.lerp(tmpLocal, CARD_MOVE_SPD);
        ref.current.scale.lerp(anisotropicTarget, CARD_SCALE_SPD);
      }

      if (meshRef.current) meshRef.current.renderOrder = EXPANDED_RENDER_ORDER + 1;
      ref.current.renderOrder = EXPANDED_RENDER_ORDER + 1;
      if (matRef.current) {
        matRef.current.transparent = true;
        matRef.current.depthTest = false;
        matRef.current.depthWrite = false;
        matRef.current.depthFunc = THREE.AlwaysDepth;
        matRef.current.polygonOffset = true;
        matRef.current.polygonOffsetFactor = -1;
        matRef.current.polygonOffsetUnits = -4;
        matRef.current.opacity = 1;
      }

      if (backdropRef.current && backdropMatRef.current && ref.current) {
        const mat = backdropMatRef.current;
        backdropRef.current.quaternion.copy(ref.current.quaternion);
        backdropRef.current.position.copy(ref.current.position);
        backdropRef.current.scale.set(200, 200, 1);
        backdropRef.current.renderOrder = EXPANDED_RENDER_ORDER - 1;
        backdropRef.current.visible = true;

        // snap to full white during arrow switch to avoid glimpse
        if (switchLock > 0) {
          mat.opacity = 1;
        } else {
          const target = 1;
          mat.opacity += (target - mat.opacity) * BACKDROP_FADE_SPD;
          if (Math.abs(target - mat.opacity) < 1e-3) mat.opacity = target;
        }
      }

      return;
    }

    // fade out when not expanded
    if (backdropRef.current && backdropMatRef.current) {
      const mat = backdropMatRef.current;

      // if we JUST lost expansion because of a switch, keep the white plate up
      if (switchLock > 0 && lastExpanded === index) {
        backdropRef.current.visible = true;
        mat.opacity = 1; // hold at full white during the switch
      } else {
        const target = 0;
        mat.opacity += (target - mat.opacity) * BACKDROP_FADE_SPD;
        if (Math.abs(mat.opacity - target) < 1e-3) {
          mat.opacity = 0;
          backdropRef.current.visible = false; // hide only once fully transparent
        } else {
          backdropRef.current.visible = true; // keep drawing during fade
        }
      }
    }


    // Collapsed / staged behavior
    ref.current.position.x += (0 - ref.current.position.x) * CARD_RETURN_SPD;
    if (Math.abs(ref.current.position.x) < 1e-4) ref.current.position.x = 0;

    let stageOffset = 0;
    const delta = Math.max(0, stageGapAbs - g);

    // 1) If SINGLE or RANGE staging is active, it takes PRECEDENCE
    if (g > 0) {
      if (rangeStart !== null && rangeEnd !== null) {
        if (index < rangeStart) stageOffset = -delta;
        else if (index > rangeEnd) stageOffset = +delta;
        // inside range: 0
      } else if (stagedIdx !== null) {
        if (index > stagedIdx) stageOffset = +delta;
        else if (index < stagedIdx) stageOffset = -delta;
        // staged index: 0
      } else if (ctx?.groupGapsActiveRef?.current && (ctx?.stageGapRef?.current ?? 0) > 0) {
        // 2) Otherwise, apply GROUP gaps
        const map = ctx.groupIndexMapRef?.current;
        const gi = map ? map[index] : -1;
        if (gi >= 0) {
          const focusG = ctx.focusGroupRef?.current ?? 0;
          stageOffset = (gi - focusG) * delta;
        }
      }
    }

    const isStagedSingle = stagedIdx === index;
    const isStagedRange = (rangeStart !== null && rangeEnd !== null) ? (index >= rangeStart && index <= rangeEnd) : false;
    const isStaged = isStagedSingle || isStagedRange;

    const allowCenterLiftInsideRange = isCenter && isStagedRange;

    const navLock = ctx?.navLockRef?.current ?? 0;
    const shouldLift = (allowCenterLiftInsideRange || !isStaged) && (navLock > 0 ? isCenter : (hovered || isCenter));
    const targetY = shouldLift ? lift : 0;
    ref.current.position.y += (targetY - ref.current.position.y) * liftSpeed;

    const targetZ = shouldLift ? baseZ + stageOffset - CARD_FRONT_SHIFT : baseZ + stageOffset;
    if (switchLock > 0 && lastExpanded === index) {
      ref.current.position.x = 0;
      ref.current.position.y = targetY;
      ref.current.position.z = targetZ;
    } else {
      ref.current.position.z += (targetZ - ref.current.position.z) * Z_LERP;
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

    if (tickRef.current) {
      if (!expanded) {
        // Parent (ref) is being lifted on Y; negate it on the child tick
        tickRef.current.position.y = -ref.current.position.y;
      } else {
        // In expanded mode, let the tick follow normally
        tickRef.current.position.y = 0;
      }
    }
  });

  const handleClick = useCallback(() => {
    const isCenter = (ctx?.centerIndexRef?.current ?? -1) === index;

    const stagedIdx = ctx?.stagedIndexRef?.current ?? null;
    const rangeStart = ctx?.stagedRangeStartRef?.current ?? null;
    const rangeEnd = ctx?.stagedRangeEndRef?.current ?? null;

    const groupGapsOn = !!ctx?.groupGapsActiveRef?.current;
    const inStagedRange =
      rangeStart !== null && rangeEnd !== null && index >= rangeStart && index <= rangeEnd;

    if (expanded) {
      ctx?.setExpandedIndex?.(null);
      return;
    }

    // If any group gaps mode is on: click-to-center, then click-to-expand
    // (unchanged behavior)
    if (groupGapsOn) {
      if (!isCenter) {
        ctx?.centerOn?.(index);
        setWaitingToStage(false);
        return;
      }
      ctx?.setExpandedIndex?.(index);
      return;
    }

    // --- Group gaps OFF (legacy path), but we might have a RANGE staged ---

    // If we're not centered yet: center (no single-stage arming)
    if (!isCenter) {
      ctx?.centerOn?.(index);
      setWaitingToStage(false);
      return;
    }

    // ✅ NEW: already inside a staged RANGE → expand immediately (single click)
    if (inStagedRange) {
      ctx?.setExpandedIndex?.(index);
      return;
    }

    // If there’s no range staging and not single-staged yet → single-stage
    const isSingleStagedHere = stagedIdx === index;
    if (!isSingleStagedHere && rangeStart === null && rangeEnd === null) {
      ctx?.stageAt?.(index, 2);
      return;
    }

    // Otherwise expand
    ctx?.setExpandedIndex?.(index);
  }, [ctx, expanded, index, setWaitingToStage]);


  return (
    <group ref={ref} position={[0, 0, baseZ]} renderOrder={renderOrder}>

      <mesh ref={backdropRef} visible={false} geometry={SHARED_PLANE_GEOM}>
        <meshBasicMaterial
          ref={backdropMatRef}
          color="white"
          transparent
          opacity={0}
          depthTest={false}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {showTick && (
        <mesh
          ref={tickRef}
          geometry={SHARED_BOX_GEOM}
          // horizontal bar: X = length, Y = thin, Z = thin
          position={[
            (tickSide === "right" ? +1 : -1) * (size[0] / 1.2 + tickOffset),
            0,
            -0.712,
          ]}
          scale={[lastTickLength, tickThickness, tickThickness]}
        >
          <meshBasicMaterial color="#adadad" toneMapped={false} />
        </mesh>
      )}

      <mesh
        ref={meshRef}
        rotation={[0, 0, Math.PI]}
        scale={[-1, 1, 1]}
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
  snapEndThreshold = 1.5,
  clearStageExternalRef,
  collapseExpandedExternalRef,
  navApiExternalRef,
  groupRanges,
  groupNames,
  onExpandedChange,
  onCenterChange,
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
  navApiExternalRef?: React.MutableRefObject<StackNavApi | null>;
  groupRanges?: [number, number][];
  groupNames?: string[];
  onExpandedChange?: (idx: number | null) => void;
  onCenterChange?: (idx: number) => void;
}) {
  const ref = useRef<THREE.Group>(null!);
  const scroll = useScroll();
  const isMobile = useIsMobile(768);
  const followRangeRef = useRef<boolean>(false);
  const RANGE_EXIT_HYST = 0;
  const autoVelRef = useRef<number>(0);

  const zRef = useRef(0);
  const centerIndexRef = useRef(0);
  const zSmoothed = useRef(0);

  const stagedIndexRef = useRef<number | null>(null);
  const stageGapRef = useRef<number>(0);
  const lastExpandedIndexRef = useRef<number | null>(null);
  const expandedSwitchLockRef = useRef<number>(0);
  const navLockRef = useRef<number>(0);

  const pendingStageIndexRef = useRef<number | null>(null);
  const pendingStageGapRef = useRef<number>(2);

  const stagedRangeStartRef = useRef<number | null>(null);
  const stagedRangeEndRef = useRef<number | null>(null);
  const stagedRangeSpanRef = useRef<number>(0);
  const prevStageGapRef = useRef<number>(0);

  const prevGroupGapsActiveRef = useRef<boolean>(false);
  const prevStagedIndexRef = useRef<number | null>(null);
  const prevRangeStartRef = useRef<number | null>(null);
  const prevRangeEndRef = useRef<number | null>(null);

  const tune = useMotionTuning();

  const lastEmittedCenterRef = useRef<number>(centerIndexRef.current ?? 0);

  const stageOffsetForIndex = useCallback((i: number) => {
    const g = gap ?? 0;
    const stageGap = stageGapRef.current ?? 0;
    if (!(groupGapsActiveRef.current && stageGap > 0)) return 0;

    const map = groupIndexMapRef.current;
    const gi = map ? map[i] : -1;
    if (gi < 0) return 0;

    const focusG = focusGroupRef.current ?? 0;
    const delta = Math.max(0, stageGap - g);
    return (gi - focusG) * delta;
  }, [gap]);

  // Where the stack really starts/ends in Z right now
  const getZSpan = useCallback(() => {
    const g = gap ?? 0;
    const maxIdx = Math.max(0, (planes ?? 1) - 1);

    // stage offsets for first/last card with current group state
    const offTop = stageOffsetForIndex(0);
    const offBottom = stageOffsetForIndex(maxIdx);

    const zTop = -(0 * g + offTop);
    const zBottom = -(maxIdx * g + offBottom);

    // NOTE: zBottom is typically < zTop (more negative)
    const span = zBottom - zTop; // negative number; length = Math.abs(span)

    return { zTop, zBottom, span };
  }, [gap, planes, stageOffsetForIndex]);

  // pending “stage-after-arrive” for ranges
  const pendingStageRangeRef = useRef<{
    start: number;
    end: number;
    gapAbs: number;
    triggerAt: number;
    follow?: boolean; // NEW (default false)
  } | null>(null);

  const groupIndexMap = useMemo(() => {
    if (!groupRanges || !planes) return null;
    const map = new Array(planes).fill(-1);
    groupRanges.forEach(([s, e], gi) => {
      for (let i = s; i <= e && i < planes; i++) map[i] = gi;
    });
    return map as number[];
  }, [groupRanges, planes]);

  const groupIndexMapRef = useRef<number[] | null>(null);
  useEffect(() => { groupIndexMapRef.current = groupIndexMap; }, [groupIndexMap]);

  const groupsCountRef = useRef<number>(groupRanges?.length ?? 0);
  useEffect(() => { groupsCountRef.current = groupRanges?.length ?? 0; }, [groupRanges]);

  // Always-on multi-range staging flag + the focused group id
  const groupGapsActiveRef = useRef<boolean>(false);
  const focusGroupRef = useRef<number>(0);

  const groupNamesRef = useRef<string[] | null>(null);
  useEffect(() => { groupNamesRef.current = groupNames ?? null; }, [groupNames]);


  const centerOn = useCallback(
    (index: number, opts?: { animate?: boolean }) => {
      if (!planes || gap == null) return;
      const i = Math.max(0, Math.min(planes - 1, index));

      // target card Z with whatever gaps are active *right now*
      const g = gap ?? 0;
      const targetZ = -(i * g + stageOffsetForIndex(i));

      // map to DOM scroll using the **actual** z span
      const { zTop, zBottom } = getZSpan();
      const pLocal = THREE.MathUtils.clamp((targetZ - zTop) / (zBottom - zTop), 0, 1);
      const pGlobal = THREE.MathUtils.clamp(start + pLocal * (end - start), 0, 1);

      const el = (scroll as any).el as HTMLElement | undefined;
      if (!el) return;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      el.scrollTo({ top: pGlobal * max, behavior: "auto" });
    },
    [planes, gap, start, end, scroll, stageOffsetForIndex, getZSpan]
  );

  const stageRangeAt = useCallback((start: number, end: number, gapAbs: number, follow = false) => {
    // clear single index mode
    stagedIndexRef.current = null;

    // clamp and order
    const maxIdx = (planes ?? 1) - 1;
    const s = Math.max(0, Math.min(maxIdx, Math.min(start, end)));
    const e = Math.max(0, Math.min(maxIdx, Math.max(start, end)));

    stagedRangeStartRef.current = s;
    stagedRangeEndRef.current = e;
    stagedRangeSpanRef.current = e - s;   // still useful for “follow” mode
    stageGapRef.current = Math.max(0, gapAbs);

    followRangeRef.current = !!follow;    // NEW
  }, [planes]);

  const stageAt = useCallback((index: number, gapAbs: number) => {
    stagedIndexRef.current = index;
    stageGapRef.current = Math.max(0, gapAbs);
  }, []);

  const clearStage = useCallback(() => {
    // Keep whichever card is currently centered
    const keepIndex = centerIndexRef.current ?? 0;

    // Clear legacy single/range staging
    stagedIndexRef.current = null;
    stagedRangeStartRef.current = null;
    stagedRangeEndRef.current = null;
    stagedRangeSpanRef.current = 0;

    // Turn off group gaps
    const wasGroupGaps = !!groupGapsActiveRef.current;
    groupGapsActiveRef.current = false;
    stageGapRef.current = 0;

    if (wasGroupGaps) {
      // Snap stack Z to where THIS same index lives with gaps closed
      const g = gap ?? 0;
      const zSnap = -(keepIndex * g);
      zSmoothed.current = zSnap;   // snap the internal integrator
      zRef.current = zSnap;
      if (ref.current) ref.current.position.set(0, 0, zSnap);

      // Sync DOM scroll to new mapping so camera/lift and index stay aligned
      centerOn(keepIndex);
      navLockRef.current = 2; // avoid jitter for a couple frames
    }
  }, [gap, centerOn]);

  const [expandedIndex, setExpandedIndexState] = useState<number | null>(null);
  const expandedIndexRef = useRef<number | null>(null);
  const setExpandedIndex = useCallback((idx: number | null) => {
    const wasExpanded = expandedIndexRef.current != null; // read BEFORE we change it

    expandedIndexRef.current = idx;
    setExpandedIndexState(idx);
    onExpandedChange?.(idx);

    if (idx != null) {
      // ENTERING expanded
      if (!wasExpanded) {
        // Snapshot ONCE (rising edge)
        prevStageGapRef.current = stageGapRef.current;
        prevGroupGapsActiveRef.current = !!groupGapsActiveRef.current;
        prevStagedIndexRef.current = stagedIndexRef.current;
        prevRangeStartRef.current = stagedRangeStartRef.current;
        prevRangeEndRef.current = stagedRangeEndRef.current;

        // Use the large gap only while expanded
        stageGapRef.current = STAGE_GAP_WHEN_EXPANDED;
      }
      // If we were already expanded (switching images), DO NOT touch gap or snapshots.

    } else {
      // LEAVING expanded
      if (wasExpanded) {
        // Restore ONCE (falling edge)
        const hadGroupGapsBefore = !!prevGroupGapsActiveRef.current;
        const hadSingleBefore = prevStagedIndexRef.current !== null;
        const hadRangeBefore = prevRangeStartRef.current !== null && prevRangeEndRef.current !== null;

        if (hadGroupGapsBefore) {
          // restore group gaps + original gap
          groupGapsActiveRef.current = true;
          stageGapRef.current = prevStageGapRef.current;

          // clear any temp single/range staging created while expanded
          stagedIndexRef.current = null;
          stagedRangeStartRef.current = null;
          stagedRangeEndRef.current = null;
          stagedRangeSpanRef.current = 0;

        } else if (hadSingleBefore || hadRangeBefore) {
          // restore whichever staging existed before
          groupGapsActiveRef.current = false;
          stageGapRef.current = prevStageGapRef.current;

          stagedIndexRef.current = hadSingleBefore ? prevStagedIndexRef.current : null;
          if (hadRangeBefore) {
            stagedRangeStartRef.current = prevRangeStartRef.current;
            stagedRangeEndRef.current = prevRangeEndRef.current;
            stagedRangeSpanRef.current = prevRangeEndRef.current! - prevRangeStartRef.current!;
          } else {
            stagedRangeStartRef.current = null;
            stagedRangeEndRef.current = null;
            stagedRangeSpanRef.current = 0;
          }

        } else {
          // there was NO staging before expanding → clear any temp staging
          groupGapsActiveRef.current = false;
          stagedIndexRef.current = null;
          stagedRangeStartRef.current = null;
          stagedRangeEndRef.current = null;
          stagedRangeSpanRef.current = 0;
          stageGapRef.current = 0;
        }

        // defensive: clear any pending stage actions
        pendingStageIndexRef.current = null;
        pendingStageRangeRef.current = null;

        const keepIndex = centerIndexRef.current ?? 0;
        centerOn(keepIndex);
        navLockRef.current = 2;
      }
    }
  }, [onExpandedChange, centerOn]);

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

  useEffect(() => {
    const el = (scroll as any).el as HTMLElement | undefined;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // Only block when something is expanded
      if (expandedIndexRef.current != null) {
        e.preventDefault();
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (expandedIndexRef.current != null) {
        e.preventDefault();
      }
    };

    // must be passive:false to allow preventDefault
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel as any);
      el.removeEventListener("touchmove", onTouchMove as any);
    };
  }, [scroll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (expandedIndexRef.current == null) return;
      // block common page-scrolling keys; keep ArrowLeft/Right untouched
      const k = e.key;
      if (k === "PageDown" || k === "PageUp" || k === " " || k === "ArrowUp" || k === "ArrowDown") {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!navApiExternalRef) return;

    const clampIndex = (i: number) =>
      Math.max(0, Math.min((planes ?? 1) - 1, i));

    const api: StackNavApi = {
      goTo: (index, opts) => {
        centerOn(clampIndex(index), opts);
      },
      goToAndStage: (index, gapAbs = 2) => {
        const i = clampIndex(index);
        pendingStageIndexRef.current = i;
        pendingStageGapRef.current = Math.max(0, gapAbs);
        centerOn(i); // smooth scroll; stage when centered
      },
      goToRangeAndStage: (start, end, gapAbs = 2) => {
        // 1) Clear any single/range staging visuals
        clearStage();

        // 2) Compute clamped start/end and target group id
        const s = Math.max(0, Math.min((planes ?? 1) - 1, Math.min(start, end)));
        const e = Math.max(0, Math.min((planes ?? 1) - 1, Math.max(start, end)));

        let gid = 0;
        if (groupRanges) {
          // exact match first; otherwise, group containing s
          gid = groupRanges.findIndex(([gs, ge]) => gs === s && ge === e);
          if (gid < 0) gid = Math.max(0, groupRanges.findIndex(([gs, ge]) => s >= gs && s <= ge));
        }

        // 3) OPEN THE GAPS NOW (before we move)
        groupGapsActiveRef.current = true;
        stageGapRef.current = Math.max(0, gapAbs);
        if (typeof gid === "number") focusGroupRef.current = gid;

        // 4) Travel to the first (or center) panel *with gaps already open*
        //    If you prefer center of the group, compute it like:
        //    const mid = Math.round((s + e) / 2);
        //    centerOn(mid);
        centerOn(s);

        // Optional: tiny lock to avoid a couple frames of jitter
        navLockRef.current = 2;
      },
      goToGroupAndStage: (start, end, gapAbs = 2) => {
        clearStage(); // ensure clean state so lift works while traveling

        const s = clampIndex(Math.min(start, end));
        const e = clampIndex(Math.max(start, end));

        pendingStageRangeRef.current = {
          start: s,
          end: e,
          gapAbs: Math.max(0, gapAbs),
          triggerAt: s,
          follow: false, // FIXED group
        };

        centerOn(s);              // travel first (lift works here)
        navLockRef.current = 2;
      },
      setAutoScroll: (velPxPerSec) => { autoVelRef.current = velPxPerSec; },
      stopAutoScroll: () => { autoVelRef.current = 0; },
      clearStage,

    };

    navApiExternalRef.current = api;
    return () => { navApiExternalRef.current = null; };
  }, [navApiExternalRef, planes, centerOn, clearStage, groupRanges]);

  useEffect(() => {
    const el = (scroll as any).el as HTMLElement | undefined;
    if (!el || !isMobile) return;

    // invert WHEEL
    const onWheel = (e: WheelEvent) => {
      // let your existing “expanded prevents scroll” logic run first:
      if (expandedIndexRef.current != null) return;

      e.preventDefault(); // we’ll drive scrollTop manually
      el.scrollTop -= e.deltaY; // invert direction
    };

    // invert TOUCH
    let lastY = 0;
    let active = false;

    const onTouchStart = (e: TouchEvent) => {
      if (expandedIndexRef.current != null) return;
      if (e.touches.length !== 1) return;
      active = true;
      lastY = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!active || expandedIndexRef.current != null) return;
      e.preventDefault();
      const y = e.touches[0].clientY;
      const dy = y - lastY;
      lastY = y;
      el.scrollTop -= dy; // invert: swipe down => go forward
    };

    const onTouchEnd = () => { active = false; };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("wheel", onWheel as any);
      el.removeEventListener("touchstart", onTouchStart as any);
      el.removeEventListener("touchmove", onTouchMove as any);
      el.removeEventListener("touchend", onTouchEnd as any);
    };
  }, [scroll, isMobile]);


  useFrame((state, dt) => {
    const raw = scroll.offset;

    // 1) Normalize to [0,1] in your window
    let p = THREE.MathUtils.clamp(
      (raw - start) / Math.max(1e-6, end - start),
      0,
      1
    );

    // Optional physical end detection
    const el = (scroll as any).el as HTMLElement | undefined;
    if (el) {
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const atTop = el.scrollTop <= 1;
      const atBottom = Math.abs(el.scrollTop - max) <= 1;
      if (atTop) p = 0;
      if (atBottom) p = 1;
    }

    const snap = (snapEndThreshold ?? 0.995);
    if (p > snap) p = 1;
    else if (p < (1 - snap)) p = 0;

    const { zTop, zBottom } = getZSpan();

    // map scroll p∈[0..1] to z∈[zTop..zBottom]
    const zTarget = THREE.MathUtils.lerp(zTop, zBottom, p);

    // 3) HYBRID CONTROLLER (no p==0/1 snap for zSmoothed)
    const oneGap = (gap ?? 0.018);

    // Far threshold: when we're farther than this, use constant-speed catchup
    const farThreshold = oneGap * tune.CARD_FAR_THOLD;
    const maxSpeed = oneGap * tune.CARD_MAX_SPD;             // cards per second (try 12–18)
    const maxStep = maxSpeed * dt;           // per-frame step cap


    const delta = zTarget - zSmoothed.current;

    if (Math.abs(delta) > farThreshold) {
      // FAR: constant-speed catchup (predictable, no “laggy” feel)
      const step = Math.sign(delta) * maxStep;
      zSmoothed.current += Math.abs(delta) > Math.abs(step) ? step : delta;
    } else {
      const alpha = 1 - Math.exp(-dt / Math.max(1e-4, tune.TAU));
      zSmoothed.current += delta * alpha;
    }

    // Numeric snap only (finish tiny remainder cleanly)
    const eps = Math.max(1e-4, oneGap * 0.0001);
    if (Math.abs(zTarget - zSmoothed.current) < eps) {
      zSmoothed.current = zTarget;
    }

    zRef.current = zSmoothed.current;

    // 4) ---- the rest stays like you had it ----

    // Stage-after-arrive (single)
    if (
      pendingStageIndexRef.current !== null &&
      centerIndexRef.current === pendingStageIndexRef.current
    ) {
      stageAt(centerIndexRef.current, pendingStageGapRef.current);
      pendingStageIndexRef.current = null;
    }

    // Follow-range with fixed span
    if (
      followRangeRef.current &&
      stagedRangeStartRef.current !== null &&
      stagedRangeEndRef.current !== null &&
      stageGapRef.current > 0
    ) {
      const span = stagedRangeSpanRef.current;
      const center = centerIndexRef.current;
      const maxIdx = (planes ?? 1) - 1;
      const maxStart = Math.max(0, maxIdx - span);

      let startFollow = Math.floor(center - span / 2);
      startFollow = Math.max(0, Math.min(maxStart, startFollow));
      const endFollow = startFollow + span;

      stagedRangeStartRef.current = startFollow;
      stagedRangeEndRef.current = endFollow;
    }

    // Auto-collapse if we have a fixed staged group and center leaves its bounds
    if (
      !followRangeRef.current &&
      stagedRangeStartRef.current !== null &&
      stagedRangeEndRef.current !== null &&
      stageGapRef.current > 0
    ) {
      const s = stagedRangeStartRef.current;
      const e = stagedRangeEndRef.current;
      const c = centerIndexRef.current;
      const outside = (c < s - RANGE_EXIT_HYST) || (c > e + RANGE_EXIT_HYST);

      if (outside) {
        clearStage();            // back to no gaps
        navLockRef.current = 2;  // small jitter guard
      }
    }

    {
      const el = (scroll as any).el as HTMLElement | undefined;
      if (el && expandedIndexRef.current == null) {
        const v = autoVelRef.current; // px/sec
        if (v !== 0) {
          el.scrollTop += v * dt;
          if (el.scrollTop < 0) el.scrollTop = 0;
          const max = Math.max(0, el.scrollHeight - el.clientHeight);
          if (el.scrollTop > max) el.scrollTop = max;
        }
      }
    }

    // Stage the range once we arrive at its center
    if (pendingStageRangeRef.current) {
      const { start, end, gapAbs, triggerAt, follow = false } = pendingStageRangeRef.current;
      if (centerIndexRef.current === triggerAt) {
        stageRangeAt(start, end, gapAbs, follow); // pass follow
        pendingStageRangeRef.current = null;
      }
    } else if (
      pendingStageIndexRef.current !== null &&
      centerIndexRef.current === pendingStageIndexRef.current
    ) {
      stageAt(centerIndexRef.current, pendingStageGapRef.current);
      pendingStageIndexRef.current = null;
    }

    // 5) Compute center index from **zSmoothed** (keeps lift and camera in sync)
    if (navLockRef.current > 0) {
      navLockRef.current -= 1;
    } else {
      const g = gap ?? 0;
      const zOfIndex = (i: number) => {
        let off = 0;
        if (groupGapsActiveRef.current && (stageGapRef.current ?? 0) > 0) {
          const map = groupIndexMapRef.current;
          const gi = map ? map[i] : -1;
          if (gi >= 0) {
            const focusG = focusGroupRef.current ?? 0;
            const delta = Math.max(0, (stageGapRef.current ?? 0) - g);
            off = (gi - focusG) * delta;
          }
        }
        return -(i * g + off);
      };

      const maxIdx = Math.max(0, (planes ?? 1) - 1);
      let nearest = 0, best = Infinity;
      for (let i = 0; i <= maxIdx; i++) {
        const d = Math.abs(zSmoothed.current - zOfIndex(i));
        if (d < best) { best = d; nearest = i; }
      }

      const prev = (centerIndexRef as any).prev ?? nearest;
      const prevDist = Math.abs(zSmoothed.current - zOfIndex(prev));
      if (prevDist < g * 0.35) nearest = prev;

      centerIndexRef.current = nearest;
      (centerIndexRef as any).prev = nearest;
    }

    // 6) Apply transform once
    ref.current.position.set(0, 0, zSmoothed.current);



    if (onCenterChange && centerIndexRef.current !== lastEmittedCenterRef.current) {
      lastEmittedCenterRef.current = centerIndexRef.current;
      onCenterChange(centerIndexRef.current);
    }

    if (expandedSwitchLockRef.current > 0) expandedSwitchLockRef.current -= 1;

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
      stagedRangeStartRef,
      stagedRangeEndRef,
      stageRangeAt,
      expandedIndex,
      expandedIndexRef,
      setExpandedIndex,
      lastExpandedIndexRef,
      expandedSwitchLockRef,
      navLockRef,
      groupIndexMapRef,
      groupsCountRef,
      groupGapsActiveRef,
      focusGroupRef,
      groupNamesRef,
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

      const isExpanded = (ctx?.expandedIndexRef?.current ?? null) !== null;
      if (!isExpanded) return; // only handle arrows when expanded
      e.preventDefault();

      const current = ctx?.centerIndexRef?.current ?? 0;
      const next = Math.max(0, Math.min(planes - 1, current + step));

      // Synchronously set center to avoid jitter on keypress
      if (ctx?.centerIndexRef) {
        (ctx.centerIndexRef as any).prev = next;
        ctx.centerIndexRef.current = next;
      }
      if (ctx?.navLockRef) ctx.navLockRef.current = 2;

      const groupGapsOn = !!ctx?.groupGapsActiveRef?.current;

      // When expanded AND group gaps are ON:
      //   → just recenter/expand switch without invoking single staging.
      if ((ctx?.expandedIndexRef?.current ?? null) !== null) {
        if (groupGapsOn) {
          ctx?.centerOn?.(next); // smooth scroll keeps working
          if (ctx?.lastExpandedIndexRef)
            ctx.lastExpandedIndexRef.current =
              ctx?.expandedIndexRef?.current ?? null;
          if (ctx?.expandedSwitchLockRef)
            ctx.expandedSwitchLockRef.current = 4; // snap switch a few frames
          ctx?.setExpandedIndex?.(next);
          return;
        }

        // Group gaps OFF → preserve legacy "expanded + single-stage" behavior
        if (ctx?.centerIndexRef) {
          (ctx.centerIndexRef as any).prev = next;
          ctx.centerIndexRef.current = next;
        }
        ctx?.centerOn?.(next);
        if (ctx?.lastExpandedIndexRef)
          ctx.lastExpandedIndexRef.current =
            ctx?.expandedIndexRef?.current ?? null;
        if (ctx?.expandedSwitchLockRef)
          ctx.expandedSwitchLockRef.current = 4;
        ctx?.setExpandedIndex?.(next);
        return;
      }
    };

    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [ctx, planes]);

  return null;
}

function HoldArrow({
  dir,                    // -1 = previous (←), 1 = next (→)
  tapJump = 1,            // how many extra keypresses on a quick tap
  repeatStartMs = 140,    // delay before repeating starts
  repeatMinMs = 45,       // fastest repeat interval
  accelerateMs = 800,     // time to accelerate down to repeatMinMs
}: {
  dir: -1 | 1;
  tapJump?: number;
  repeatStartMs?: number;
  repeatMinMs?: number;
  accelerateMs?: number;
}) {
  const rafRef = React.useRef<number | null>(null);
  const runningRef = React.useRef(false);
  const pressT0Ref = React.useRef(0);
  const lastFireRef = React.useRef(0);
  const pointerIdRef = React.useRef<number | null>(null);
  const btnElRef = React.useRef<HTMLButtonElement | null>(null);

  const fireOnce = React.useCallback(() => {
    const key = dir < 0 ? "ArrowLeft" : "ArrowRight";
    window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  }, [dir]);

  const stop = React.useCallback(() => {
    runningRef.current = false;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    // Release pointer capture on the SAME element that captured it
    if (pointerIdRef.current != null && btnElRef.current) {
      try { btnElRef.current.releasePointerCapture(pointerIdRef.current); } catch {}
    }
    pointerIdRef.current = null;
  }, []);

  const tick = React.useCallback((t: number) => {
    if (!runningRef.current) return;

    const elapsed = t - pressT0Ref.current;
    // Lerp current interval from start → min over accelerateMs
    const k = Math.min(1, Math.max(0, elapsed / accelerateMs));
    const curInterval = repeatStartMs + (repeatMinMs - repeatStartMs) * k;

    if (t - lastFireRef.current >= curInterval) {
      lastFireRef.current = t;
      fireOnce();
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [accelerateMs, repeatMinMs, repeatStartMs, fireOnce]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    btnElRef.current = e.currentTarget;
    // Capture so the press isn’t stolen by scroll
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pointerIdRef.current = e.pointerId;

    runningRef.current = true;
    pressT0Ref.current = performance.now();
    lastFireRef.current = pressT0Ref.current; // first repeat waits repeatStartMs

    // Immediate “press” to feel snappy
    fireOnce();

    rafRef.current = requestAnimationFrame(tick);
  };

  const onPointerUpOrCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const heldMs = performance.now() - pressT0Ref.current;
    const wasTap = heldMs < repeatStartMs * 0.85;

    stop();

    // Optional: small boost for very short taps
    if (wasTap && tapJump > 1) {
      for (let i = 1; i < tapJump; i++) fireOnce();
    }
  };

  React.useEffect(() => () => stop(), [stop]);

  return (
    <button
      type="button"
      ref={btnElRef}
      className="axon-expanded__arrowBtn"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUpOrCancel}
      onPointerCancel={onPointerUpOrCancel}
      onPointerLeave={onPointerUpOrCancel}
    >
      {dir < 0 ? "←" : "→"}
    </button>
  );
}


function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const check = () => setIsMobile(typeof window !== "undefined" && window.innerWidth <= breakpoint);
    check(); // initial
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}

function useMotionTuning() {
  const isMobile = useIsMobile(768);
  return isMobile
    ? {
      // Mobile (snappier)
      CARD_Z_LERP: 0.5,
      CARD_FAR_THOLD: 2.3,
      CARD_MAX_SPD: 88,
      TAU: 0.12
    } : {
      // Desktop (your current values)
      CARD_Z_LERP: 0.5,
      CARD_FAR_THOLD: 2.3,
      CARD_MAX_SPD: 34,
      TAU: 0.2
    };
}

// ────────────────────────────────────────────────────────────────────────────────
// Base material (cheap to clone per card)
// ────────────────────────────────────────────────────────────────────────────────
function makeBaseFrontMaterial() {
  const m = new THREE.MeshBasicMaterial({
    toneMapped: false,
    side: THREE.DoubleSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    opacity: 1,
  });
  return m;
}


// ────────────────────────────────────────────────────────────────────────────────
// elastic knob
// ────────────────────────────────────────────────────────────────────────────────

function ElasticKnob({
  onVelocity,
  onRelease,
  maxPxPerSec = 3600,           // tune max speed
  expo = 1.25,                  // response curve; higher = steeper edges
}: {
  onVelocity: (pxPerSec: number) => void;
  onRelease: () => void;
  maxPxPerSec?: number;
  expo?: number;
}) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const dotRef = React.useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = React.useState(false);

  const setFromX = (clientX: number) => {
    const el = hostRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const half = rect.width / 2;
    let n = (clientX - cx) / half;       // [-1..1], negative = up, positive = down
    n = Math.max(-1, Math.min(1, n));
    const shaped = Math.sign(n) * Math.pow(Math.abs(n), expo);
    const v = shaped * maxPxPerSec;

    if (dotRef.current) dotRef.current.style.left = `${(n * 0.5 + 0.5) * 100}%`;
    onVelocity(v);
  };

  const stop = () => {
    setDragging(false);
    if (dotRef.current) dotRef.current.style.left = "50%";
    onRelease();
  };

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => { if (dragging) setFromX(e.clientX); };
    const onMouseUp = () => dragging && stop();
    const onTouchMove = (e: TouchEvent) => {
      if (!dragging || e.touches.length !== 1) return;
      e.preventDefault();
      setFromX(e.touches[0].clientX);
    };
    const onTouchEnd = () => dragging && stop();

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("touchmove", onTouchMove as any);
      window.removeEventListener("touchend", onTouchEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  return (
    <div
      ref={hostRef}
      className="axon-knob"
      onMouseDown={(e) => { setDragging(true); setFromX(e.clientX); }}
      onTouchStart={(e) => {
        setDragging(true);
        if (e.touches.length === 1) setFromX(e.touches[0].clientX);
      }}
    >
      <div className="axon-knob__track" />
      <div ref={dotRef} className="axon-knob__dot" />
    </div>
  );
}



