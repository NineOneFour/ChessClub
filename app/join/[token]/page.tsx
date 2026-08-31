import Link from "next/link";
import * as invitations from "@/lib/services/invitations";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { JoinForm } from "./JoinForm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Join the club" };

export default async function JoinPage({ params }: PageProps<"/join/[token]">) {
  const { token } = await params;
  const invite = await invitations.findUsable(token);

  if (!invite) {
    return (
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
        <h1 className="masthead text-3xl">This link is no longer good</h1>
        <p className="mt-4 text-sm text-ink-soft">
          Invitation links are single use and expire after a couple of weeks.
          Ask whoever sent it to make you a fresh one.
        </p>
        <Link href="/login" className="btn btn-quiet mt-6 self-start">
          Sign in instead
        </Link>
      </div>
    );
  }

  const familyLabel = invite.existingFamilyName ?? invite.familyName;

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <span className="stamp mb-6 self-start">Invitation</span>

      <h1 className="masthead text-3xl">
        Set up the {familyLabel} account
      </h1>
      <p className="mt-3 text-sm text-ink-soft">
        This creates your parent account. Once you&apos;re in, you add a login
        for each of your children — they don&apos;t need email addresses.
      </p>

      <JoinForm token={token} minPasswordLength={MIN_PASSWORD_LENGTH} />
    </div>
  );
}
