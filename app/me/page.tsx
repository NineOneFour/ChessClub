import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import * as users from "@/lib/services/users";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";
import { BoardForm, PasswordForm, ProfileForm } from "./SettingsForms";

export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

/**
 * Settings, and only settings: the things a member changes about themselves.
 * How they are playing is `/card`, and what the club sees is their profile.
 *
 * The username is editable here; the real name is not. A child picking their
 * own name in the club is most of the fun of having one, but the real name is
 * how a parent knows which child they are looking at on the family page.
 *
 * A parent may switch off choosing your own name and avatar. The board and the
 * pieces are never switched off — nobody else sees those.
 */
export default async function SettingsPage() {
  const me = await requireUser();

  const record = await users.getById(me.id);
  if (!record) notFound();

  return (
    <Shell user={me} stamp="Settings">
      <div className="grid max-w-3xl gap-8 md:grid-cols-2">
        <section>
          <SectionHeading label="How you look" />
          <ProfileForm
            username={record.username}
            avatar={record.avatar}
            canCustomize={record.canCustomize}
          />
          <p className="mt-3 text-xs text-ink-soft">
            The grown-ups in your family know you as{" "}
            <span className="font-mono">{record.realName}</span>, and that one
            stays as it is — ask them if it needs changing.
          </p>
        </section>

        <section>
          <SectionHeading label="Password" />
          <PasswordForm minLength={MIN_PASSWORD_LENGTH} />
        </section>

        <section className="md:col-span-2">
          <SectionHeading label="Your board" />
          <BoardForm
            boardStyle={record.boardStyle}
            pieceSet={record.pieceSet}
          />
          <p className="mt-3 text-xs text-ink-soft">
            Only you see this. Everybody sits at their own board.
          </p>
        </section>
      </div>
    </Shell>
  );
}
