import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

const lint = spawnSync(
	"pnpm",
	["exec", "biome", "lint", "apps/web/src", "--reporter=json"],
	{ encoding: "utf8", maxBuffer: 20_000_000 },
);
if (!lint.stdout) throw new Error(lint.stderr || "Biome did not return diagnostics");
const report = JSON.parse(lint.stdout);
const categories = new Set([
	"lint/a11y/noStaticElementInteractions",
	"lint/a11y/useKeyWithClickEvents",
]);
const wanted = report.diagnostics.filter(
	(diagnostic) =>
		diagnostic.severity === "warning" && categories.has(diagnostic.category),
);

const byFile = Map.groupBy(wanted, (diagnostic) => diagnostic.location.path);
let changedFiles = 0;
let changedElements = 0;

for (const [path, diagnostics] of byFile) {
	const source = readFileSync(path, "utf8");
	const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const nodesByLine = new Map();
	const visit = (node) => {
		if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
			const nodes = nodesByLine.get(line) ?? [];
			nodes.push(node);
			nodesByLine.set(line, nodes);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	const requested = new Map();
	for (const diagnostic of diagnostics) {
		const line = diagnostic.location.start.line;
		const candidates = nodesByLine.get(line) ?? [];
		const column = diagnostic.location.start.column - 1;
		const lineStart = sourceFile.getPositionOfLineAndCharacter(line - 1, 0);
		const absolute = lineStart + column;
		const node =
			candidates.find((candidate) => candidate.getStart(sourceFile) === absolute) ??
			candidates[0];
		if (!node) throw new Error(`Cannot locate JSX element for ${path}:${line}`);
		const request = requested.get(node) ?? { keyboard: false, role: false };
		if (diagnostic.category.endsWith("useKeyWithClickEvents")) request.keyboard = true;
		if (diagnostic.category.endsWith("noStaticElementInteractions")) request.role = true;
		requested.set(node, request);
	}

	const edits = [];
	for (const [node, request] of requested) {
		const names = new Set(
			node.attributes.properties
				.filter(ts.isJsxAttribute)
				.map((attribute) => attribute.name.getText(sourceFile)),
		);
		// Some legacy mail controls already spread the shared `kb()` helper. Biome
		// cannot infer attributes hidden in a spread, but duplicating them is invalid.
		const hasKeyboardSpread = node.attributes.properties.some(
			(property) =>
				ts.isJsxSpreadAttribute(property) &&
				ts.isCallExpression(property.expression) &&
				property.expression.expression.getText(sourceFile) === "kb",
		);
		if (hasKeyboardSpread) {
			names.add("role");
			names.add("tabIndex");
			names.add("onKeyDown");
		}
		const hasClick = names.has("onClick") || names.has("onDoubleClick");
		const additions = [];
		if (request.role && !names.has("role")) {
			additions.push(`role="${hasClick ? "button" : "region"}"`);
		}
		if ((request.keyboard || hasClick) && !names.has("tabIndex")) {
			additions.push("tabIndex={0}");
		}
		if (request.keyboard && !names.has("onKeyDown") && !names.has("onKeyUp")) {
			additions.push(
				'onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.currentTarget.click(); } }}',
			);
		}
		if (additions.length > 0) {
			edits.push({ position: node.tagName.end, text: ` ${additions.join(" ")}` });
			changedElements += 1;
		}
	}

	if (edits.length > 0) {
		let next = source;
		for (const edit of edits.sort((left, right) => right.position - left.position)) {
			next = `${next.slice(0, edit.position)}${edit.text}${next.slice(edit.position)}`;
		}
		writeFileSync(path, next);
		changedFiles += 1;
	}
}

console.log(`Updated ${changedElements} interactive elements in ${changedFiles} files.`);
