import { createContext, useContext, useEffect } from "react";

export type ThemeColorKey =
  | "dusty-pink"
  | "lavender"
  | "mint-green"
  | "sky-blue"
  | "peach"
  | "gold"
  | "mauve"
  | "off-white";

export interface ThemeColors {
  main: string;
  accent: string;
  text: string;
  subText: string;
  border: string;
  cardBg: string;
}

export const THEME_COLOR_MAP: Record<ThemeColorKey, ThemeColors> = {
  "dusty-pink": {
    main: "#f3e7e5",
    accent: "#c9a8a3",
    text: "#6b5b58",
    subText: "#9e8480",
    border: "#d4bfbb",
    cardBg: "#ffffff",
  },
  lavender: {
    main: "#ede7f6",
    accent: "#9575cd",
    text: "#4a3f6b",
    subText: "#7e6ea0",
    border: "#c5b3e0",
    cardBg: "#ffffff",
  },
  "mint-green": {
    main: "#e8f5e9",
    accent: "#66bb6a",
    text: "#2e5b31",
    subText: "#5a8a5d",
    border: "#a5d6a7",
    cardBg: "#ffffff",
  },
  "sky-blue": {
    main: "#e3f2fd",
    accent: "#42a5f5",
    text: "#1a3a5c",
    subText: "#4a7a9b",
    border: "#90caf9",
    cardBg: "#ffffff",
  },
  peach: {
    main: "#fce4ec",
    accent: "#f48fb1",
    text: "#6b2d42",
    subText: "#9e5a72",
    border: "#f8bbd0",
    cardBg: "#ffffff",
  },
  gold: {
    main: "#fff8e1",
    accent: "#ffc107",
    text: "#5c4a00",
    subText: "#8a7230",
    border: "#ffe082",
    cardBg: "#ffffff",
  },
  mauve: {
    main: "#f3e5f5",
    accent: "#ab47bc",
    text: "#4a1a55",
    subText: "#7a4a85",
    border: "#ce93d8",
    cardBg: "#ffffff",
  },
  "off-white": {
    main: "#fafafa",
    accent: "#9e9e9e",
    text: "#333333",
    subText: "#666666",
    border: "#e0e0e0",
    cardBg: "#ffffff",
  },
};

export const THEME_COLOR_LABELS: Record<ThemeColorKey, string> = {
  "dusty-pink": "① くすみピンク",
  lavender: "② ラベンダー",
  "mint-green": "③ ミントグリーン",
  "sky-blue": "④ スカイブルー",
  peach: "⑤ ピーチ",
  gold: "⑥ ゴールド",
  mauve: "⑦ モーブ",
  "off-white": "⑧ オフホワイト（モノトーン）",
};

export const THEME_COLOR_KEYS = Object.keys(THEME_COLOR_MAP) as ThemeColorKey[];

export function getThemeColors(colorKey: string): ThemeColors {
  return THEME_COLOR_MAP[colorKey as ThemeColorKey] ?? THEME_COLOR_MAP["dusty-pink"];
}

interface BrandContextType {
  brandName: string;
  themeColor: ThemeColorKey;
  colors: ThemeColors;
}

const BrandContext = createContext<BrandContextType>({
  brandName: "angelique",
  themeColor: "dusty-pink",
  colors: THEME_COLOR_MAP["dusty-pink"],
});

export function BrandProvider({
  brandName,
  themeColor,
  children,
}: {
  brandName: string;
  themeColor: string;
  children: React.ReactNode;
}) {
  const key = (THEME_COLOR_KEYS.includes(themeColor as ThemeColorKey)
    ? themeColor
    : "dusty-pink") as ThemeColorKey;
  const colors = THEME_COLOR_MAP[key];

  // Apply CSS variables to document root for global use
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
    <BrandContext.Provider value={{ brandName, themeColor: key, colors }}>
      {children}
    </BrandContext.Provider>
  );
}

export function useBrand() {
  return useContext(BrandContext);
}
