'use client';
import { useEffect, useRef, useState } from 'react';
import { playerName } from '@/lib/engine';
import { Shuttle } from './Icons';

// Service court naming from the player's perspective (see lib/engine.js mapping).
const SLOT_TAG = {
  left_top: 'Kotak Kiri · Ganjil',
  left_bottom: 'Kotak Kanan · Genap',
  right_top: 'Kotak Kanan · Genap',
  right_bottom: 'Kotak Kiri · Ganjil',
};

// Center coordinates (in 0..200 x 0..100 BWF proportional SVG viewBox) for each service box
const SLOT_COORDS = {
  left_top: { x: 46, y: 29 },
  left_bottom: { x: 46, y: 71 },
  right_top: { x: 154, y: 29 },
  right_bottom: { x: 154, y: 71 },
};

function findSlot(positions, pid) {
  if (!positions || !pid) return null;
  for (const [slot, id] of Object.entries(positions)) {
    if (id === pid) return slot;
  }
  return null;
}

/**
 * Authentic BWF Badminton Court markings (viewBox 0..200 x 0..100):
 * - Outer boundaries (doubles sidelines & back boundary lines)
 * - Singles sidelines (inset top & bottom)
 * - Long service lines for doubles (inset near left & right baselines)
 * - Short service lines (left & right of the center net)
 * - Center lines dividing even/odd service courts between short service line and baseline
 */
function BadmintonMarkings() {
  return (
    <svg className="court-markings" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
      {/* Outer court boundary (Doubles Sidelines + Back Baselines) */}
      <rect x="2" y="2" width="196" height="96" fill="none" stroke="rgba(255,255,255,0.88)" strokeWidth="1.2" />

      {/* Singles Sidelines (horizontal top & bottom inner lines) */}
      <line x1="2" y1="9.5" x2="198" y2="9.5" stroke="rgba(255,255,255,0.78)" strokeWidth="0.85" />
      <line x1="2" y1="90.5" x2="198" y2="90.5" stroke="rgba(255,255,255,0.78)" strokeWidth="0.85" />

      {/* Doubles Long Service Lines (vertical back inner lines) */}
      <line x1="13.5" y1="2" x2="13.5" y2="98" stroke="rgba(255,255,255,0.78)" strokeWidth="0.85" />
      <line x1="186.5" y1="2" x2="186.5" y2="98" stroke="rgba(255,255,255,0.78)" strokeWidth="0.85" />

      {/* Short Service Lines (left and right of net) */}
      <line x1="70.5" y1="2" x2="70.5" y2="98" stroke="rgba(255,255,255,0.88)" strokeWidth="1.05" />
      <line x1="129.5" y1="2" x2="129.5" y2="98" stroke="rgba(255,255,255,0.88)" strokeWidth="1.05" />

      {/* Center Service Lines (from baseline to short service line on each side) */}
      <line x1="2" y1="50" x2="70.5" y2="50" stroke="rgba(255,255,255,0.88)" strokeWidth="1.05" />
      <line x1="129.5" y1="50" x2="198" y2="50" stroke="rgba(255,255,255,0.88)" strokeWidth="1.05" />
    </svg>
  );
}

/**
 * Visual court map: authentic BWF court markings + 4 interactive quadrants +
 * realistic parabolic shuttlecock flight animation when struck from server to receiver.
 */
export default function CourtMap({ match, positions, serverId, receiverId, serveTurn = 1, spinKey, renderActions, overlay, showTags = true }) {
  const [spin, setSpin] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    setSpin(true);
    const t = setTimeout(() => setSpin(false), 850);
    return () => clearTimeout(t);
  }, [spinKey]);

  const isSecond = match?.rules?.scoring_method === 'side_out' && serveTurn === 2;
  const serveCls = isSecond ? 'serve-2' : 'serve-1';
  const strokeColor = isSecond ? '#fb923c' : '#facc15';

  const srvSlot = findSlot(positions, serverId);
  const rcvSlot = findSlot(positions, receiverId);
  const from = srvSlot ? SLOT_COORDS[srvSlot] : null;
  const to = rcvSlot ? SLOT_COORDS[rcvSlot] : null;

  // Build a parabolic arc (quadratic Bezier) representing the shuttlecock rising over the net and dropping into the receiver's box
  let flight = null;
  if (from && to && srvSlot !== rcvSlot) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const x1 = from.x + ux * 10;
    const y1 = from.y + uy * 5;
    const x2 = to.x - ux * 12;
    const y2 = to.y - uy * 6;
    // Control point lifted upward (negative Y) to simulate 3D loft over the net
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2 - 14;
    const pathD = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;
    // Shadow path on the court floor (straight line)
    const shadowD = `M ${x1} ${y1 + 2} L ${x2} ${y2 + 2}`;
    flight = { x1, y1, x2, y2, cx, cy, pathD, shadowD, key: `${srvSlot}-${rcvSlot}-${serveTurn}` };
  }

  const box = (slot) => {
    const pid = positions?.[slot] || null;
    const serving = pid && pid === serverId;
    const receiving = pid && pid === receiverId;
    return (
      <div key={slot} className={`cbox ${serving ? `serving ${serveCls}` : ''} ${receiving ? 'receiving' : ''} ${pid ? '' : 'empty'}`}>
        {serving && (
          <span className={`serve-pill ${serveCls}`}>
            <Shuttle size={14} /> {isSecond ? <Shuttle size={14} /> : null}
            {match?.rules?.scoring_method === 'side_out' ? (isSecond ? '2ND SERVE' : '1ST SERVE') : 'SERVIS'}
          </span>
        )}
        {receiving && !serving && <span className="rcv-pill">PENERIMA</span>}
        <div className={`pname ${serving ? serveCls : 'neutral'}`}>{pid ? playerName(match, pid) : '—'}</div>
        {showTags && <div className="tag">{SLOT_TAG[slot]}</div>}
        {renderActions && pid ? <div className="icons">{renderActions(pid, slot)}</div> : null}
      </div>
    );
  };

  return (
    <div className={`court ${spin ? 'spin' : ''}`}>
      <BadmintonMarkings />
      <div className="court-half left">
        {box('left_top')}
        {box('left_bottom')}
      </div>
      <div className="court-half right">
        {box('right_top')}
        {box('right_bottom')}
      </div>
      <div className="net" />
      {flight && !overlay && (
        <svg key={flight.key} className="serve-vector" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`arcGrad-${serveCls}`} gradientUnits="userSpaceOnUse" x1={flight.x1} y1={flight.y1} x2={flight.x2} y2={flight.y2}>
              <stop offset="0%" stopColor={strokeColor} stopOpacity="0.15" />
              <stop offset="45%" stopColor={strokeColor} stopOpacity="0.95" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.95" />
            </linearGradient>
            <marker id={`arrow-${serveCls}`} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="#22d3ee" />
            </marker>
          </defs>

          {/* Ground shadow line under the airborne shuttlecock */}
          <path d={flight.shadowD} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth="1.2" strokeDasharray="2.5 2.5" strokeLinecap="round" />

          {/* Parabolic arc trajectory */}
          <path
            className="serve-arc-line"
            d={flight.pathD}
            fill="none"
            stroke={`url(#arcGrad-${serveCls})`}
            strokeWidth="1.25"
            strokeDasharray="3.5 2.2"
            strokeLinecap="round"
            markerEnd={`url(#arrow-${serveCls})`}
          />

          {/* Racket impact burst at server */}
          <circle className="hit-ripple" cx={flight.x1} cy={flight.y1} r="2.2" fill="none" stroke={strokeColor} strokeWidth="0.9" />
          <circle cx={flight.x1} cy={flight.y1} r="1.5" fill={strokeColor} />

          {/* Landing target pulse at receiver */}
          <circle className="land-ripple" cx={flight.x2} cy={flight.y2} r="2.6" fill="none" stroke="#22d3ee" strokeWidth="0.8" />

          {/* Airborne shuttlecock following the exact curved path with realistic fast-initial-strike deceleration */}
          <g className={`flying-shuttle ${serveCls}`}>
            <animateMotion
              path={flight.pathD}
              dur="1.55s"
              repeatCount="indefinite"
              rotate="auto"
              calcMode="spline"
              keyTimes="0;0.78;1"
              keySplines="0.12 0.82 0.28 1; 0.4 0 1 1"
              keyPoints="0;1;1"
            />
            <animate attributeName="opacity" values="0;1;1;0;0" keyTimes="0;0.06;0.72;0.82;1" dur="1.55s" repeatCount="indefinite" />
            {/* Scale up at the apex over the net, scale down on landing; rotate(-90) makes the cork point forward along the trajectory */}
            <g transform="rotate(-90) scale(0.18)">
              <animateTransform
                attributeName="transform"
                type="scale"
                additive="sum"
                values="0.85;1.32;0.9;0.9"
                keyTimes="0;0.38;0.78;1"
                dur="1.55s"
                repeatCount="indefinite"
              />
              <g transform="translate(-32,-32)">
                <path d="M14 6 L50 6 L40 38 L24 38 Z" fill="#ffffff" stroke="#eab308" strokeWidth="2.5" strokeLinejoin="round" />
                <path d="M24 6 L28 38 M32 6 L32 38 M40 6 L36 38" stroke="#ca8a04" strokeWidth="1.8" />
                <rect x="23" y="37" width="18" height="6" rx="2" fill={strokeColor} stroke="#a16207" strokeWidth="1.5" />
                <path d="M23 43 Q32 62 41 43 Z" fill={strokeColor} stroke="#a16207" strokeWidth="2" />
              </g>
            </g>
          </g>
        </svg>
      )}
      {overlay}
    </div>
  );
}
