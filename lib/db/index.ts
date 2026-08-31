import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { DATABASE_URL } from "../config";

export const client = postgres(DATABASE_URL(), { max: 10 });
export const db = drizzle(client, { schema });
