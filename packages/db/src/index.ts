import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

/** Re-export běžných Drizzle operátorů, ať apps nezávisí přímo na drizzle-orm. */
export {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	or,
	sql,
} from "drizzle-orm";
export * from "./schema/index";
export { schema };

let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/** Líně vytvořené DB připojení (postgres-js + Drizzle). */
export function getDb(connectionString = process.env.DATABASE_URL) {
	if (!connectionString) {
		throw new Error(
			"DATABASE_URL není nastavená — zkopíruj .env.example do .env.",
		);
	}
	if (!_db) {
		const client = postgres(connectionString, { max: 10 });
		_db = drizzle(client, { schema, casing: "snake_case" });
	}
	return _db;
}

export type Database = ReturnType<typeof getDb>;
