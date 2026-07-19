import {
	detectDelimiter,
	matchSupportingFiles,
	normalizeImportRows,
	parseDelimitedText,
	sha256File,
	suggestMapping,
} from "./importCsv";

let failed = 0;
const check = (label: string, condition: boolean, detail?: unknown) => {
	if (condition) console.log(`  ✓ ${label}`);
	else {
		failed += 1;
		console.error(`  ✗ ${label} — ${JSON.stringify(detail)}`);
	}
};

console.log("(a) RFC 4180 parser a detekce delimiteru");
const csv = parseDelimitedText(
	'\uFEFFTask Name;Notes;Due Date;Labels;Assignee;Task ID;Parent ID;Completed\r\n"Příprava; podkladů";"První řádek\nDruhý ""citovaný""";16.07.2026;práce|škola;Ada@example.test;T-1;;false\r\nPodúkol;;2026-07-17;škola;Neznámý;T-2;T-1;2026-07-16',
);
check("středník se pozná i s delimitery v uvozovkách", csv.delimiter === ";", csv.delimiter);
check("quoted newline a escaped quote zůstanou v buňce", csv.rows[0]?.Notes === 'První řádek\nDruhý "citovaný"', csv.rows[0]);
check("BOM se odstraní", csv.headers[0] === "Task Name", csv.headers);
check("tabulátor je detekovaný", detectDelimiter("Name\tDue\nA\tB") === "\t");

console.log("(b) mapování a normalizace");
const mapping = suggestMapping("asana", csv.headers);
const normalized = normalizeImportRows(csv, mapping, [
	{ id: "11111111-1111-4111-8111-111111111111", name: "Ada Lovelace", email: "ada@example.test" },
]);
check("povinný název se mapuje z Asany", mapping.name === "Task Name", mapping);
check("lokální i ISO datum se normalizuje", normalized.items.map((item) => item.dueDate).join(",") === "2026-07-16,2026-07-17", normalized.items);
check("hierarchie používá původní ID", normalized.items[1]?.parentSourceKey === "T-1", normalized.items[1]);
check("člen se páruje přes e-mail bez ohledu na velikost", normalized.items[0]?.assigneeIds.length === 1, normalized.items[0]);
check("neznámý člen je varování, ne tichá záměna", normalized.warnings.some((issue) => issue.code === "unmatched_assignee"), normalized.warnings);
check("datum dokončení se pozná jako hotovo", normalized.items[1]?.completed === true, normalized.items[1]);
check("validní řádky nemají lokální chybu", normalized.errors.length === 0, normalized.errors);
const byParentName = normalizeImportRows(
	parseDelimitedText("Content,ID,Parent ID,Priority\nRodič,A,,4\nDítě,B,Rodič,1"),
	{ name: "Content", sourceKey: "ID", parentSourceKey: "Parent ID", priority: "Priority" },
	[],
	"todoist",
);
check("rodič z exportu lze dohledat i přes jednoznačný název", byParentName.items[1]?.parentSourceKey === "A", byParentName.items);
check("číselná priorita Todoistu se převede do Watson pořadí", byParentName.items[0]?.priority === 1 && byParentName.items[1]?.priority === 4, byParentName.items);

console.log("(c) ochranné hrany");
const duplicateHeaders = parseDelimitedText("Name,Name\nA,B");
check("duplicitní hlavičky jsou jednoznačné", duplicateHeaders.headers.join("|") === "Name|Name (2)", duplicateHeaders.headers);
let unclosed = false;
try {
	parseDelimitedText('Name\n"bez konce');
} catch (error) {
	unclosed = error instanceof Error && error.message === "csv_unclosed_quote";
}
check("neukončené uvozovky se odmítnou", unclosed);
let extraValue = false;
try {
	parseDelimitedText("Name,Due\nA,2026-07-16,navíc");
} catch (error) {
	extraValue = error instanceof Error && error.message === "csv_too_many_values";
}
check("hodnota bez odpovídající hlavičky se tiše neztratí", extraValue);
const invalid = normalizeImportRows(
	parseDelimitedText("Name,Due,ID\n,31.02.2026,X\nDruhý,nesmysl,X"),
	{ name: "Name", dueDate: "Due", sourceKey: "ID" },
	[],
);
check("prázdný název a neplatná data jsou chyby", invalid.errors.filter((issue) => issue.code === "invalid_date" || issue.code === "required").length === 3, invalid.errors);
check("duplicitní source ID se odhalí před serverem", invalid.errors.some((issue) => issue.code === "duplicate_source_key"), invalid.errors);

console.log("(d) soubory a fingerprint");
const first = new File(["a"], "brief.pdf", { type: "application/pdf" });
const second = new File(["b"], "notes.txt", { type: "text/plain" });
const [firstItem, secondItem] = normalized.items;
if (!firstItem || !secondItem) throw new Error("test_fixture_missing");
const matches = matchSupportingFiles(
	[
		{ ...firstItem, attachmentNames: ["brief.pdf"] },
		{ ...secondItem, attachmentNames: ["missing.docx"] },
	],
	[first, second],
);
check("soubor se přiřadí nejvýše jednou", matches.bySourceKey.get("T-1")?.[0] === first, matches);
check("chybějící a nepoužité soubory jsou explicitní", matches.missing[0] === "missing.docx" && matches.unused[0] === second, matches);
check("fingerprint je stabilní SHA-256", (await sha256File(first)) === (await sha256File(new File(["a"], "jiné.pdf"))), "hash mismatch");

if (failed) {
	console.error(`\nImport CSV testy: ${failed} SELHALO`);
	process.exit(1);
}
console.log("\nImport CSV testy: vše prošlo");
