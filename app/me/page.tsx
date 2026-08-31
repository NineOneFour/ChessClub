import { requireUser } from "@/lib/auth/guards";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";
import { PasswordForm, ProfileForm } from "./MyCardForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "My card" };

export default async function MyCardPage() {
  const me = await requireUser();

  return (
    <Shell user={me} stamp="Your card">
      <div className="grid max-w-3xl gap-8 md:grid-cols-2">
        <section>
          <SectionHeading label="How you look" />
          <ProfileForm displayName={me.displayName} avatar={me.avatar} />
          <p className="mt-3 text-xs text-ink-soft">
            Your username is{" "}
            <span className="font-mono">@{me.username}</span>. That one
            can&apos;t change — ask the club administrator if you need it
            different.
          </p>
        </section>

        <section>
          <SectionHeading label="Password" />
          <PasswordForm minLength={MIN_PASSWORD_LENGTH} />
        </section>
      </div>
    </Shell>
  );
}
