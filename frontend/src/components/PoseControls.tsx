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

export function PoseControls({ filters, onChange }: PoseControlsProps) {
  const headSvgRef = useRef<SVGSVGElement | null>(null);
  const torsoSvgRef = useRef<SVGSVGElement | null>(null);

  const updateHeadFromPointer = (clientX: number, clientY: number) => {
    const svg = headSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const nx = clamp((clientX - rect.left) / rect.width, 0, 1);
    const ny = clamp((clientY - rect.top) / rect.height, 0, 1);
    // X: 0..1 -> -90..+90; Y: 0..1 -> +60..-60 (up is top)
    const yaw = snap((nx - 0.5) * 180, 5);
    const pitch = snap((0.5 - ny) * 120, 5);
    onChange({
      use_head_yaw: true,
      use_head_pitch: true,
      head_yaw: clamp(yaw, -90, 90),
      head_pitch: clamp(pitch, -60, 60),
    });
  };

  const updateTorsoFromPointer = (clientX: number, clientY: number) => {
    const svg = torsoSvgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // Bottom of compass (dy > 0, dx = 0) = 0 deg (facing viewer)
    // Left (dx < 0) = negative yaw; Right (dx > 0) = positive yaw; Top = +-180 deg (back)
    const deg = snap((Math.atan2(dx, dy) * 180) / Math.PI, 5);
    onChange({
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

  // Head indicator coordinates in 180x140 SVG viewBox
  const hx = 90 + (filters.head_yaw / 90) * 68;
  const hy = 70 - (filters.head_pitch / 60) * 48;

  // Torso compass vector (angle 0 = bottom (0, +R), +90 = right (+R, 0), +-180 = top)
  const rad = (filters.torso_yaw * Math.PI) / 180;
  const compassR = 54;
  const tx = 90 + Math.sin(rad) * compassR;
  const ty = 90 + Math.cos(rad) * compassR;
  // Shoulder bar perpendicular to facing direction
  const shHalf = 22;
  const shX1 = 90 - Math.cos(rad) * shHalf;
  const shY1 = 90 + Math.sin(rad) * shHalf;
  const shX2 = 90 + Math.cos(rad) * shHalf;
  const shY2 = 90 - Math.sin(rad) * shHalf;

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
                use_head_yaw: true,
                head_yaw: 0,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 0,
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
                use_head_yaw: true,
                head_yaw: -35,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: -35,
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
                use_head_yaw: true,
                head_yaw: 35,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 35,
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
                use_head_yaw: true,
                head_yaw: -75,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: -85,
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
                use_head_yaw: true,
                head_yaw: 75,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 85,
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
                use_head_yaw: false,
                use_head_pitch: false,
                use_torso_yaw: true,
                torso_yaw: 180,
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
            <option value="paired">Paired Person</option>
            <option value="independent">Any Head/Torso</option>
          </select>
        </div>
      </div>

      {/* Head Orientation Gimbal */}
      <div className="section-card">
        <div className="section-header">
          <span>Head Angle</span>
          <span style={{ color: "var(--text-primary)" }}>
            Y:{filters.head_yaw}° / P:{filters.head_pitch}°
          </span>
        </div>

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
              stroke="#2c303a"
            />
            <line x1="90" y1="12" x2="90" y2="128" stroke="#262a34" strokeDasharray="3 3" />
            <line x1="14" y1="70" x2="166" y2="70" stroke="#262a34" strokeDasharray="3 3" />
            <ellipse cx="90" cy="70" rx="34" ry="42" fill="none" stroke="#313644" strokeWidth="1.5" />

            {/* Projected head gaze cross */}
            <ellipse
              cx={90 + (filters.head_yaw / 90) * 14}
              cy={70 - (filters.head_pitch / 60) * 10}
              rx={Math.max(12, 26 - Math.abs(filters.head_yaw) * 0.14)}
              ry={32}
              fill="rgba(91, 140, 255, 0.1)"
              stroke={filters.use_head_yaw || filters.use_head_pitch ? "#5b8cff" : "#4b5263"}
              strokeWidth="1.5"
            />
            <line
              x1="90"
              y1="70"
              x2={hx}
              y2={hy}
              stroke={filters.use_head_yaw || filters.use_head_pitch ? "#5b8cff" : "#6c7484"}
              strokeWidth="2"
            />
            <circle
              cx={hx}
              cy={hy}
              r="7"
              fill={filters.use_head_yaw || filters.use_head_pitch ? "#5b8cff" : "#6c7484"}
              stroke="#ffffff"
              strokeWidth="1.5"
            />
            <text x="90" y="18" textAnchor="middle" fill="#6c7484" fontSize="9">
              UP (+60°)
            </text>
            <text x="90" y="131" textAnchor="middle" fill="#6c7484" fontSize="9">
              DOWN (-60°)
            </text>
            <text x="14" y="73" fill="#6c7484" fontSize="9">
              L
            </text>
            <text x="160" y="73" fill="#6c7484" fontSize="9">
              R
            </text>
          </svg>
        </div>

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_head_yaw}
              onChange={(e) => onChange({ use_head_yaw: e.target.checked })}
            />
            Filter Yaw
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
            onChange({ use_head_yaw: true, head_yaw: Number(e.target.value) })
          }
        />

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_head_pitch}
              onChange={(e) => onChange({ use_head_pitch: e.target.checked })}
            />
            Filter Pitch
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
            onChange({ use_head_pitch: true, head_pitch: Number(e.target.value) })
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

      {/* Torso Orientation Compass */}
      <div className="section-card">
        <div className="section-header">
          <span>Torso Angle (360°)</span>
          <span style={{ color: "var(--text-primary)" }}>
            Y:{filters.torso_yaw}° / L:{filters.torso_lean}°
          </span>
        </div>

        <div className="pose-pad-wrap">
          <svg
            ref={torsoSvgRef}
            viewBox="0 0 180 180"
            className="pose-svg"
            style={{ maxWidth: 185 }}
            onPointerDown={(e) => handlePointerDrag(e, updateTorsoFromPointer)}
            onPointerMove={(e) => handlePointerMove(e, updateTorsoFromPointer)}
          >
            <circle cx="90" cy="90" r="78" fill="#111216" stroke="#2c303a" />
            <circle cx="90" cy="90" r={compassR} fill="none" stroke="#282c36" strokeDasharray="3 3" />
            <text x="90" y="23" textAnchor="middle" fill="#6c7484" fontSize="9">
              BACK (±180°)
            </text>
            <text x="90" y="164" textAnchor="middle" fill="#6c7484" fontSize="9">
              FRONT (0°)
            </text>
            <text x="16" y="93" fill="#6c7484" fontSize="9">
              -90°
            </text>
            <text x="144" y="93" fill="#6c7484" fontSize="9">
              +90°
            </text>

            {/* Shoulder bar */}
            <line
              x1={shX1}
              y1={shY1}
              x2={shX2}
              y2={shY2}
              stroke="#9aa3b2"
              strokeWidth="5"
              strokeLinecap="round"
            />
            {/* Facing arrow */}
            <line
              x1="90"
              y1="90"
              x2={tx}
              y2={ty}
              stroke={filters.use_torso_yaw ? "#5b8cff" : "#6c7484"}
              strokeWidth="2.5"
            />
            <circle
              cx={tx}
              cy={ty}
              r="7"
              fill={filters.use_torso_yaw ? "#5b8cff" : "#6c7484"}
              stroke="#ffffff"
              strokeWidth="1.5"
            />
          </svg>
        </div>

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_torso_yaw}
              onChange={(e) => onChange({ use_torso_yaw: e.target.checked })}
            />
            Filter Torso Yaw
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
            onChange({ use_torso_yaw: true, torso_yaw: Number(e.target.value) })
          }
        />

        <div className="control-row">
          <label>
            <input
              type="checkbox"
              checked={filters.use_torso_lean}
              onChange={(e) => onChange({ use_torso_lean: e.target.checked })}
            />
            Filter Torso Lean
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
            onChange({ use_torso_lean: true, torso_lean: Number(e.target.value) })
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
    </>
  );
}
