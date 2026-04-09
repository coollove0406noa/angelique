import { useLocation } from "wouter";

export default function Home() {
  const [, navigate] = useLocation();

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center"
      style={{ background: "#f9f5f4" }}
    >
      <div className="text-center px-6">
        {/* Logo */}
        <div
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "52px",
            fontWeight: 300,
            color: "#c9a8a3",
            letterSpacing: "6px",
            marginBottom: "8px",
          }}
        >
          ✦ angelique
        </div>
        <div
          style={{
            fontSize: "13px",
            color: "#9e8480",
            letterSpacing: "3px",
            marginBottom: "48px",
          }}
        >
          オンラインセッション管理システム
        </div>

        {/* Cards */}
        <div className="flex gap-4 justify-center flex-wrap">
          <div
            className="angelique-card p-8 cursor-pointer hover:shadow-lg transition-shadow"
            style={{ width: "220px" }}
            onClick={() => navigate("/admin")}
          >
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>🌙</div>
            <div
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "20px",
                color: "#6b5b58",
                marginBottom: "8px",
              }}
            >
              管理者
            </div>
            <p style={{ fontSize: "12px", color: "#9e8480", lineHeight: 1.6 }}>
              セッション管理・予約・チャット
            </p>
          </div>
        </div>

        <p
          style={{
            fontSize: "11px",
            color: "#d4bfbb",
            marginTop: "48px",
          }}
        >
          お客様はメールに記載されたURLからアクセスしてください
        </p>
      </div>
    </div>
  );
}
