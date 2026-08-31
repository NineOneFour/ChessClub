import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/guards";
import * as users from "@/lib/services/users";
import { Avatar, GrownUpTag } from "@/app/components/Avatar";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";

export const dynamic = "force-dynamic";

/**
 * A member's card. Everyone in the club plays, so parents and the
 * administrator have one too — tagged, so a kid can see who they're looking
 * at.
 *
 * Deliberately thin in phase 1: there are no games yet, and the rating, recent
 * games and progress panels belong to phases 2-4.
 */
export default async function ProfilePage({
  params,
}: PageProps<"/profile/[username]">) {
  const me = await requireUser();
  const { username } = await params;

  const member = await users.getByUsername(username);
  if (!member || !member.isActive) notFound();

  const online = await users
    .listClubMembers()
    .then((list) => list.find((m) => m.id === member.id)?.isOnline ?? false);

  return (
    <Shell user={me} stamp="Member card">
      <div className="max-w-xl">
        <div className="sheet flex items-start gap-5 p-6">
          <Avatar
            avatar={member.avatar}
            role={member.role}
            size="lg"
            online={online}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="masthead text-3xl">{member.displayName}</h1>
              <GrownUpTag role={member.role} />
            </div>
            <p className="mt-1 font-mono text-xs text-ink-soft">
              @{member.username}
              {member.familyName ? ` · ${member.familyName}` : ""}
            </p>
            <p className="mt-3 text-sm text-ink-soft">
              {online
                ? "In the room right now."
                : member.lastSeenAt
                  ? `Last here ${member.lastSeenAt.toLocaleDateString()}.`
                  : "Hasn't been in yet."}
            </p>
          </div>
        </div>

        <div className="mt-8">
          <SectionHeading label="Chess" />
          <p className="text-sm text-ink-soft">
            No games yet — the boards aren&apos;t open. Playing strength, recent
            games and progress land on this card once chess is in.
          </p>
        </div>
      </div>
    </Shell>
  );
}
