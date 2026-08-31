import Link from "next/link";
import type { PlayerRecord, Rivalry } from "@/lib/services/stats";
import { Avatar } from "./Avatar";

/**
 * A member's record and their rivalries.
 *
 * No rating and no ladder: a rating is phase 4 and comes from Stockfish's view
 * of how well somebody played, which is a different question from who won.
 * These panels only report results.
 *
 * The record is on every card. The rivalries are only on your own — "who keeps
 * beating me" is a useful thing to know about yourself and an unkind thing to
 * know about somebody else.
 */

export function RecordPanel({
  record,
  empty,
}: {
  record: PlayerRecord;
  empty: string;
}) {
  if (record.played === 0) {
    return <p className="text-sm text-ink-soft">{empty}</p>;
  }

  return (
    <div className="sheet flex divide-x divide-rule">
      <Figure label="played" value={record.played} />
      <Figure label="won" value={record.wins} accent />
      <Figure label="lost" value={record.losses} />
      <Figure label="drawn" value={record.draws} />
    </div>
  );
}

function Figure({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex-1 px-3 py-3 text-center">
      <p
        className={`masthead text-2xl ${accent && value > 0 ? "text-brass" : ""}`}
      >
        {value}
      </p>
      <p className="eyebrow mt-1">{label}</p>
    </div>
  );
}

export function RivalryPanel({
  rivalries,
  mostPlayed,
  nemesis,
}: {
  rivalries: Rivalry[];
  mostPlayed: Rivalry | null;
  nemesis: Rivalry | null;
}) {
  if (rivalries.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        Play somebody a few times and this fills in.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {mostPlayed && (
          <Callout label="Play the most">
            <Name rivalry={mostPlayed} /> — {games(mostPlayed.played)}.
          </Callout>
        )}

        {nemesis ? (
          <Callout label="Keeps beating you">
            <Name rivalry={nemesis} /> — {nemesis.losses} of{" "}
            {games(nemesis.played)} to them. Worth working out what they do.
          </Callout>
        ) : (
          <Callout label="Keeps beating you">
            Nobody, so far.
          </Callout>
        )}
      </div>

      <div className="sheet ruled mt-4">
        {rivalries.map((rivalry) => (
          <div
            key={rivalry.opponent.id}
            className="flex items-center gap-3 px-3 py-2"
          >
            <Avatar
              avatar={rivalry.opponent.avatar}
              role={rivalry.opponent.role}
              size="sm"
            />
            <Link
              href={`/profile/${rivalry.opponent.username}`}
              className="min-w-0 flex-1 truncate text-sm hover:underline"
            >
              {rivalry.opponent.username}
            </Link>
            <span className="whitespace-nowrap font-mono text-[0.65rem] text-ink-soft">
              {rivalry.wins}W {rivalry.losses}L {rivalry.draws}D
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function Callout({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <p className="border-l-2 border-brass pl-3 text-sm">
      <span className="eyebrow block">{label}</span>
      {children}
    </p>
  );
}

function Name({ rivalry }: { rivalry: Rivalry }) {
  return (
    <Link
      href={`/profile/${rivalry.opponent.username}`}
      className="font-mono hover:underline"
    >
      @{rivalry.opponent.username}
    </Link>
  );
}

const games = (n: number) => `${n} game${n === 1 ? "" : "s"}`;
