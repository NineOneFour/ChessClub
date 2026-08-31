import "dotenv/config";
import { client } from "../lib/db";
import { CLUB_CHANNEL } from "../lib/db/schema";
import * as chat from "../lib/services/chat";
import * as presence from "../lib/services/presence";
import * as users from "../lib/services/users";

/**
 * Fill a development database with a plausible club: two families, four kids,
 * and a short conversation. Development only — never run against real data.
 */
async function main() {
  const kids: number[] = [];

  for (const [family, names] of [
    ["The Velivasakis", ["Ellie", "Max"]],
    ["The Okonkwos", ["Ada", "Bruno"]],
  ] as const) {
    const familyId = await users.createFamily(family);
    await users.create({
      username: family.split(" ")[1].toLowerCase(),
      displayName: `${family.split(" ")[1]} parent`,
      password: "chessclub-dev",
      role: "parent",
      familyId,
      actorId: null,
    });
    for (const name of names) {
      kids.push(
        await users.create({
          username: name.toLowerCase(),
          displayName: name,
          password: "chessclub-dev",
          role: "child",
          familyId,
          avatar: name === "Ellie" ? "fox" : name === "Max" ? "dragon" : "cat",
          actorId: null,
        }),
      );
    }
  }

  const script: [number, string][] = [
    [0, "im in"],
    [1, "hi ellie"],
    [0, "anyone up for a game before dinner"],
    [2, "me!! but im rubbish at the opening"],
    [1, "youre not rubbish you just always play the same one"],
    [2, "its a GOOD one"],
    [3, "i beat max yesterday btw"],
    [1, "one time. ONE TIME"],
  ];
  for (const [index, body] of script) {
    await chat.post({ channel: CLUB_CHANNEL, userId: kids[index], body });
  }

  await presence.setConnections(kids[0], 1);
  await presence.setConnections(kids[1], 1);
  console.log("fixture loaded");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
