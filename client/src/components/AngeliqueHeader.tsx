import { Link } from "wouter";

interface AngeliqueHeaderProps {
  isAdmin?: boolean;
  onLogout?: () => void;
}

export default function AngeliqueHeader({ isAdmin, onLogout }: AngeliqueHeaderProps) {
  return (
    <header
      style={{
        background: "#ffffff",
        borderBottom: "1px solid #d4bfbb",
        boxShadow: "0 2px 12px rgba(107,91,88,0.06)",
      }}
      className="sticky top-0 z-50"
    >
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
        {/* Logo */}
        <Link href={isAdmin ? "/admin" : "/"}>
          <div className="flex items-center gap-2 cursor-pointer">
            <span
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "26px",
                fontWeight: 400,
                color: "#c9a8a3",
                letterSpacing: "2px",
                lineHeight: 1,
              }}
            >
              ✦ angelique
            </span>
          </div>
        </Link>

        {/* Nav */}
        {isAdmin && (
          <nav className="flex items-center gap-2">
            <Link href="/admin">
              <span
                style={{
                  fontSize: "13px",
                  color: "#9e8480",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  cursor: "pointer",
                  transition: "background 0.2s",
                }}
                className="hover:bg-[#f3e7e5]"
              >
                セッション
              </span>
            </Link>
            <Link href="/admin/bookings">
              <span
                style={{
                  fontSize: "13px",
                  color: "#9e8480",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  cursor: "pointer",
                }}
                className="hover:bg-[#f3e7e5]"
              >
                予約管理
              </span>
            </Link>
            <Link href="/admin/settings">
              <span
                style={{
                  fontSize: "13px",
                  color: "#9e8480",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  cursor: "pointer",
                }}
                className="hover:bg-[#f3e7e5]"
              >
                設定
              </span>
            </Link>
            {onLogout && (
              <button
                onClick={onLogout}
                style={{
                  fontSize: "13px",
                  color: "#9e8480",
                  padding: "6px 14px",
                  borderRadius: "20px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                }}
                className="hover:bg-[#f3e7e5]"
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
