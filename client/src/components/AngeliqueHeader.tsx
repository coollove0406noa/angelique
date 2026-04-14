import { Link } from "wouter";
import { useBrand } from "@/contexts/BrandContext";

interface AngeliqueHeaderProps {
  isAdmin?: boolean;
  slug?: string;
  onLogout?: () => void;
}

export default function AngeliqueHeader({ isAdmin, slug, onLogout }: AngeliqueHeaderProps) {
  const { brandName, colors } = useBrand();
  const adminBase = slug ? `/admin/${slug}` : "/admin";

  return (
    <header
      style={{
        background: colors.cardBg,
        borderBottom: `1px solid ${colors.border}`,
        boxShadow: "0 2px 12px rgba(107,91,88,0.06)",
      }}
      className="sticky top-0 z-50"
    >
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo / Brand Name */}
        <Link href={isAdmin ? adminBase : "/"}>
          <div className="flex items-center gap-2 cursor-pointer">
            <span
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "22px",
                fontWeight: 400,
                color: colors.accent,
                letterSpacing: "2px",
                lineHeight: 1,
              }}
            >
              ✦ {brandName}
            </span>
          </div>
        </Link>

        {/* Nav */}
        {isAdmin && (
          <nav className="flex items-center gap-1 flex-wrap">
            <Link href={adminBase}>
              <span
                style={{
                  fontSize: "13px",
                  color: colors.subText,
                  padding: "6px 12px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                className="hover:bg-[var(--brand-main)]"
              >
                セッション
              </span>
            </Link>
            <Link href={`${adminBase}/clients`}>
              <span
                style={{
                  fontSize: "13px",
                  color: colors.subText,
                  padding: "6px 12px",
                  borderRadius: "20px",
                  cursor: "pointer",
                }}
                className="hover:bg-[var(--brand-main)]"
              >
                お客様
              </span>
            </Link>
            <Link href={`${adminBase}/bookings`}>
              <span
                style={{
                  fontSize: "13px",
                  color: colors.subText,
                  padding: "6px 12px",
                  borderRadius: "20px",
                  cursor: "pointer",
                }}
                className="hover:bg-[var(--brand-main)]"
              >
                予約管理
              </span>
            </Link>
            <Link href={`${adminBase}/settings`}>
              <span
                style={{
                  fontSize: "13px",
                  color: colors.subText,
                  padding: "6px 12px",
                  borderRadius: "20px",
                  cursor: "pointer",
                }}
                className="hover:bg-[var(--brand-main)]"
              >
                設定
              </span>
            </Link>
            {onLogout && (
              <button
                onClick={onLogout}
                style={{
                  fontSize: "13px",
                  color: colors.subText,
                  padding: "6px 12px",
                  borderRadius: "20px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
                className="hover:bg-[var(--brand-main)]"
              >
                ログアウト
              </button>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
