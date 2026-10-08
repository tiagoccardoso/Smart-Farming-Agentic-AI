/** Ícones discretos (SVG inline, sem dependência externa). */
import type { ReactNode } from "react";

type IconProps = { className?: string };

const base = "shrink-0";

function Svg({ className = "h-5 w-5", children }: IconProps & { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`${base} ${className}`}>
      {children}
    </svg>
  );
}

export const IconChevron = (p: IconProps) => <Svg {...p}><path d="m6 9 6 6 6-6" /></Svg>;
export const IconSummary = (p: IconProps) => <Svg {...p}><path d="M4 6h16M4 12h10M4 18h7" /></Svg>;
export const IconLeaf = (p: IconProps) => <Svg {...p}><path d="M5 21c0-9 5-15 15-16-1 10-7 15-15 16Z" /><path d="M5 21 13 13" /></Svg>;
export const IconSearch = (p: IconProps) => <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Svg>;
export const IconFlask = (p: IconProps) => <Svg {...p}><path d="M9 3h6M10 3v6L4.8 18.2A1.9 1.9 0 0 0 6.5 21h11a1.9 1.9 0 0 0 1.7-2.8L14 9V3" /><path d="M7.5 15h9" /></Svg>;
export const IconTractor = (p: IconProps) => <Svg {...p}><circle cx="7" cy="17" r="3" /><circle cx="18" cy="18" r="2" /><path d="M10 17h6M4 14V8h7l2 6M13 8h4l2 8" /></Svg>;
export const IconShield = (p: IconProps) => <Svg {...p}><path d="M12 3 5 6v6c0 4.4 3 7.6 7 9 4-1.4 7-4.6 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></Svg>;
export const IconSteps = (p: IconProps) => <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>;
export const IconBook = (p: IconProps) => <Svg {...p}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z" /><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20" /></Svg>;
export const IconChat = (p: IconProps) => <Svg {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12Z" /></Svg>;
export const IconMic = (p: IconProps) => <Svg {...p}><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></Svg>;
export const IconCamera = (p: IconProps) => <Svg {...p}><path d="M4 8h3l2-3h6l2 3h3v11H4V8Z" /><circle cx="12" cy="13" r="3.5" /></Svg>;
export const IconImage = (p: IconProps) => <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></Svg>;
export const IconSend = (p: IconProps) => <Svg {...p}><path d="M4 12 20 4l-6 16-3-7-7-1Z" /></Svg>;
export const IconClose = (p: IconProps) => <Svg {...p}><path d="M6 6l12 12M18 6 6 18" /></Svg>;
export const IconRetry = (p: IconProps) => <Svg {...p}><path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5M4 20v-4.5h4.5" /></Svg>;
export const IconEdit = (p: IconProps) => <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></Svg>;
export const IconSparkle = (p: IconProps) => <Svg {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" /></Svg>;
export const IconUser = (p: IconProps) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></Svg>;
export const IconCheck = (p: IconProps) => <Svg {...p}><path d="m5 12 4.5 4.5L19 7" /></Svg>;
export const IconAlert = (p: IconProps) => <Svg {...p}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /></Svg>;
export const IconTrash = (p: IconProps) => <Svg {...p}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>;
export const IconClock = (p: IconProps) => <Svg {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Svg>;
export const IconExternal = (p: IconProps) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6" /></Svg>;
export const IconStop = (p: IconProps) => <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Svg>;
export const IconDoc = (p: IconProps) => <Svg {...p}><path d="M6 3h8l4 4v14H6V3Z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></Svg>;
