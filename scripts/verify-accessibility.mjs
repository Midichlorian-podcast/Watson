import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const root = process.cwd();
const sourceRoots = [join(root, "apps/web/src"), join(root, "packages/ui/src")];
const files = [];
const walk = (path) => {
	for (const name of readdirSync(path)) {
		const child = join(path, name);
		if (statSync(child).isDirectory()) walk(child);
		else if (child.endsWith(".tsx")) files.push(child);
	}
};
for (const sourceRoot of sourceRoots) walk(sourceRoot);

const failures = [];
const nativeInteractive = new Set(["button", "input", "select", "textarea", "summary"]);

for (const path of files) {
	const source = readFileSync(path, "utf8");
	const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	const fail = (node, message) => {
		const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
		failures.push(`${relative(root, path)}:${line + 1}:${character + 1} ${message}`);
	};
	const visit = (node) => {
		if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
			const tag = node.tagName.getText(sourceFile);
			if (/^[a-z]/.test(tag)) {
				const attributes = new Map();
				for (const property of node.attributes.properties) {
					if (ts.isJsxAttribute(property)) {
						attributes.set(property.name.getText(sourceFile), property);
					}
				}

				if (tag === "svg") {
					const hidden = attributes.has("aria-hidden");
					const named = attributes.has("aria-label") || attributes.has("aria-labelledby");
					const role = attributes.get("role")?.initializer?.getText(sourceFile) ?? "";
					const parent = node.parent;
					const hasTitle =
						ts.isJsxElement(parent) &&
						parent.children.some(
							(child) => ts.isJsxElement(child) && child.openingElement.tagName.getText(sourceFile) === "title",
						);
					if (!hidden && !(named && role.includes("img")) && !hasTitle) {
						fail(node, "SVG musí být aria-hidden, nebo mít přístupný název a roli img.");
					}
					if (hidden && (attributes.has("tabIndex") || attributes.has("focusable"))) {
						fail(node, "Dekorativní aria-hidden SVG nesmí být fokusovatelné.");
					}
				}

				const click = attributes.has("onClick") || attributes.has("onDoubleClick");
				const isAnchor = tag === "a" && attributes.has("href");
				if (click && !nativeInteractive.has(tag) && !isAnchor) {
					if (!attributes.has("role")) fail(node, "Statická klikací plocha nemá explicitní ARIA roli.");
					if (!attributes.has("tabIndex")) fail(node, "Statická klikací plocha není ve focus pořadí.");
					if (!attributes.has("onKeyDown") && !attributes.has("onKeyUp")) {
						fail(node, "Statická klikací plocha nemá obsluhu Enter/Space.");
					}
				}

				const roleText = attributes.get("role")?.initializer?.getText(sourceFile) ?? "";
				if (roleText.includes("button") && !nativeInteractive.has(tag)) {
					if (!attributes.has("tabIndex")) fail(node, "Prvek s rolí button není fokusovatelný.");
					if (!attributes.has("onKeyDown") && !attributes.has("onKeyUp")) {
						fail(node, "Prvek s rolí button nemá klávesovou aktivaci.");
					}
				}

				if (attributes.has("autoFocus")) fail(node, "autoFocus je zakázán; fokus musí řídit focus-trap/ref efekt.");
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
}

if (failures.length > 0) {
	console.error(`Accessibility contract failed (${failures.length}):\n${failures.join("\n")}`);
	process.exit(1);
}
console.log(`Accessibility contract: ${files.length} TSX files passed.`);
