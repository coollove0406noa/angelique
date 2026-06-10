import { Resend } from "resend";

/** 指定ミリ秒待機するユーティリティ */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
