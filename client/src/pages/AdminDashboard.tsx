import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { useBrand } from "@/contexts/BrandContext";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useLocation, useParams } from "wouter";
import { QRCodeSVG } from "qrcode.react";
import { io, Socket } from "socket.io-client";

type Session = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
  sessionType: "chat" | "voice" | "video";
  status: string;
  startedAt: Date | null;
  remainingSeconds: number | null;
  timerStartedAt: number | null;
  clientName: string | null;
  clientEmail: string | null;
};

function formatDate(d: Date | string) {
  return format(new Date(d), "M/d (E) HH:mm", { locale: ja });
}

function StatusBadge({ status }: { status: string }) {
  const labels: Record<string, string> = {
    scheduled: "予約済",
    active: "進行中",
    paused: "一時停止",
    completed: "完了",
    cancelled: "キャンセル",
  };
  return <span className={`angelique-badge badge-${status}`}>{labels[status] ?? status}</span>;
}

function getRemainingDisplay(session: Session): string {
  if (session.status === "scheduled") return "-";
  if (session.status === "completed") return "完了";
  if (session.status === "cancelled") return "キャンセル";

  let remaining = session.remainingSeconds ?? 0;
  if (session.status === "active" && session.timerStartedAt) {
    const elapsed = Math.floor((Date.now() - session.timerStartedAt) / 1000);
    remaining = Math.max(0, remaining - elapsed);
  }
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AdminDashboard() {
  const { slug } = useParams<{ slug: string }>();
  const { isAuthenticated, isLoading, fortuneTeller, refetch: refetchAuth } = useAdminAuth();
  const { colors } = useBrand();
  const [, navigate] = useLocation();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io({ path: "/api/socket" });
    socketRef.current = socket;
    return () => { socket.disconnect(); };
  }, []);

  const { data: sessions = [], refetch: refetchSessions } = trpc.sessions.list.useQuery(
    { fortuneTellerId: fortuneTeller?.fortuneTellerId ?? 0 },
    {
      enabled: isAuthenticated && !!fortuneTeller,
      refetchInterval: 10000,
    }
  );

  const logoutMutation = trpc.admin.logout.useMutation({
    onSuccess: () => refetchAuth(),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: colors.main }}>
        <div style={{ color: colors.subText }}>読み込み中...</div>
      </div>
    );
  }

  // Wrong fortune teller logged in
  if (isAuthenticated && fortuneTeller && fortuneTeller.slug !== slug) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: colors.main }}>
        <div className="angelique-card p-8 text-center">
          <p style={{ color: colors.text, marginBottom: "16px" }}>
            別のアカウントでログイン中です。
          </p>
          <button
            className="angelique-btn"
            onClick={() => logoutMutation.mutate()}
          >
            ログアウトして切り替え
          </button>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLogin slug={slug} onSuccess={refetchAuth} />;
  }

  const activeSessions = sessions.filter((s) => ["active", "paused"].includes(s.status));
  const scheduledSessions = sessions.filter((s) => s.status === "scheduled");
  const pastSessions = sessions.filter((s) => ["completed", "cancelled"].includes(s.status));

  return (
    <div className="min-h-screen" style={{ background: colors.main }}>
      <AngeliqueHeader isAdmin slug={slug} onLogout={() => logoutMutation.mutate()} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "32px",
              color: colors.text,
              fontWeight: 400,
            }}
          >
            ✦ セッション管理
          </h1>
          <p style={{ fontSize: "13px", color: colors.subText, marginTop: "4px" }}>
            {format(new Date(), "yyyy年M月d日 (E)", { locale: ja })}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "進行中", count: activeSessions.length, color: "#388e3c" },
            { label: "予約済", count: scheduledSessions.length, color: colors.accent },
            { label: "完了", count: pastSessions.length, color: colors.subText },
          ].map((stat) => (
            <div key={stat.label} className="angelique-card p-5 text-center">
              <div
                style={{
                  fontFamily: "'Cormorant Garamond', serif",
                  fontSize: "40px",
                  fontWeight: 300,
                  color: stat.color,
                  lineHeight: 1,
                }}
              >
                {stat.count}
              </div>
              <div style={{ fontSize: "12px", color: colors.subText, marginTop: "4px" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <div className="mb-6">
            <h2 style={{ fontSize: "15px", color: colors.text, fontWeight: 500, marginBottom: "12px" }}>
              🔴 進行中のセッション
            </h2>
            <div className="grid gap-3">
              {activeSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s as unknown as Session}
                  slug={slug}
                  onOpen={() => navigate(`/admin/${slug}/session/${s.id}`)}
                  onEnterRoom={() => navigate(`/admin/${slug}/session/${s.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Scheduled Sessions */}
        {scheduledSessions.length > 0 && (
          <div className="mb-6">
            <h2 style={{ fontSize: "15px", color: colors.text, fontWeight: 500, marginBottom: "12px" }}>
              📅 予約済みセッション
            </h2>
            <div className="grid gap-3">
              {scheduledSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s as unknown as Session}
                  slug={slug}
                  onOpen={() => navigate(`/admin/${slug}/session/${s.id}`)}
                  onEnterRoom={() => navigate(`/admin/${slug}/session/${s.id}`)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Past Sessions */}
        {pastSessions.length > 0 && (
          <div>
            <h2 style={{ fontSize: "15px", color: colors.text, fontWeight: 500, marginBottom: "12px" }}>
              過去のセッション
            </h2>
            <div className="angelique-card overflow-hidden">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: colors.main, borderBottom: `1px solid ${colors.border}` }}>
                    {["お客様", "日時", "時間", "ステータス"].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: "12px", color: colors.subText }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pastSessions.slice(0, 10).map((s, i) => (
                    <tr
                      key={s.id}
                      style={{
                        borderBottom: i < Math.min(pastSessions.length, 10) - 1 ? `1px solid ${colors.main}` : "none",
                        cursor: "pointer",
                      }}
                      onClick={() => navigate(`/admin/${slug}/session/${s.id}`)}
                      className="hover:bg-[var(--brand-main)]"
                    >
                      <td style={{ padding: "12px 16px", fontSize: "14px", color: colors.text }}>{s.clientName}</td>
                      <td style={{ padding: "12px 16px", fontSize: "13px", color: colors.subText }}>{formatDate(s.scheduledAt)}</td>
                      <td style={{ padding: "12px 16px", fontSize: "13px", color: colors.text }}>{s.durationMinutes}分</td>
                      <td style={{ padding: "12px 16px" }}><StatusBadge status={s.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sessions.length === 0 && (
          <div className="angelique-card p-16 text-center">
            <div style={{ fontSize: "48px", marginBottom: "12px" }}>✦</div>
            <p style={{ color: colors.subText, fontSize: "15px" }}>セッションがありません</p>
            <p style={{ color: colors.border, fontSize: "13px", marginTop: "8px" }}>
              予約管理画面からセッションを作成してください
            </p>
            <button
              className="angelique-btn mt-6"
              onClick={() => navigate(`/admin/${slug}/bookings`)}
            >
              予約管理へ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function downloadQRAsPng(svgEl: SVGSVGElement | null, clientName: string | null) {
  if (!svgEl) return;
  const serializer = new XMLSerializer();
  const svgStr = serializer.serializeToString(svgEl);
  const img = new Image();
  const size = 220;
  img.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = size + 40;
    canvas.height = size + 40;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 20, 20, size, size);
    const link = document.createElement("a");
    link.download = `qr_${clientName ?? "session"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };
  img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgStr)));
}

function QRModal({ url, clientName, onClose }: { url: string; clientName: string | null; onClose: () => void }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const { colors } = useBrand();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(107,91,88,0.35)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="angelique-card p-8 w-full max-w-xs mx-4 text-center">
        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: "20px", color: colors.text, marginBottom: "4px" }}>
          QRコード
        </div>
        <p style={{ fontSize: "12px", color: colors.subText, marginBottom: "20px" }}>
          {clientName} 様のセッションURL
        </p>
        <div style={{ display: "inline-flex", padding: "12px", background: "#fff", borderRadius: "12px", border: `1px solid ${colors.border}`, marginBottom: "16px" }}>
          <QRCodeSVG value={url} size={180} ref={svgRef} />
        </div>
        <p style={{ fontSize: "10px", color: colors.subText, wordBreak: "break-all", marginBottom: "16px", lineHeight: 1.5 }}>
          {url}
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          <button className="angelique-btn-outline" style={{ padding: "6px 16px", fontSize: "12px" }} onClick={() => { navigator.clipboard.writeText(url); }}>
            URLをコピー
          </button>
          <button className="angelique-btn-outline" style={{ padding: "6px 16px", fontSize: "12px" }} onClick={() => downloadQRAsPng(svgRef.current, clientName)}>
            PNG保存
          </button>
          <button className="angelique-btn-outline" style={{ padding: "6px 16px", fontSize: "12px" }} onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionCard({
  session,
  slug,
  onOpen,
  onEnterRoom,
}: {
  session: Session;
  slug: string;
  onOpen: () => void;
  onEnterRoom: () => void;
}) {
  const isActive = session.status === "active" || session.status === "paused";
  const remaining = getRemainingDisplay(session);
  const [showQR, setShowQR] = useState(false);
  const { colors } = useBrand();
  const clientUrl = `${window.location.origin}/session/${session.clientToken}`;

  return (
    <div
      className="angelique-card p-5 flex items-center justify-between gap-4"
      style={{ borderLeft: isActive ? `3px solid ${colors.accent}` : "3px solid transparent" }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1 flex-wrap">
          <span style={{ fontSize: "15px", fontWeight: 500, color: colors.text }}>
            {session.clientName}
          </span>
          <StatusBadge status={session.status} />
          <span
            style={{
              fontSize: "11px",
              padding: "2px 8px",
              borderRadius: "8px",
              background:
                session.sessionType === "voice" ? "#e8f5e9"
                : session.sessionType === "video" ? "#e3f2fd"
                : colors.main,
              color:
                session.sessionType === "voice" ? "#2e7d32"
                : session.sessionType === "video" ? "#1565c0"
                : colors.subText,
              border:
                session.sessionType === "voice" ? "1px solid #a5d6a7"
                : session.sessionType === "video" ? "1px solid #90caf9"
                : `1px solid ${colors.border}`,
              fontWeight: 500,
            }}
          >
            {session.sessionType === "voice" ? "音声"
             : session.sessionType === "video" ? "ビデオ"
             : "チャット"}
          </span>
        </div>
        <div style={{ fontSize: "13px", color: colors.subText }}>
          {format(new Date(session.scheduledAt), "M/d (E) HH:mm", { locale: ja })} ·{" "}
          {session.durationMinutes}分
          {session.carryoverMinutes > 0 && ` (+${session.carryoverMinutes}分繰越)`}
        </div>
      </div>

      {isActive && (
        <div
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: "24px",
            color: colors.text,
            minWidth: "80px",
            textAlign: "center",
          }}
        >
          {remaining}
        </div>
      )}

      {showQR && (
        <QRModal url={clientUrl} clientName={session.clientName} onClose={() => setShowQR(false)} />
      )}

      <div className="flex gap-2">
        <button
          className="angelique-btn-outline"
          onClick={() => setShowQR(true)}
          style={{ padding: "8px 12px", fontSize: "13px" }}
          title="QRコードを表示"
        >
          QR
        </button>
        {(session.status === "scheduled" || isActive) && (
          <button
            className="angelique-btn"
            onClick={onEnterRoom}
            style={{ padding: "8px 20px", fontSize: "13px" }}
          >
            入室
          </button>
        )}
      </div>
    </div>
  );
}
