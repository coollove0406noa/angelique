import { Resend } from "resend";

/** 指定ミリ秒待機するユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const SESSION_TYPE_LABEL: Record<string, string> = {
  chat: "💬 チャット鑑定",
  voice: "🎙 音声鑑定",
  video: "📹 ビデオ鑑定",
};

export async function sendSessionLog({
  toEmail,
  toName,
  brandName = "angelique",
  sessionDate,
  sessionType,
  messages,
  mainColor = "#f3e7e5",
  accentColor = "#c9a8a3",
}: {
  toEmail: string;
  toName: string;
  brandName?: string;
  sessionDate: Date;
  sessionType: string;
  messages: Array<{
    sender: "admin" | "client" | "system";
    content: string;
    imageUrl?: string | null;
    createdAt: Date;
  }>;
  mainColor?: string;
  accentColor?: string;
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[Mailer] RESEND_API_KEY not set, skipping session log email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(apiKey);

  const dateStr = sessionDate.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const monthDay = sessionDate.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "long",
    day: "numeric",
  });

  // メッセージ行を生成（システムメッセージはスキップ）
  const messageRows = messages
    .filter((m) => m.sender !== "system")
    .map((m) => {
      const timeStr = new Date(m.createdAt).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
      });
      const senderLabel = m.sender === "admin" ? brandName : "あなた";
      const isAdmin = m.sender === "admin";
      const hasImage = m.imageUrl != null && m.imageUrl.startsWith("data:image");

      let bodyText: string;
      if (hasImage) {
        // base64 画像をそのまま埋め込む（失敗時は[画像]にフォールバック）
        try {
          bodyText = `<img src="${m.imageUrl}" style="max-width:200px; max-height:200px; border-radius:8px; display:block; margin-top:4px;" alt="画像" />`;
        } catch {
          bodyText = "[画像]";
        }
      } else {
        const escaped = m.content
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");
        bodyText = escaped || "";
      }

      // content が空で画像なし（スタンプ扱いだが画像がない）はスキップ
      if (!bodyText && !hasImage) return "";

      return `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid ${mainColor}; vertical-align: top;">
          <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
            <span style="font-size: 12px; font-weight: 600; color: ${isAdmin ? accentColor : "#6b5b58"};">${senderLabel}</span>
            <span style="font-size: 11px; color: #b0a09e;">${timeStr}</span>
          </div>
          <div style="font-size: 14px; color: #4a3b38; line-height: 1.6; padding-left: 4px;">${bodyText}</div>
        </td>
      </tr>`;
    })
    .join("");

  const htmlContent = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Noto Sans JP', 'Helvetica Neue', Arial, sans-serif; background: ${mainColor}; color: #4a3b38; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 20px; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .logo { font-family: 'Cormorant Garamond', Georgia, serif; font-size: 28px; color: ${accentColor}; text-align: center; margin-bottom: 4px; letter-spacing: 2px; }
    .tagline { text-align: center; color: #9e8480; font-size: 12px; margin-bottom: 32px; }
    .info-box { background: ${mainColor}; border-radius: 12px; padding: 16px 20px; margin: 20px 0; }
    .info-row { display: flex; gap: 12px; margin-bottom: 6px; font-size: 14px; }
    .info-label { color: #9e8480; min-width: 90px; }
    .info-value { color: #4a3b38; font-weight: 600; }
    .section-title { font-size: 13px; font-weight: 600; color: #9e8480; margin: 24px 0 8px; letter-spacing: 1px; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; }
    .footer { text-align: center; color: #c9b8b5; font-size: 11px; margin-top: 32px; line-height: 1.8; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">✦ ${brandName} ✦</div>
    <div class="tagline">言葉にならない声を整える場所</div>

    <p style="font-size: 15px;">${toName} 様</p>
    <p style="font-size: 14px; color: #6b5b58; line-height: 1.7;">
      本日の鑑定記録をお届けします。<br>
      いつもありがとうございます。
    </p>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">📅 鑑定日時</span>
        <span class="info-value">${dateStr}</span>
      </div>
      <div class="info-row">
        <span class="info-label">🔮 鑑定方法</span>
        <span class="info-value">${SESSION_TYPE_LABEL[sessionType] ?? sessionType}</span>
      </div>
    </div>

    <div class="section-title">チャット記録</div>
    ${messageRows
      ? `<table>${messageRows}</table>`
      : `<p style="color:#9e8480; font-size:13px;">テキストメッセージはありませんでした。</p>`
    }

    <div class="footer">
      このメールは ${brandName} より自動送信されています。<br>
      ご返信はできません。お問い合わせはセッション内にてお願いいたします。<br><br>
      ${brandName} &copy; ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>`;

  try {
    const { error } = await resend.emails.send({
      from: `${brandName} <info@noakayou.com>`,
      to: [toEmail],
      subject: `【${brandName}】鑑定記録のお届け（${monthDay}）`,
      html: htmlContent,
      text: `${toName}様\n\n本日の鑑定記録です。\n日時：${dateStr}\n鑑定方法：${SESSION_TYPE_LABEL[sessionType] ?? sessionType}\n\nこのメールは${brandName}より自動送信されています。`,
    });

    if (error) {
      console.error("[Mailer] sendSessionLog error:", error);
      return { success: false, error: `${error.name}: ${error.message}` };
    }

    console.log(`[Mailer] Session log sent to ${toEmail}`);
    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[Mailer] sendSessionLog unexpected error:", msg);
    return { success: false, error: msg };
  }
}

export async function sendSessionInviteEmail({
  toEmail,
  toName,
  sessionUrl,
  scheduledAt,
  durationMinutes,
  brandName = "angelique",
  mainColor = "#f3e7e5",
  accentColor = "#c9a8a3",
}: {
  toEmail: string;
  toName: string;
  sessionUrl: string;
  scheduledAt: Date;
  durationMinutes: number;
  brandName?: string;
  mainColor?: string;
  accentColor?: string;
}): Promise<{ success: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const fromEmail = "info@noakayou.com";

  if (!apiKey) {
    console.warn("[Mailer] RESEND_API_KEY not set, skipping email send");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const resend = new Resend(apiKey);

  const dateStr = scheduledAt.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const htmlContent = `
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Noto Sans JP', sans-serif; background: ${mainColor}; color: #4a3b38; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 40px auto; background: #fff; border-radius: 20px; padding: 40px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .logo { font-family: 'Cormorant Garamond', serif; font-size: 28px; color: ${accentColor}; text-align: center; margin-bottom: 8px; }
    .subtitle { text-align: center; color: #9e8480; font-size: 13px; margin-bottom: 32px; }
    h2 { color: #4a3b38; font-size: 18px; }
    .info-box { background: ${mainColor}; border-radius: 12px; padding: 20px; margin: 24px 0; }
    .info-row { display: flex; margin-bottom: 8px; }
    .info-label { color: #9e8480; min-width: 120px; font-size: 14px; }
    .info-value { color: #4a3b38; font-size: 14px; font-weight: 600; }
    .btn { display: block; width: fit-content; margin: 32px auto; background: ${accentColor}; color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 24px; font-size: 16px; font-weight: 600; }
    .notice { background: ${mainColor}; border-radius: 12px; padding: 16px; font-size: 13px; color: #9e8480; margin-top: 24px; }
    .footer { text-align: center; color: #bbb; font-size: 12px; margin-top: 32px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">✦ ${brandName} ✦</div>
    <div class="subtitle">言葉にならない声を整える場所</div>
    <h2>${toName} 様</h2>
    <p>この度はご予約いただきありがとうございます。<br>以下の内容でオンラインセッションのご案内をお送りします。</p>
    <div class="info-box">
      <div class="info-row">
        <span class="info-label">📅 セッション日時</span>
        <span class="info-value">${dateStr}</span>
      </div>
      <div class="info-row">
        <span class="info-label">⏱ セッション時間</span>
        <span class="info-value">${durationMinutes}分</span>
      </div>
    </div>
    <p>下のボタンからセッションにご参加ください：</p>
    <a href="${sessionUrl}" class="btn">✦ セッションに参加する</a>
    <div class="notice">
      <strong>【ご注意事項】</strong><br>
      ・URLは本人のみご利用ください。第三者への共有はご遠慮ください。<br>
      ・セッション開始時刻の少し前にURLを開いてお待ちください。<br>
      ・通信環境の良い場所でご参加ください。<br>
      ・ご不明な点はお気軽にお問い合わせください。
    </div>
    <div class="footer">${brandName} &copy; ${new Date().getFullYear()}</div>
  </div>
</body>
</html>
`;

  // 最大3回試行（初回 + リトライ2回）
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 2000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { error } = await resend.emails.send({
        from: `${brandName} <${fromEmail}>`,
        to: [toEmail],
        subject: `【${brandName}】セッションのご案内 - ${dateStr}`,
        html: htmlContent,
        text: `${toName}様\n\nセッションのご案内です。\n日時：${dateStr}\n時間：${durationMinutes}分\n\n参加URL：${sessionUrl}\n\n※URLは本人のみご利用ください。`,
      });

      if (error) {
        const errorMsg = `[Resend] ${error.name}: ${error.message}`;
        console.error(`[Mailer] Resend error (attempt ${attempt}/${MAX_ATTEMPTS}):`, errorMsg);

        // 429 Rate limit → リトライ
        if (error.name === "rate_limit_exceeded" && attempt < MAX_ATTEMPTS) {
          console.warn(`[Mailer] Rate limited. Retrying in ${RETRY_DELAY_MS}ms...`);
          await sleep(RETRY_DELAY_MS);
          continue;
        }

        return { success: false, error: errorMsg };
      }

      console.log(`[Mailer] Email sent successfully to ${toEmail} (attempt ${attempt})`);
      return { success: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Mailer] Unexpected error (attempt ${attempt}/${MAX_ATTEMPTS}):`, errorMsg);

      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      return { success: false, error: errorMsg };
    }
  }

  return { success: false, error: "Max retry attempts exceeded" };
}
