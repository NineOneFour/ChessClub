import "dotenv/config";
import { client, db } from "../lib/db";
import { users, usernameEquals } from "../lib/db/schema";
import * as usersService from "../lib/services/users";
import { normalizeUsername } from "../lib/validation";

/**
 * Create (or re-point) the administrator account.
 *
 * This is the only way the first account comes into existence — there is no
 * public signup route anywhere in the app. Run it once after migrating:
 *
 *   ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run seed:admin
 *
 * Running it again with an existing username resets that account's password,
 * which is also the recovery path if the admin password is lost.
 */
async function main() {
  const username = normalizeUsername(process.env.ADMIN_USERNAME);
  const password = process.env.ADMIN_PASSWORD;
  const realName = process.env.ADMIN_REAL_NAME ?? "Administrator";

  if (!password) {
    throw new Error("Set ADMIN_PASSWORD before running seed:admin.");
  }

  const existing = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(usernameEquals(username))
    .limit(1);

  if (existing.length) {
    const row = existing[0];
    if (row.role !== "admin") {
      throw new Error(
        `"${username}" already exists and is not an administrator. Pick another username.`,
      );
    }
    await usersService.setPassword(row.id, password, row.id);
    console.log(`Reset the password for administrator "${username}".`);
  } else {
    await usersService.create({
      username,
      realName,
      password,
      role: "admin",
      familyId: null,
      avatar: "king",
      actorId: null,
    });
    console.log(`Created administrator "${username}".`);
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
