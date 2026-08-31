import { requireAdmin } from "@/lib/auth/guards";
import { CLUB_CHANNEL } from "@/lib/db/schema";
import * as audit from "@/lib/services/audit";
import * as chat from "@/lib/services/chat";
import * as invitations from "@/lib/services/invitations";
import * as users from "@/lib/services/users";
import { Avatar } from "@/app/components/Avatar";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";
import {
  DeleteMessageButton,
  InviteForm,
  MyFamilyForm,
  RevokeInviteButton,
  UserControls,
} from "./AdminControls";

export const dynamic = "force-dynamic";

export const metadata = { title: "The club" };

/**
 * One administrator page rather than a settings tree. At five families
 * everything fits on a single sheet, and the whole state of the club being
 * visible at once is worth more than tidy separation.
 */
export default async function AdminPage() {
  const admin = await requireAdmin();

  const [roster, invites, families, transcript, activity] = await Promise.all([
    users.listAll(),
    invitations.listAll(),
    users.listFamilies(),
    chat.listForReview({ channel: CLUB_CHANNEL, limit: 200 }),
    audit.listRecent(60),
  ]);

  const pending = invites.filter((invite) => invite.status === "open");

  return (
    <Shell user={admin} stamp="Club secretary">
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-10">
          <section>
            <SectionHeading label="Everyone" count={`${roster.length}`} />
            <div className="sheet ruled">
              {roster.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-wrap items-start justify-between gap-4 px-4 py-3"
                >
                  <div className="flex items-start gap-3">
                    <Avatar avatar={member.avatar} role={member.role} size="sm" />
                    <div>
                      <p className="text-sm font-semibold">
                        {member.displayName}{" "}
                        <span className="font-mono text-[0.65rem] font-normal text-ink-soft">
                          @{member.username} · {member.role}
                          {member.familyName ? ` · ${member.familyName}` : ""}
                        </span>
                      </p>
                      <ul className="mt-1 flex flex-wrap gap-x-4 font-mono text-[0.65rem] text-ink-soft">
                        <li className={member.isActive ? "" : "text-stamp"}>
                          {member.isActive ? "active" : "disabled"}
                        </li>
                        {member.isMuted && <li className="text-stamp">muted</li>}
                        {!member.chatEnabled && <li>chat off by parent</li>}
                        <li>
                          joined {member.createdAt.toLocaleDateString()}
                        </li>
                      </ul>
                    </div>
                  </div>
                  <UserControls user={member} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <SectionHeading
              label="Club chat"
              count={`${transcript.length} messages`}
            />
            {transcript.length === 0 ? (
              <p className="text-sm text-ink-soft">Nothing said yet.</p>
            ) : (
              <div className="sheet ruled max-h-[30rem] overflow-y-auto">
                {transcript.map((message) => (
                  <article
                    key={message.id}
                    className="flex items-start justify-between gap-4 px-3 py-2"
                  >
                    <div className="flex min-w-0 gap-3">
                      <time
                        dateTime={message.createdAt.toISOString()}
                        className="gutter min-w-[6.5rem] text-left"
                      >
                        {message.createdAt.toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <div className="min-w-0">
                        <span className="text-sm font-semibold">
                          {message.displayName}
                        </span>
                        <p
                          className={`whitespace-pre-wrap break-words text-[0.95rem] leading-snug ${
                            message.deletedAt ? "text-ink-soft line-through" : ""
                          }`}
                        >
                          {message.body}
                        </p>
                      </div>
                    </div>
                    {!message.deletedAt && (
                      <DeleteMessageButton messageId={message.id} />
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          <section>
            <SectionHeading label="Activity log" count={`${activity.length}`} />
            <div className="sheet ruled max-h-[24rem] overflow-y-auto">
              {activity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex gap-3 px-3 py-1.5 font-mono text-[0.7rem]"
                >
                  <time
                    dateTime={entry.createdAt.toISOString()}
                    className="gutter min-w-[6.5rem] text-left"
                  >
                    {entry.createdAt.toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <span className="text-ink">
                    {entry.actorName ?? "system"} · {entry.action}
                    {entry.targetId ? ` · ${entry.targetType}#${entry.targetId}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside className="space-y-10">
          <section>
            <SectionHeading label="My family" />
            <MyFamilyForm
              families={families}
              currentFamilyId={admin.familyId}
            />
          </section>

          <section>
            <SectionHeading label="Invite a family" />
            <InviteForm families={families} />
          </section>

          <section>
            <SectionHeading
              label="Open invitations"
              count={`${pending.length}`}
            />
            {invites.length === 0 ? (
              <p className="text-sm text-ink-soft">
                None yet. Every account starts with a link from here.
              </p>
            ) : (
              <ul className="space-y-3">
                {invites.map((invite) => {
                  const status =
                    invite.status === "accepted"
                      ? `accepted by ${invite.acceptedByName ?? "someone"}`
                      : invite.status === "open"
                        ? `open until ${invite.expiresAt.toLocaleDateString()}`
                        : invite.status;

                  return (
                    <li key={invite.id} className="sheet p-4">
                      <p className="text-sm font-semibold">
                        {invite.existingFamilyName ?? invite.familyName}
                      </p>
                      <p className="font-mono text-[0.65rem] text-ink-soft">
                        {status}
                      </p>
                      {invite.note && (
                        <p className="mt-1 text-xs text-ink-soft">
                          {invite.note}
                        </p>
                      )}
                      {invite.status === "open" && (
                        <div className="mt-2">
                          <RevokeInviteButton invitationId={invite.id} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </Shell>
  );
}
