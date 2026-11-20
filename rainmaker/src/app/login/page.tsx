import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { RainMark } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!process.env.APP_PASSWORD) redirect("/");
  const sp = await searchParams;
  const raw = Array.isArray(sp.next) ? sp.next[0] : sp.next;
  const next = raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  return (
    <main className="login">
      <div className="login-card">
        <span className="brand-mark" style={{ width: 52, height: 52, borderRadius: 15 }}>
          <RainMark size={28} />
        </span>
        <h1>Rainmaker</h1>
        <p className="muted">Find clients, run your pipeline and make ads with Claude.</p>
        <LoginForm next={next} />
        <p className="faint small" style={{ marginTop: 18 }}>
          You&apos;ll stay signed in on this device for 6 months.
        </p>
      </div>
    </main>
  );
}
