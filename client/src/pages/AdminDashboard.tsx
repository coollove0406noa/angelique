import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import AngeliqueHeader from "@/components/AngeliqueHeader";
import AdminLogin from "./AdminLogin";
import { useAdminAuth } from "@/contexts/AdminAuthContext";
import { format } from "date-fns";
import { ja } from "date-fns/locale";
import { useLocation } from "wouter";

type Session = {
  id: number;
  clientId: number;
  clientToken: string;
  scheduledAt: Date;
  durationMinutes: number;
  carryoverMinutes: number;
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
  const { isAuthenticated, isLoading, refetch: refetchAuth } = useAdminAuth();
  const [, navigate] = useLocation();

  const { data: sessions = [], refetch: refetchSessions } = trpc.sessions.list.useQuery(
    undefined,
    { refetchInterval: 10000 }
  );

  const startSession = trpc.sessions.start.useMutation({
    onSuccess: (data, vars) => {
      toast.success("セッションを開始しました");
      navigate(`/admin/session/${vars.id}`);
    },
    onError: (e) => toast.error(e.message),
  });

  const logoutMutation = trpc.admin.logout.useMutation({
    onSuccess: () => refetchAuth(),
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#f9f5f4" }}>
        <div style={{ color: "#9e8480" }}>読み込み中...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminLogin onSuccess={refetchAuth} />;
  }

  const activeSessions = sessions.filter((s) => ["active", "paused"].includes(s.status));
  const scheduledSessions = sessions.filter((s) => s.status === "scheduled");
  const pastSessions = sessions.filter((s) => ["completed", "cancelled"].includes(s.status));

  return (
    <div className="min-h-screen" style={{ background: "#f9f5f4" }}>
      <AngeliqueHeader isAdmin onLogout={() => logoutMutation.mutate()} />

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1
            style={{
              fontFamily: "'Cormorant Garamond', serif",
              fontSize: "32px",
              color: "#6b5b58",
              fontWeight: 400,
            }}
          >
            ✦ セッション管理
          </h1>
          <p style={{ fontSize: "13px", color: "#9e8480", marginTop: "4px" }}>
            {format(new Date(), "yyyy年M月d日 (E)", { locale: ja })}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: "進行中", count: activeSessions.length, color: "#388e3c" },
            { label: "予約済", count: scheduledSessions.length, color: "#c9a8a3" },
            { label: "完了", count: pastSessions.length, color: "#9e8480" },
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
              <div style={{ fontSize: "12px", color: "#9e8480", marginTop: "4px" }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Active Sessions */}
        {activeSessions.length > 0 && (
          <div className="mb-6">
            <h2 style={{ fontSize: "15px", color: "#6b5b58", fontWeight: 500, marginBottom: "12px" }}>
              🔴 進行中のセッション
            </h2>
            <div className="grid gap-3">
              {activeSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s as Session}
                  onOpen={() => navigate(`/admin/session/${s.id}`)}
                  onStart={() => startSession.mutate({ id: s.id })}
                  isStarting={startSession.isPending}
                />
              ))}
            </div>
          </div>
        )}

        {/* Scheduled Sessions */}
        {scheduledSessions.length > 0 && (
          <div className="mb-6">
            <h2 style={{ fontSize: "15px", color: "#6b5b58", fontWeight: 500, marginBottom: "12px" }}>
              📅 予約済みセッション
            </h2>
            <div className="grid gap-3">
              {scheduledSessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s as Session}
                  onOpen={() => navigate(`/admin/session/${s.id}`)}
                  onStart={() => startSession.mutate({ id: s.id })}
                  isStarting={startSession.isPending}
                />
              ))}
            </div>
          </div>
        )}

        {/* Past Sessions */}
        {pastSessions.length > 0 && (
          <div>
            <h2 style={{ fontSize: "15px", color: "#6b5b58", fontWeight: 500, marginBottom: "12px" }}>
              過去のセッション
            </h2>
            <div className="angelique-card overflow-hidden">
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9f5f4", borderBottom: "1px solid #d4bfbb" }}>
                    {["お客様", "日時", "時間", "ステータス"].map((h) => (
                      <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: "12px", color: "#9e8480" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pastSessions.slice(0, 10).map((s, i) => (
                    <tr key={s.id} style={{ borderBottom: i < Math.min(pastSessions.length, 10) - 1 ? "1px solid #f3e7e5" : "none" }}>
                      <td style={{ padding: "12px 16px", fontSize: "14px", color: "#6b5b58" }}>{s.clientName}</td>
                      <td style={{ padding: "12px 16px", fontSize: "13px", color: "#9e8480" }}>{formatDate(s.scheduledAt)}</td>
                      <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6b5b58" }}>{s.durationMinutes}分</td>
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
            <p style={{ color: "#9e8480", fontSize: "15px" }}>セッションがありません</p>
            <p style={{ color: "#d4bfbb", fontSize: "13px", marginTop: "8px" }}>
              予約管理画面からセッションを作成してください
            </p>
            <button
              className="angelique-btn mt-6"
              onClick={() => navigate("/admin/bookings")}
            >
              予約管理へ
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionCard({
  session,
  onOpen,
  onStart,
  isStarting,
}: {
  session: Session;
  onOpen: () => void;
  onStart: () => void;
  isStarting: boolean;
}) {
  const isActive = session.status === "active" || session.status === "paused";
  const remaining = getRemainingDisplay(session);

  return (
    <div
      className="angelique-card p-5 flex items-center justify-between gap-4"
      style={{
        borderLeft: isActive ? "3px solid #c9a8a3" : "3px solid transparent",
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-3 mb-1">
          <span style={{ fontSize: "15px", fontWeight: 500, color: "#6b5b58" }}>
            {session.clientName}
          </span>
          <StatusBadge status={session.status} />
        </div>
        <div style={{ fontSize: "13px", color: "#9e8480" }}>
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
            color: "#6b5b58",
            minWidth: "80px",
            textAlign: "center",
          }}
        >
          {remaining}
        </div>
      )}

      <div className="flex gap-2">
        {session.status === "scheduled" && (
          <button
            className="angelique-btn"
            onClick={onStart}
            disabled={isStarting}
            style={{ padding: "8px 20px", fontSize: "13px" }}
          >
            開始
          </button>
        )}
        {isActive && (
          <button
            className="angelique-btn"
            onClick={onOpen}
            style={{ padding: "8px 20px", fontSize: "13px" }}
          >
            チャット画面へ
          </button>
        )}
      </div>
    </div>
  );
}
