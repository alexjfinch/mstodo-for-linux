import { useMemo } from "react";
import { ListName } from "../types";

interface ListBannerProps {
  activeList: ListName | string;
  displayName: string;
}

const BANNER_CONFIG: Record<string, {
  decoration: React.ReactNode;
}> = {
  "My Day": {
    decoration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="banner-decoration">
        {/* Sun core */}
        <circle cx="150" cy="60" r="32" fill="rgba(255,255,255,0.18)" />
        <circle cx="150" cy="60" r="22" fill="rgba(255,255,255,0.28)" />
        {/* Sun rays */}
        {[0,45,90,135,180,225,270,315].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const x1 = 150 + 28 * Math.cos(rad);
          const y1 = 60 + 28 * Math.sin(rad);
          const x2 = 150 + 42 * Math.cos(rad);
          const y2 = 60 + 42 * Math.sin(rad);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeLinecap="round" />;
        })}
        {/* Soft cloud shapes */}
        <ellipse cx="60" cy="120" rx="55" ry="22" fill="rgba(255,255,255,0.1)" />
        <ellipse cx="80" cy="110" rx="40" ry="18" fill="rgba(255,255,255,0.08)" />
        <ellipse cx="170" cy="130" rx="35" ry="15" fill="rgba(255,255,255,0.07)" />
      </svg>
    ),
  },
  "Planned": {
    decoration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="banner-decoration">
        {/* Calendar outline */}
        <rect x="110" y="25" width="72" height="80" rx="8" stroke="rgba(255,255,255,0.25)" strokeWidth="2.5" fill="rgba(255,255,255,0.08)" />
        {/* Calendar header */}
        <rect x="110" y="25" width="72" height="22" rx="8" fill="rgba(255,255,255,0.18)" />
        <rect x="110" y="39" width="72" height="8" fill="rgba(255,255,255,0.18)" />
        {/* Calendar binder rings */}
        <circle cx="131" cy="25" r="5" fill="rgba(255,255,255,0.3)" />
        <circle cx="161" cy="25" r="5" fill="rgba(255,255,255,0.3)" />
        {/* Grid dots */}
        {[0,1,2,3,4].map(col =>
          [0,1,2,3].map(row => (
            <circle
              key={`${col}-${row}`}
              cx={122 + col * 14}
              cy={60 + row * 14}
              r="3"
              fill="rgba(255,255,255,0.22)"
            />
          ))
        )}
        {/* Highlighted day */}
        <circle cx="136" cy="74" r="7" fill="rgba(255,255,255,0.35)" />
        {/* Decorative lines */}
        <line x1="30" y1="140" x2="100" y2="140" stroke="rgba(255,255,255,0.1)" strokeWidth="2" strokeLinecap="round" />
        <line x1="20" y1="128" x2="70" y2="128" stroke="rgba(255,255,255,0.07)" strokeWidth="2" strokeLinecap="round" />
      </svg>
    ),
  },
  "Important": {
    decoration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="banner-decoration">
        {/* Large star */}
        <path
          d="M150 20 L158 50 L190 50 L165 68 L174 98 L150 80 L126 98 L135 68 L110 50 L142 50 Z"
          fill="rgba(255,255,255,0.22)"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.5"
        />
        {/* Small accent stars */}
        <path d="M55 50 L58 60 L68 60 L60 66 L63 76 L55 70 L47 76 L50 66 L42 60 L52 60 Z"
          fill="rgba(255,255,255,0.15)" />
        <path d="M80 110 L82 117 L89 117 L83 121 L86 128 L80 124 L74 128 L77 121 L71 117 L78 117 Z"
          fill="rgba(255,255,255,0.12)" />
        {/* Glow ring */}
        <circle cx="150" cy="58" r="42" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
      </svg>
    ),
  },
  "Assigned to Me": {
    decoration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="banner-decoration">
        {/* Person silhouette */}
        <circle cx="150" cy="48" r="24" fill="rgba(255,255,255,0.2)" />
        <path d="M108 130 C108 105 126 90 150 90 C174 90 192 105 192 130" fill="rgba(255,255,255,0.15)" />
        {/* Checkmark badge */}
        <circle cx="170" cy="68" r="14" fill="rgba(255,255,255,0.3)" />
        <path d="M163 68 L168 73 L177 62" stroke="rgba(255,255,255,0.9)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {/* Decorative rings */}
        <circle cx="40" cy="100" r="25" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
        <circle cx="40" cy="100" r="15" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
      </svg>
    ),
  },
  "Flagged Emails": {
    decoration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="banner-decoration">
        {/* Envelope body */}
        <rect x="95" y="38" width="90" height="68" rx="7" fill="rgba(255,255,255,0.12)" stroke="rgba(255,255,255,0.28)" strokeWidth="2" />
        {/* Envelope flap (V shape) */}
        <path d="M95 45 L140 80 L185 45" stroke="rgba(255,255,255,0.32)" strokeWidth="2" fill="none" strokeLinejoin="round" />
        {/* Bottom fold lines */}
        <line x1="95" y1="106" x2="125" y2="80" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="185" y1="106" x2="155" y2="80" stroke="rgba(255,255,255,0.2)" strokeWidth="1.5" strokeLinecap="round" />
        {/* Flag / bookmark */}
        <path d="M162 28 L162 58 L175 50 L188 58 L188 28 Z" fill="rgba(255,255,255,0.3)" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Decorative dots */}
        <circle cx="45" cy="70" r="18" fill="rgba(255,255,255,0.06)" />
        <circle cx="45" cy="70" r="10" fill="rgba(255,255,255,0.08)" />
        <circle cx="60" cy="120" r="12" fill="rgba(255,255,255,0.05)" />
      </svg>
    ),
  },
  "Tasks": {
    decoration: (
      <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="banner-decoration">
        {/* Clipboard body */}
        <rect x="105" y="30" width="72" height="96" rx="7" fill="rgba(255,255,255,0.1)" stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
        {/* Clipboard clip */}
        <rect x="128" y="24" width="26" height="16" rx="5" fill="rgba(255,255,255,0.22)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        {/* Task lines with checkboxes */}
        {[0, 1, 2, 3].map(i => (
          <g key={i}>
            <rect x="116" y={52 + i * 18} width="10" height="10" rx="2.5" fill="rgba(255,255,255,0.18)" stroke="rgba(255,255,255,0.3)" strokeWidth="1.2" />
            <line x1="132" y1={57 + i * 18} x2="165" y2={57 + i * 18} stroke="rgba(255,255,255,0.22)" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
        {/* First item checked */}
        <path d="M118 57 L121 60 L126 54" stroke="rgba(255,255,255,0.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {/* Second item checked */}
        <path d="M118 75 L121 78 L126 72" stroke="rgba(255,255,255,0.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        {/* Decorative circles */}
        <circle cx="45" cy="80" r="28" stroke="rgba(255,255,255,0.07)" strokeWidth="2" />
        <circle cx="45" cy="80" r="16" stroke="rgba(255,255,255,0.05)" strokeWidth="2" />
      </svg>
    ),
  },
};

const SPECIAL_LISTS = new Set(["My Day", "Planned", "Important", "Assigned to Me", "Flagged Emails", "Tasks"]);

export function ListBanner({ activeList, displayName }: ListBannerProps) {
  const config = BANNER_CONFIG[activeList];

  const dateLabel = useMemo(() => {
    if (activeList !== "My Day") return null;
    const now = new Date();
    return now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }, [activeList]);

  if (!config || !SPECIAL_LISTS.has(activeList)) return null;

  return (
    <div className="list-banner" data-view={activeList.toLowerCase().replace(/ /g, "-")}>
      <div className="list-banner-content">
        <div className="list-banner-text">
          <h2 className="list-banner-title">{displayName}</h2>
          {dateLabel && <p className="list-banner-subtitle">{dateLabel}</p>}
        </div>
      </div>
      {config.decoration}
    </div>
  );
}

export { SPECIAL_LISTS };
