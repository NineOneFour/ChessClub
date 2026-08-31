import { Avatar, GrownUpTag } from "./Avatar";

/**
 * The top of a member card: who this is, which family, and whether they are
 * here. Shared so that your own card and the one somebody else sees when they
 * click your name are the same card — yours simply carries more underneath it.
 *
 * `realName` is passed already resolved rather than decided here: whether it
 * may be shown is an authorization question, answered on the server by
 * `canSeeRealName`. The public card passes nothing — it shows no real names at
 * all, to anybody.
 */
export function MemberHeader({
  username,
  realName = null,
  familyName,
  avatar,
  role,
  online,
  lastSeenAt,
}: {
  username: string;
  realName?: string | null;
  familyName: string | null;
  avatar: string;
  role: string;
  online: boolean;
  lastSeenAt: Date | null;
}) {
  return (
    <div className="sheet flex items-start gap-5 p-6">
      <Avatar avatar={avatar} role={role} size="lg" online={online} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="masthead text-3xl">@{username}</h1>
          <GrownUpTag role={role} />
        </div>
        {realName && <p className="mt-1 text-sm">{realName}</p>}
        <p className="mt-1 font-mono text-xs text-ink-soft">
          {familyName ?? ""}
        </p>
        <p className="mt-3 text-sm text-ink-soft">
          {online
            ? "In the room right now."
            : lastSeenAt
              ? `Last here ${lastSeenAt.toLocaleDateString()}.`
              : "Hasn't been in yet."}
        </p>
      </div>
    </div>
  );
}
