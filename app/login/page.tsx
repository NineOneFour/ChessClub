import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — The Chess Club" };

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <div className="mb-8">
        <h1 className="masthead text-4xl">The Chess Club</h1>
        <span className="stamp mt-4">Members only</span>
      </div>

      <LoginForm />

      <p className="mt-8 border-t border-rule pt-4 text-sm text-ink-soft">
        No account? This club is invitation only. Ask whoever runs it for a
        link.
      </p>
    </div>
  );
}
