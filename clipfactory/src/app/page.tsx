import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function Page({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  // Google sends the YouTube login back to the bare origin (the loopback
  // redirect URI); hand it to the route that finishes the login.
  if (one("state") && (one("code") || one("error"))) {
    const q = new URLSearchParams();
    for (const k of ["code", "state", "error", "scope"]) {
      const v = one(k);
      if (v) q.set(k, v);
    }
    redirect(`/api/youtube/callback?${q}`);
  }
  return <Dashboard />;
}
