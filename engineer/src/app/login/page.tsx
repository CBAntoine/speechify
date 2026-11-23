import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";

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
        <h1>Engineer</h1>
        <p className="muted">Sign in to talk to your security engineer.</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
