import React, { useRef } from "react";
import type { SearchRequest } from "../types/api";

interface PoseControlsProps {
  filters: SearchRequest;
  onChange: (patch: Partial<SearchRequest>) => void;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function snap(val: number, step: number): number {
  return Math.round(val / step) * step;
}

function describeHead(yaw: number, pitch: number, active: boolean): string {
  if (!active) return "Any angle";
  let h = "Front";
  if (yaw <= -60) h = "Profile L";
  else if (yaw <= -15) h = "3/4 L";
  else if (yaw >= 60) h = "Profile R";
  else if (yaw >= 15) h = "3/4 R";

  let v = "Level";
  if (pitch >= 15) v = "Up";
  else if (pitch <= -15) v = "Down";
  return `${h} · ${v}`;
}

function describeTorso(yaw: number, lean: number, active: boolean): string {
  if (!active) return "Any angle";
  const ay = Math.abs(yaw);
  let dir = "Front";
  if (ay >= 150) dir = "Back";
  else if (ay >= 110) dir = yaw < 0 ? "Back 3/4 L" : "Back 3/4 R";
  else if (ay >= 65) dir = yaw < 0 ? "Side L" : "Side R";
  else if (ay >= 15) dir = yaw < 0 ? "3/4 L" : "3/4 R";

  let tilt = "Upright";
  if (lean <= -15) tilt = "Lean Fwd";
  else if (lean >= 15) tilt = "Lean Back";
  return `${dir} · ${tilt}`;
}

function describeSectorPath(
  cx: number,
  cy: number,
  r: number,
  centerYawDeg: number,
  tolDeg: number
): string {
  if (tolDeg >= 179) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const startRad = ((centerYawDeg - tolDeg) * Math.PI) / 180;
  const endRad = ((centerYawDeg + tolDeg) * Math.PI) / 180;
  const x1 = cx + Math.sin(startRad) * r;
  const y1 = cy + Math.cos(startRad) * r;
  const x2 = cx + Math.sin(endRad) * r;
  const y2 = cy + Math.cos(endRad) * r;
  const largeArc = tolDeg * 2 > 180 ? 1 : 0;
  // Counter-clockwise on screen corresponds to increasing yaw (bottom->right->top)
  return `M ${cx} ${cy} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 0 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`;
}

export function PoseControls({ filters, onChange }: PoseControlsProps) {
  const headSvgRef = useRef<SVGSVGElement | null>(null);
  const torsoFrontSvgRef = useRef<SVGSVGElement | null>(null);
  const torsoDialSvgRef = useRef<SVGSVGElement | null>(null);

  const headPresence = filters.head_presence ?? "any";
  const torsoPresence = filters.torso_presence ?? "any";
  const headActive =
    headPresence !== "exclude" &&
    (headPresence === "require" || filters.use_head_yaw || filters.use_head_pitch);
  const torsoActive =
    torsoPresence !== "exclude" &&
    (torsoPresence === "require" || filters.use_torso_yaw || filters.use_torso_lean);

  const headMode: "off" | "include" | "exclude" =
    headPresence === "exclude" ? "exclude" : headActive ? "include" : "off";
  const torsoMode: "off" | "include" | "exclude" =
    torsoPresence === "exclude" ? "exclude" : torsoActive ? "include" : "off";

  const setHeadMode = (mode: "off" | "include" | "exclude") => {
    if (mode === "off") {
      onChange({ head_presence: "any", use_head_yaw: false, use_head_pitch: false });
    } else if (mode === "exclude") {
      onChange({ head_presence: "exclude", use_head_yaw: false, use_head_pitch: false });
    } else {
      onChange({
        head_presence: "require",
        use_head_yaw: filters.use_head_yaw || filters.use_head_pitch ? filters.use_head_yaw : true,
        use_head_pitch: filters.use_head_yaw || filters.use_head_pitch ? filters.use_head_pitch : true,
      });
    }
  };

  const setTorsoMode = (mode: "off" | "include" | "exclude") => {
    if (mode === "off") {
      onChange({ torso_presence: "any", use_torso_yaw: false, use_torso_lean: false });
    } else if (mode === "exclude") {
      onChange({ torso_presence: "exclude", use_torso_yaw: false, use_torso_lean: false });
    } else {
      onChange({
        torso_presence: "require",
        use_torso_yaw:
          filters.use_torso_yaw || filters.use_torso_lean ? filters.use_torso_yaw : true,
        use_torso_lean:
          filters.use_torso_yaw || filters.use_torso_lean ? filters.use_torso_lean : false,
      });
    }
  };

  const updateHeadFromPointer = (clientX: number, clientY: number) => {
    const svg = headSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
    // X: 0..1 -> -90..+90 (L to R); Y: 0..1 -> +60..-60 (UP to DOWN)
    const yaw = snap((nx - 0.5) * 180, 5);
    const pitch = snap((0.5 - ny) * 120, 5);
    onChange({
      head_presence: "require",
      use_head_yaw: true,
      use_head_pitch: true,
      head_yaw: clamp(yaw, -90, 90),
      head_pitch: clamp(pitch, -60, 60),
    });
  };

  const updateTorsoFrontFromPointer = (clientX: number, clientY: number) => {
    const svg = torsoFrontSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
    const isBack = Math.abs(filters.torso_yaw) > 90;
    let nextYaw = snap((nx - 0.5) * 180, 5);
    if (isBack) {
      nextYaw = nextYaw >= 0 ? 180 - nextYaw : -180 - nextYaw;
    }
    const nextLean = snap((0.5 - ny) * 120, 5);
    onChange({
      torso_presence: "require",
      use_torso_yaw: true,
      use_torso_lean: true,
      torso_yaw: clamp(nextYaw, -180, 180),
      torso_lean: clamp(nextLean, -60, 60),
    });
  };

  const updateTorsoDialFromPointer = (clientX: number, clientY: number) => {
    const svg = torsoDialSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // Bottom (camera side) = 0 deg (Front); Left = -90 deg; Right = +90 deg; Top = +-180 deg (Back)
    const deg = snap((Math.atan2(dx, dy) * 180) / Math.PI, 5);
    onChange({
      torso_presence: "require",
      use_torso_yaw: true,
      torso_yaw: clamp(deg, -180, 180),
    });
  };

  const handlePointerDrag = (
    e: React.PointerEvent<SVGSVGElement>,
    updater: (x: number, y: number) => void
  ) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    updater(e.clientX, e.clientY);
  };

  const handlePointerMove = (
    e: React.PointerEvent<SVGSVGElement>,
    updater: (x: number, y: number) => void
  ) => {
    if (e.buttons !== 1) return;
    updater(e.clientX, e.clientY);
  };

  const toggleFrontBack = () => {
    const y = filters.torso_yaw;
    const flipped = y >= 0 ? 180 - y : -180 - y;
    onChange({
      torso_presence: "require",
      use_torso_yaw: true,
      torso_yaw: clamp(Math.round(flipped), -180, 180),
    });
  };

  // --- Head 3D sphere projection ---
  const hx = 90 + (filters.head_yaw / 90) * 62;
  const hy = 70 - (filters.head_pitch / 60) * 44;
  const headTolRx = Math.max(8, (filters.head_tol / 90) * 62);
  const headTolRy = Math.max(8, (filters.head_tol / 60) * 44);
  const browShiftX = Math.sin((filters.head_yaw * Math.PI) / 180) * 26;
  const browShiftY = -Math.sin((filters.head_pitch * Math.PI) / 180) * 24;

  // --- Torso 3D front mannequin + top-down dial geometry ---
  const yawRad = (filters.torso_yaw * Math.PI) / 180;
  const leanRad = (filters.torso_lean * Math.PI) / 180;
  const isBackFacing = Math.abs(filters.torso_yaw) > 90;

  // Top-down dial vectors
  const dialR = 46;
  const dialX = 70 + Math.sin(yawRad) * dialR;
  const dialY = 66 + Math.cos(yawRad) * dialR;
  const shHalf = 19;
  const shX1 = 70 - Math.cos(yawRad) * shHalf;
  const shY1 = 66 + Math.sin(yawRad) * shHalf;
  const shX2 = 70 + Math.cos(yawRad) * shHalf;
  const shY2 = 66 - Math.sin(yawRad) * shHalf;

  // Camera-view mannequin projection (cx=62, cy=66 in 124x132 box)
  const mCx = 62;
  const mCy = 68;
  const shoulderHalfWidth = Math.max(7, Math.abs(Math.cos(yawRad)) * 31);
  const chestOffset = Math.sin(yawRad) * 16;
  // Positive lean = leaning back (shoulders slightly higher/narrower), Negative = leaning forward toward camera
  const leanShiftY = -Math.sin(leanRad) * 14;
  const leanScaleTop = 1 - Math.sin(leanRad) * 0.14;
  const topShY = mCy - 26 + leanShiftY * 0.5;
  const waistY = mCy + 26;
  const topHalfW = shoulderHalfWidth * leanScaleTop;
  const waistHalfW = Math.max(6, Math.abs(Math.cos(yawRad)) * 18);
  const ribTopLeft = mCx - topHalfW;
  const ribTopRight = mCx + topHalfW;
  const waistLeft = mCx - waistHalfW;
  const waistRight = mCx + waistHalfW;
  const spineCenterTopX = mCx + chestOffset * 0.7;
  const headAnchorY = topShY - 11;

  return (
    <>
      <div className="section-card">
        <div className="section-header">
          <span>Quick Pose Presets</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange({
                head_presence: "any",
                torso_presence: "any",
                use_head_yaw: false,
                use_head_pitch: false,
                use_torso_yaw: false,
                use_torso_lean: false,
              })
            }
          >
            Clear
          </button>
        </div>

        <div className="preset-grid">
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange({
                head_presence: "require",
                torso_presence: "require",
                use_head_yaw: true,
                head_yaw: 0,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 0,
                use_torso_lean: false,
              })
            }
          >
            Front
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange({
                head_presence: "require",
                torso_presence: "require",
                use_head_yaw: true,
                head_yaw: -35,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: -35,
                use_torso_lean: false,
              })
            }
          >
            3/4 Left
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange({
                head_presence: "require",
                torso_presence: "require",
                use_head_yaw: true,
                head_yaw: 35,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 35,
                use_torso_lean: false,
              })
            }
          >
            3/4 Right
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange({
                head_presence: "require",
                torso_presence: "require",
                use_head_yaw: true,
                head_yaw: -75,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: -85,
                use_torso_lean: false,
              })
            }
          >
            Profile L
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange({
                head_presence: "require",
                torso_presence: "require",
                use_head_yaw: true,
                head_yaw: 75,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 85,
                use_torso_lean: false,
              })
            }
          >
            Profile R
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() =>
              onChange({
                head_presence: "any",
                torso_presence: "require",
                use_head_yaw: false,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 180,
                use_torso_lean: false,
              })
            }
          >
            Back
          </button>
        </div>

        <div className="control-row">
          <span>Subject matching</span>
          <select
            className="select"
            style={{ width: "auto", padding: "4px 8px", fontSize: 12 }}
            value={filters.match_mode}
            onChange={(e) =>
              onChange({ match_mode: e.target.value as "paired" | "independent" })
            }
          >
            <option value="paired">Same Person (Paired)</option>
            <option value="independent">Any Head / Torso</option>
          </select>
        </div>
      </div>

      {/* Head Orientation Gimbal */}
      <div className="section-card">
        <div className="section-header">
          <span>Head Angle</span>
          <div className="segmented-group" title="Control whether Head is included, ignored, or excluded from search">
            <button
              type="button"
              className={`segmented-btn ${headMode === "off" ? "active" : ""}`}
              onClick={() => setHeadMode("off")}
            >
              Off
            </button>
            <button
              type="button"
              className={`segmented-btn ${headMode === "include" ? "active" : ""}`}
              onClick={() => setHeadMode("include")}
            >
              Include
            </button>
            <button
              type="button"
              className={`segmented-btn ${headMode === "exclude" ? "active-danger" : ""}`}
              onClick={() => setHeadMode("exclude")}
              title="Only show images without a detected head/face"
            >
              Exclude
            </button>
          </div>
        </div>

        <div style={{ fontSize: 11, color: headMode === "exclude" ? "var(--danger)" : headActive ? "var(--accent-hover)" : "var(--text-muted)" }}>
          {headMode === "exclude"
            ? "Excluding images with a detected head/face"
            : describeHead(filters.head_yaw, filters.head_pitch, headActive)}
        </div>

        <div className={headMode !== "include" ? "pose-body-dimmed" : ""} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="pose-pad-wrap">
          <svg
            ref={headSvgRef}
            viewBox="0 0 180 140"
            className="pose-svg"
            onPointerDown={(e) => handlePointerDrag(e, updateHeadFromPointer)}
            onPointerMove={(e) => handlePointerMove(e, updateHeadFromPointer)}
          >
            <rect
              x="4"
              y="4"
              width="172"
              height="132"
              rx="10"
              fill="#111216"
              stroke={headActive ? "#3a5699" : "#2c303a"}
            />
            <line x1="90" y1="14" x2="90" y2="126" stroke="#222631" strokeDasharray="3 3" />
            <line x1="14" y1="70" x2="166" y2="70" stroke="#222631" strokeDasharray="3 3" />

            {/* Tolerance halo around target */}
            {headActive && (
              <ellipse
                cx={hx}
                cy={hy}
                rx={headTolRx}
                ry={headTolRy}
                fill="rgba(91, 140, 255, 0.12)"
                stroke="rgba(91, 140, 255, 0.38)"
                strokeDasharray="3 2"
              />
            )}

            {/* Loomis cranial sphere */}
            <ellipse
              cx="90"
              cy="70"
              rx="32"
              ry="38"
              fill="rgba(255,255,255,0.02)"
              stroke={headActive ? "#5b8cff" : "#3a4050"}
              strokeWidth="1.5"
            />
            {/* Brow / eye horizontal arc & centerline */}
            <path
              d={`M ${90 - 28} ${70 + browShiftY * 0.4} Q ${90 + browShiftX * 0.5} ${70 + browShiftY} ${90 + 28} ${70 + browShiftY * 0.4}`}
              fill="none"
              stroke={headActive ? "#749eff" : "#565e70"}
              strokeWidth="1.4"
            />
            <path
              d={`M 90 32 Q ${90 + browShiftX} ${70 + browShiftY * 0.4} 90 108`}
              fill="none"
              stroke={headActive ? "#749eff" : "#565e70"}
              strokeWidth="1.4"
            />

            <line
              x1={90 + browShiftX * 0.35}
              y1={70 + browShiftY * 0.35}
              x2={hx}
              y2={hy}
              stroke={headActive ? "#5b8cff" : "#6c7484"}
              strokeWidth="2"
            />
            <circle
              cx={hx}
              cy={hy}
              r="6.5"
              fill={headActive ? "#5b8cff" : "#6c7484"}
              stroke="#ffffff"
              strokeWidth="1.5"
            />

            <text x="90" y="16" textAnchor="middle" fill="#6c7484" fontSize="9">
              UP (+60°)
            </text>
            <text x="90" y="131" textAnchor="middle" fill="#6c7484" fontSize="9">
              DOWN (-60°)
            </text>
            <text x="12" y="73" fill="#6c7484" fontSize="9">
              L
            </text>
            <text x="161" y="73" fill="#6c7484" fontSize="9">
              R
            </text>
          </svg>
          <div className="pose-hint">
            Drag where the face points in frame (Left/Right = Yaw, Up/Down = Pitch)
          </div>
        </div>

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_head_yaw}
              onChange={(e) =>
                onChange({
                  use_head_yaw: e.target.checked,
                  head_presence: e.target.checked || filters.use_head_pitch ? "require" : "any",
                })
              }
            />
            Turn (Yaw)
          </label>
          <span>{filters.head_yaw}°</span>
        </div>
        <input
          type="range"
          min={-90}
          max={90}
          step={5}
          value={filters.head_yaw}
          onChange={(e) =>
            onChange({
              head_presence: "require",
              use_head_yaw: true,
              head_yaw: Number(e.target.value),
            })
          }
        />

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_head_pitch}
              onChange={(e) =>
                onChange({
                  use_head_pitch: e.target.checked,
                  head_presence: filters.use_head_yaw || e.target.checked ? "require" : "any",
                })
              }
            />
            Tilt (Pitch)
          </label>
          <span>{filters.head_pitch}°</span>
        </div>
        <input
          type="range"
          min={-60}
          max={60}
          step={5}
          value={filters.head_pitch}
          onChange={(e) =>
            onChange({
              head_presence: "require",
              use_head_pitch: true,
              head_pitch: Number(e.target.value),
            })
          }
        />

        <div className="slider-block">
          <div className="slider-head">
            <span>Head Tolerance</span>
            <span>±{filters.head_tol}°</span>
          </div>
          <input
            type="range"
            min={5}
            max={45}
            step={5}
            value={filters.head_tol}
            onChange={(e) => onChange({ head_tol: Number(e.target.value) })}
          />
        </div>
        </div>
      </div>

      {/* Torso Orientation: Synchronized 3D Front Mannequin + 360° Overhead Dial */}
      <div className="section-card">
        <div className="section-header">
          <span>Torso Angle</span>
          <div className="segmented-group" title="Control whether Torso is included, ignored, or excluded from search">
            <button
              type="button"
              className={`segmented-btn ${torsoMode === "off" ? "active" : ""}`}
              onClick={() => setTorsoMode("off")}
            >
              Off
            </button>
            <button
              type="button"
              className={`segmented-btn ${torsoMode === "include" ? "active" : ""}`}
              onClick={() => setTorsoMode("include")}
            >
              Include
            </button>
            <button
              type="button"
              className={`segmented-btn ${torsoMode === "exclude" ? "active-danger" : ""}`}
              onClick={() => setTorsoMode("exclude")}
              title="Only show images without a detected torso"
            >
              Exclude
            </button>
          </div>
        </div>

        <div style={{ fontSize: 11, color: torsoMode === "exclude" ? "var(--danger)" : torsoActive ? "var(--accent-hover)" : "var(--text-muted)" }}>
          {torsoMode === "exclude"
            ? "Excluding images with a detected torso"
            : describeTorso(filters.torso_yaw, filters.torso_lean, torsoActive)}
        </div>

        <div className={torsoMode !== "include" ? "pose-body-dimmed" : ""} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="torso-dual-wrap">
          {/* Left: Camera-view 3D Mannequin (Turn + Lean) */}
          <div className="torso-pane">
            <svg
              ref={torsoFrontSvgRef}
              viewBox="0 0 124 134"
              className="pose-svg"
              onPointerDown={(e) => handlePointerDrag(e, updateTorsoFrontFromPointer)}
              onPointerMove={(e) => handlePointerMove(e, updateTorsoFrontFromPointer)}
            >
              <rect
                x="2"
                y="2"
                width="120"
                height="130"
                rx="8"
                fill="#111216"
                stroke={torsoActive ? "#3a5699" : "#2c303a"}
              />
              <text x="62" y="15" textAnchor="middle" fill="#6c7484" fontSize="8.5">
                CAMERA VIEW
              </text>

              {/* Head stub indicator above neck */}
              <circle
                cx={mCx + chestOffset * 0.25}
                cy={headAnchorY}
                r="8"
                fill="none"
                stroke="#3a4050"
                strokeWidth="1.2"
              />

              {/* Ribcage / Torso polygon */}
              <polygon
                points={`${ribTopLeft.toFixed(1)},${topShY.toFixed(1)} ${ribTopRight.toFixed(1)},${topShY.toFixed(1)} ${waistRight.toFixed(1)},${waistY.toFixed(1)} ${waistLeft.toFixed(1)},${waistY.toFixed(1)}`}
                fill={
                  isBackFacing
                    ? "rgba(154, 163, 178, 0.12)"
                    : torsoActive
                    ? "rgba(91, 140, 255, 0.16)"
                    : "rgba(255, 255, 255, 0.04)"
                }
                stroke={
                  isBackFacing
                    ? "#9aa3b2"
                    : torsoActive
                    ? "#5b8cff"
                    : "#5a6375"
                }
                strokeWidth="1.8"
                strokeLinejoin="round"
              />

              {/* Shoulder line */}
              <line
                x1={ribTopLeft}
                y1={topShY}
                x2={ribTopRight}
                y2={topShY}
                stroke={isBackFacing ? "#9aa3b2" : "#749eff"}
                strokeWidth="2.5"
                strokeLinecap="round"
              />

              {/* Front = Chest V-collar + Sternum; Back = Dashed Spine */}
              {isBackFacing ? (
                <line
                  x1={spineCenterTopX}
                  y1={topShY + 3}
                  x2={mCx}
                  y2={waistY - 3}
                  stroke="#9aa3b2"
                  strokeWidth="1.8"
                  strokeDasharray="3 3"
                />
              ) : (
                <>
                  <polyline
                    points={`${(mCx - shoulderHalfWidth * 0.35).toFixed(1)},${topShY.toFixed(1)} ${spineCenterTopX.toFixed(1)},${(topShY + 12).toFixed(1)} ${(mCx + shoulderHalfWidth * 0.35).toFixed(1)},${topShY.toFixed(1)}`}
                    fill="none"
                    stroke={torsoActive ? "#93b4ff" : "#7b8496"}
                    strokeWidth="1.6"
                  />
                  <line
                    x1={spineCenterTopX}
                    y1={topShY + 12}
                    x2={mCx}
                    y2={waistY - 3}
                    stroke={torsoActive ? "#93b4ff" : "#7b8496"}
                    strokeWidth="1.5"
                  />
                </>
              )}

              <text
                x="62"
                y="123"
                textAnchor="middle"
                fill={isBackFacing ? "#fbbf24" : "#749eff"}
                fontSize="9"
                fontWeight="600"
              >
                {isBackFacing ? "BACK SIDE" : "CHEST SIDE"}
              </text>
            </svg>
            <button
              type="button"
              className="btn btn-sm"
              style={{ width: "100%", fontSize: 11, padding: "3px 6px" }}
              onClick={toggleFrontBack}
            >
              Flip Front / Back
            </button>
          </div>

          {/* Right: Top-Down 360° Turntable Compass */}
          <div className="torso-pane">
            <svg
              ref={torsoDialSvgRef}
              viewBox="0 0 140 134"
              className="pose-svg"
              onPointerDown={(e) => handlePointerDrag(e, updateTorsoDialFromPointer)}
              onPointerMove={(e) => handlePointerMove(e, updateTorsoDialFromPointer)}
            >
              <rect
                x="2"
                y="2"
                width="136"
                height="130"
                rx="8"
                fill="#111216"
                stroke={torsoActive ? "#3a5699" : "#2c303a"}
              />
              <text x="70" y="14" textAnchor="middle" fill="#6c7484" fontSize="8">
                TOP-DOWN 360° (BACK)
              </text>

              <circle cx="70" cy="66" r={dialR} fill="none" stroke="#282c36" strokeDasharray="3 3" />

              {/* Tolerance sector wedge */}
              {torsoActive && (
                <path
                  d={describeSectorPath(70, 66, dialR, filters.torso_yaw, filters.torso_tol)}
                  fill="rgba(91, 140, 255, 0.14)"
                  stroke="rgba(91, 140, 255, 0.3)"
                />
              )}

              <text x="12" y="69" fill="#6c7484" fontSize="8.5">
                L
              </text>
              <text x="121" y="69" fill="#6c7484" fontSize="8.5">
                R
              </text>
              <text x="70" y="126" textAnchor="middle" fill="#749eff" fontSize="8">
                FRONT (TOWARD CAM)
              </text>

              {/* Top-down shoulders bar */}
              <line
                x1={shX1}
                y1={shY1}
                x2={shX2}
                y2={shY2}
                stroke="#9aa3b2"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              {/* Chest facing arrow */}
              <line
                x1="70"
                y1="66"
                x2={dialX}
                y2={dialY}
                stroke={torsoActive ? "#5b8cff" : "#6c7484"}
                strokeWidth="2.2"
              />
              <circle
                cx={dialX}
                cy={dialY}
                r="5.5"
                fill={torsoActive ? "#5b8cff" : "#6c7484"}
                stroke="#ffffff"
                strokeWidth="1.4"
              />
            </svg>
            <div style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center" }}>
              Drag ring around 360°
            </div>
          </div>
        </div>

        <div className="pose-hint">
          Drag <strong>Camera View</strong> left/right to turn & up/down to lean, or spin{" "}
          <strong>Top-Down 360°</strong> for chest/back direction.
        </div>

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_torso_yaw}
              onChange={(e) =>
                onChange({
                  use_torso_yaw: e.target.checked,
                  torso_presence:
                    e.target.checked || filters.use_torso_lean ? "require" : "any",
                })
              }
            />
            Turn (0° Front · ±180° Back)
          </label>
          <span>{filters.torso_yaw}°</span>
        </div>
        <input
          type="range"
          min={-180}
          max={180}
          step={5}
          value={filters.torso_yaw}
          onChange={(e) =>
            onChange({
              torso_presence: "require",
              use_torso_yaw: true,
              torso_yaw: Number(e.target.value),
            })
          }
        />

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_torso_lean}
              onChange={(e) =>
                onChange({
                  use_torso_lean: e.target.checked,
                  torso_presence:
                    filters.use_torso_yaw || e.target.checked ? "require" : "any",
                })
              }
            />
            Lean (− Fwd / + Back)
          </label>
          <span>{filters.torso_lean}°</span>
        </div>
        <input
          type="range"
          min={-60}
          max={60}
          step={5}
          value={filters.torso_lean}
          onChange={(e) =>
            onChange({
              torso_presence: "require",
              use_torso_lean: true,
              torso_lean: Number(e.target.value),
            })
          }
        />

        <div className="slider-block">
          <div className="slider-head">
            <span>Torso Tolerance</span>
            <span>±{filters.torso_tol}°</span>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            step={5}
            value={filters.torso_tol}
            onChange={(e) => onChange({ torso_tol: Number(e.target.value) })}
          />
        </div>
        </div>
      </div>
    </>
  );
}
