import { createContext, useContext, useEffect } from "react";

export interface ThemeColors {
  main: string;
  accent: string;
  text: string;
  subText: string;
  border: string;
  cardBg: string;
}

// 旧テーマキー名→hex への後方互換マップ
const LEGACY_COLOR_MAP: Record<string, { main: string; accent: string }> = {
  "dusty-pink":  { main: "#f3e7e5", accent: "#c9a8a3" },
  "lavender":    { main: "#ede7f6", accent: "#9575cd" },
  "mint-green":  { main: "#e8f5e9", accent: "#66bb6a" },
  "sky-blue":    { main: "#e3f2fd", accent: "#42a5f5" },
  "peach":       { main: "#fce4ec", accent: "#f48fb1" },
  "gold":        { main: "#fff8e1", accent: "#ffc107" },
  "mauve":       { main: "#f3e5f5", accent: "#ab47bc" },
  "off-white":   { main: "#fafafa", accent: "#9e9e9e" },
};

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function toHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}

function blendWithBlack(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return toHex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}

function blendWithWhite(hex: string, amount: number): string {
  const { r, g, b } = hexToRgb(hex);
  return toHex(r + (255 - r) * amount, g + (255 - g) * amount, b + (255 - b) * amount);
}

function buildColors(mainColor: string, accentColor: string): ThemeColors {
  return {
    main: mainColor,
    accent: accentColor,
    text: blendWithBlack(accentColor, 0.45),
    subText: blendWithBlack(accentColor, 0.25),
    border: blendWithWhite(accentColor, 0.35),
    cardBg: "#ffffff",
  };
}

/** 旧キー名または hex を受け取り ThemeColors を返す */
export function resolveColors(mainColor: string, accentColor?: string): ThemeColors {
  if (LEGACY_COLOR_MAP[mainColor]) {
    const legacy = LEGACY_COLOR_MAP[mainColor];
    return buildColors(legacy.main, accentColor && accentColor.startsWith("#") ? accentColor : legacy.accent);
  }
  const main = mainColor.startsWith("#") ? mainColor : "#f3e7e5";
  const accent = accentColor && accentColor.startsWith("#") ? accentColor : "#c9a8a3";
  return buildColors(main, accent);
}

interface BrandContextType {
  brandName: string;
  mainColor: string;
  accentColor: string;
  colors: ThemeColors;
}

const DEFAULT_MAIN = "#f3e7e5";
const DEFAULT_ACCENT = "#c9a8a3";

const BrandContext = createContext<BrandContextType>({
  brandName: "angelique",
  mainColor: DEFAULT_MAIN,
  accentColor: DEFAULT_ACCENT,
  colors: buildColors(DEFAULT_MAIN, DEFAULT_ACCENT),
});

export function BrandProvider({
  brandName,
  themeColor,
  accentColor,
  children,
}: {
  brandName: string;
  themeColor: string;
  accentColor?: string;
  children: React.ReactNode;
}) {
  const colors = resolveColors(themeColor, accentColor);

  // 旧キーの場合は変換後の hex を使う
  const resolvedMain = colors.main;
  const resolvedAccent = colors.accent;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--brand-main", colors.main);
    root.style.setProperty("--brand-accent", colors.accent);
    root.style.setProperty("--brand-text", colors.text);
    root.style.setProperty("--brand-sub-text", colors.subText);
    root.style.setProperty("--brand-border", colors.border);
    root.style.setProperty("--brand-card-bg", colors.cardBg);
  }, [colors]);

  return (
    <BrandContext.Provider
      value={{ brandName, mainColor: resolvedMain, accentColor: resolvedAccent, colors }}
    >
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
