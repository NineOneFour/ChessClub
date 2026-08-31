import Link from "next/link";
import { requireParent } from "@/lib/auth/guards";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { CLUB_CHANNEL } from "@/lib/db/schema";
import * as chat from "@/lib/services/chat";
import * as users from "@/lib/services/users";
import { Avatar } from "@/app/components/Avatar";
import { SectionHeading } from "@/app/components/SectionHeading";
import { Shell } from "@/app/components/Shell";
import { AddChildForm } from "./AddChildForm";
import { ChildControls } from "./ChildControls";

export const dynamic = "force-dynamic";

export const metadata = { title: "My family" };

/**
 * One page per family: the children, the switches over each of them, and what
 * they've been saying. Everything a parent needs is here rather than spread
 * over a settings tree.
 */
export default async function ParentPage() {
  const parent = await requireParent();

  if (parent.familyId === null) {
    return (
      <Shell user={parent} stamp="Administrator">
        <p className="max-w-prose text-sm text-ink-soft">
          You&apos;re not in a family yet, so there are no children to manage
          here. Join or create one under{" "}
          <Link href="/admin" className="underline">
            the club
          </Link>{" "}
          and your own children will appear on this page.
        </p>
      </Shell>
    );
  }

  const children = await users.listChildrenOfFamily(parent.familyId);
  const childIds = new Set(children.map((child) => child.id));
  const transcript = await chat.listForReview({
    channel: CLUB_CHANNEL,
    limit: 300,
  });
  const theirs = transcript.filter((message) => childIds.has(message.userId));

  return (
    <Shell user={parent} stamp={parent.familyName ?? "My family"}>
      <div className="grid gap-10 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-10">
          <section>
            <SectionHeading
              label="My children"
              count={`${children.length}`}
            />
            {children.length === 0 ? (
              <p className="text-sm text-ink-soft">
                No logins yet. Add one for each child using the form on the
                right — they don&apos;t need an email address.
              </p>
            ) : (
              <ul className="space-y-4">
                {children.map((child) => (
                  <li key={child.id} className="sheet p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-4">
                        <Avatar avatar={child.avatar} size="md" />
                        <div>
                          <h3 className="masthead text-xl">
                            {child.realName}
                          </h3>
                          <p className="font-mono text-xs text-ink-soft">
                            @{child.username}
                          </p>
                          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[0.65rem] text-ink-soft">
                            <li>
                              chat{" "}
                              <span
                                className={
                                  child.chatEnabled ? "text-live" : "text-stamp"
                                }
                              >
                                {child.chatEnabled ? "on" : "off"}
                              </span>
                            </li>
                            <li>
                              account{" "}
                              <span
                                className={
                                  child.isActive ? "text-live" : "text-stamp"
                                }
                              >
                                {child.isActive ? "active" : "suspended"}
                              </span>
                            </li>
                            <li>
                              last here{" "}
                              {child.lastSeenAt
                                ? child.lastSeenAt.toLocaleDateString()
                                : "never"}
                            </li>
                          </ul>
                        </div>
                      </div>
                      <Link
                        href={`/profile/${child.username}`}
                        className="eyebrow whitespace-nowrap hover:text-ink"
                      >
                        Their card
                      </Link>
                    </div>

                    <div className="mt-5 border-t border-rule pt-4">
                      <ChildControls
                        child={child}
                        minPasswordLength={MIN_PASSWORD_LENGTH}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading
              label="What they've said"
              count={`${theirs.length} messages`}
            />
            {theirs.length === 0 ? (
              <p className="text-sm text-ink-soft">
                Nothing in the clubhouse from your children yet.
              </p>
            ) : (
              <div className="sheet ruled max-h-[30rem] overflow-y-auto">
                {theirs.map((message) => (
                  <article key={message.id} className="flex gap-3 px-3 py-2">
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
                        {message.username}
                      </span>
                      <p
                        className={`whitespace-pre-wrap break-words text-[0.95rem] leading-snug ${
                          message.deletedAt ? "text-ink-soft line-through" : ""
                        }`}
                      >
                        {message.body}
                      </p>
                      {message.deletedAt && (
                        <p className="font-mono text-[0.65rem] text-stamp">
                          removed by the administrator
                        </p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside>
          <SectionHeading label="Add a child" />
          <AddChildForm minPasswordLength={MIN_PASSWORD_LENGTH} />
        </aside>
      </div>
    </Shell>
  );
}
