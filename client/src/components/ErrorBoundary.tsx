import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      // お客様セッションページかどうかを判定
      const isSessionPage =
        typeof window !== "undefined" &&
        window.location.pathname.startsWith("/session/");

      // セッションURLを保持（「セッションに戻る」ボタン用）
      const sessionUrl =
        typeof window !== "undefined" ? window.location.href : "/";

      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#f9f5f4",
            padding: "24px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              border: "1px solid #d4bfbb",
              boxShadow: "0 4px 24px rgba(107,91,88,0.08)",
              padding: "40px 32px",
              maxWidth: "480px",
              width: "100%",
              textAlign: "center",
            }}
          >
            {/* Logo */}
            <div
              style={{
                fontFamily: "'Cormorant Garamond', serif",
                fontSize: "26px",
                color: "#c9a8a3",
                letterSpacing: "2px",
                marginBottom: "24px",
              }}
            >
              ✦ angelique
            </div>

            {/* Icon */}
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>⚠️</div>

            {/* Title */}
            <h2
              style={{
                fontFamily: "'Noto Sans JP', sans-serif",
                fontSize: "18px",
                color: "#6b5b58",
                fontWeight: 600,
                marginBottom: "12px",
              }}
            >
              申し訳ありません
            </h2>

            {/* Message */}
            <p
              style={{
                fontFamily: "'Noto Sans JP', sans-serif",
                fontSize: "14px",
                color: "#9e8480",
                lineHeight: 1.8,
                marginBottom: "32px",
              }}
            >
              問題が発生しました。
              <br />
              ページを再読み込みするか、トップページにお戻りください。
              <br />
              問題が続く場合はお手数ですが占い師にご連絡ください。
            </p>

            {/* Buttons */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                alignItems: "center",
              }}
            >
              {/* Reload button */}
              <button
                onClick={() => window.location.reload()}
                style={{
                  background: "#c9a8a3",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "24px",
                  padding: "12px 32px",
                  fontSize: "14px",
                  fontFamily: "'Noto Sans JP', sans-serif",
                  cursor: "pointer",
                  width: "100%",
                  maxWidth: "280px",
                  fontWeight: 500,
                }}
              >
                ページを再読み込み
              </button>

              {/* Back to session button (only on session pages) */}
              {isSessionPage && (
                <button
                  onClick={() => {
                    this.setState({ hasError: false, error: null });
                    window.location.href = sessionUrl;
                  }}
                  style={{
                    background: "#f3e7e5",
                    color: "#6b5b58",
                    border: "1px solid #d4bfbb",
                    borderRadius: "24px",
                    padding: "12px 32px",
                    fontSize: "14px",
                    fontFamily: "'Noto Sans JP', sans-serif",
                    cursor: "pointer",
                    width: "100%",
                    maxWidth: "280px",
                    fontWeight: 500,
                  }}
                >
                  セッションに戻る
                </button>
              )}

              {/* Back to top button */}
              <button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.href = "/";
                }}
                style={{
                  background: "transparent",
                  color: "#9e8480",
                  border: "none",
                  borderRadius: "24px",
                  padding: "8px 24px",
                  fontSize: "13px",
                  fontFamily: "'Noto Sans JP', sans-serif",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                トップページに戻る
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
