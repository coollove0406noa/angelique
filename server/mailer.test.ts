import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @sendgrid/mail
vi.mock("@sendgrid/mail", () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue([{ statusCode: 202 }]),
  },
}));

import sgMail from "@sendgrid/mail";
import { sendSessionInviteEmail } from "./mailer";

describe("sendSessionInviteEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns error when SENDGRID_API_KEY is not set", async () => {
    const original = process.env.SENDGRID_API_KEY;
    delete process.env.SENDGRID_API_KEY;

    const result = await sendSessionInviteEmail({
      toEmail: "test@example.com",
      toName: "テスト太郎",
      sessionUrl: "https://example.com/session/abc123",
      scheduledAt: new Date("2026-04-10T10:00:00Z"),
      durationMinutes: 60,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("SENDGRID_API_KEY not configured");
    process.env.SENDGRID_API_KEY = original;
  });

  it("calls sgMail.send with correct params when API key is set", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key_for_validation";
    process.env.SENDGRID_FROM_EMAIL = "info@noakayou.com";

    const result = await sendSessionInviteEmail({
      toEmail: "client@example.com",
      toName: "山田花子",
      sessionUrl: "https://angeliqueapp.manus.space/session/tok123",
      scheduledAt: new Date("2026-04-15T14:00:00+09:00"),
      durationMinutes: 60,
    });

    expect(sgMail.setApiKey).toHaveBeenCalledWith("SG.test_key_for_validation");
    expect(sgMail.send).toHaveBeenCalledTimes(1);

    const callArg = vi.mocked(sgMail.send).mock.calls[0][0] as {
      to: { email: string; name: string };
      from: { email: string; name: string };
      subject: string;
    };
    expect(callArg.to).toMatchObject({ email: "client@example.com", name: "山田花子" });
    expect(callArg.from).toMatchObject({ email: "info@noakayou.com", name: "angelique" });
    expect(callArg.subject).toContain("angelique");
    expect(result.success).toBe(true);
  });

  it("returns error when sgMail.send throws a generic error", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key";
    vi.mocked(sgMail.send).mockRejectedValue(new Error("Unauthorized"));

    const result = await sendSessionInviteEmail({
      toEmail: "fail@example.com",
      toName: "失敗テスト",
      sessionUrl: "https://example.com/session/fail",
      scheduledAt: new Date(),
      durationMinutes: 30,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unauthorized");
    // Unauthorized は 401 なのでリトライなし → 1回のみ呼ばれる
    expect(sgMail.send).toHaveBeenCalledTimes(1);
  });

  it("retries up to 3 times on 429 Rate exceeded and returns error after all retries fail", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key";
    const rateError = Object.assign(new Error("Too Many Requests"), {
      code: 429,
      response: {
        statusCode: 429,
        body: { errors: [{ message: "Rate exceeded", field: null, help: null }] },
      },
    });
    vi.mocked(sgMail.send).mockRejectedValue(rateError);

    const result = await sendSessionInviteEmail({
      toEmail: "rate@example.com",
      toName: "レートテスト",
      sessionUrl: "https://example.com/session/rate",
      scheduledAt: new Date(),
      durationMinutes: 30,
    });

    expect(result.success).toBe(false);
    // エラーメッセージに HTTP ステータスコードと詳細が含まれること
    expect(result.error).toContain("429");
    expect(result.error).toContain("Rate exceeded");
    // 3回リトライしていること
    expect(sgMail.send).toHaveBeenCalledTimes(3);
  });

  it("succeeds on second attempt after 429 on first attempt", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key";
    const rateError = Object.assign(new Error("Too Many Requests"), {
      code: 429,
      response: {
        statusCode: 429,
        body: { errors: [{ message: "Rate exceeded", field: null, help: null }] },
      },
    });
    vi.mocked(sgMail.send)
      .mockRejectedValueOnce(rateError)
      .mockResolvedValueOnce([{ statusCode: 202 }] as never);

    const result = await sendSessionInviteEmail({
      toEmail: "retry@example.com",
      toName: "リトライテスト",
      sessionUrl: "https://example.com/session/retry",
      scheduledAt: new Date(),
      durationMinutes: 30,
    });

    expect(result.success).toBe(true);
    // 1回失敗 + 1回成功 = 合計2回
    expect(sgMail.send).toHaveBeenCalledTimes(2);
  });

  it("includes HTTP status code and body errors in error message", async () => {
    process.env.SENDGRID_API_KEY = "SG.test_key";
    const forbiddenError = Object.assign(new Error("Forbidden"), {
      code: 403,
      response: {
        statusCode: 403,
        body: {
          errors: [
            { message: "The from address does not match a verified Sender Identity", field: "from", help: null },
          ],
        },
      },
    });
    vi.mocked(sgMail.send).mockRejectedValue(forbiddenError);

    const result = await sendSessionInviteEmail({
      toEmail: "forbidden@example.com",
      toName: "認証エラーテスト",
      sessionUrl: "https://example.com/session/forbidden",
      scheduledAt: new Date(),
      durationMinutes: 30,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("403");
    expect(result.error).toContain("verified Sender Identity");
  });
});
