import {
	PRIMARY_LOCAL_DATA_ENCRYPTION_SECRET,
	deriveLocalDataKey,
	resolveLocalDataEncryptionRoot,
} from "./src/localDataKey";

let failed = 0;
const check = (label: string, condition: boolean) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label}`);
	}
};

const primaryLocal = resolveLocalDataEncryptionRoot({
	configuredSecret: "temporary-ui-audit-secret-that-must-not-touch-safari-cache",
	nodeEnv: "development",
	apiPort: 8787,
	authUrl: "http://localhost:8787",
	webOrigins: ["http://localhost:5173"],
});
check(
	"primární localhost ignoruje dočasný auditní secret",
	primaryLocal === PRIMARY_LOCAL_DATA_ENCRYPTION_SECRET,
);

const fallbackVitePort = resolveLocalDataEncryptionRoot({
	configuredSecret: "another-temporary-ui-audit-secret",
	nodeEnv: "development",
	apiPort: 8787,
	authUrl: "http://127.0.0.1:8787",
	webOrigins: ["http://127.0.0.1:5180"],
});
check(
	"lokální Vite fallback port používá stejný stabilní kořen",
	fallbackVitePort === PRIMARY_LOCAL_DATA_ENCRYPTION_SECRET,
);

const isolatedTest = resolveLocalDataEncryptionRoot({
	configuredSecret: "isolated-ci-secret",
	nodeEnv: "test",
	apiPort: 8790,
	authUrl: "http://127.0.0.1:8790",
	webOrigins: ["http://localhost:5173"],
});
check("izolovaný testovací port respektuje vlastní secret", isolatedTest === "isolated-ci-secret");

const production = resolveLocalDataEncryptionRoot({
	configuredSecret: "production-secret",
	nodeEnv: "production",
	apiPort: 8787,
	authUrl: "https://api.watson.example",
	webOrigins: ["https://watson.example"],
});
check("produkce respektuje povinný secret z prostředí", production === "production-secret");

const firstUserKey = deriveLocalDataKey(primaryLocal, "user-a");
const repeatedFirstUserKey = deriveLocalDataKey(primaryLocal, ["user", "a"].join("-"));
check("per-user klíč je deterministický", firstUserKey === repeatedFirstUserKey);
check(
	"dva uživatelé nedostanou stejný klíč",
	firstUserKey !== deriveLocalDataKey(primaryLocal, "user-b"),
);

if (failed > 0) {
	console.error(`\nLocal data key policy: ${failed} kontrol selhalo`);
	process.exit(1);
}
console.log("\nLocal data key policy: všechny kontroly prošly");
