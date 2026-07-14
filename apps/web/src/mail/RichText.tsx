/**
 * Sdílený rich-text editor mailového composeru — jeden vzhled i chování VŠUDE
 * (Nová zpráva, odpověď ve vlákně, peek). Formátování: tučně / kurzíva / podtržení /
 * odrážky / odkaz / BARVA textu. Hodnota = HTML řetězec (onChange). contentEditable
 * + document.execCommand (jako dřívější RTE ve vlákně) — držené v demo rozsahu.
 *
 * `ref` vystavuje `insertText(text)` pro vkládání šablon na kurzor (parita s dřívějším
 * chováním). „Cursor jump" fix: innerHTML se přepíše jen když se liší od naposledy
 * vyslané hodnoty (jinak by psaní resetovalo kurzor).
 */
import {
	forwardRef,
	type CSSProperties,
	useEffect,
	useImperativeHandle,
	useRef,
	useState,
} from "react";
import { TEXT_COLORS } from "./colors";

export interface RichTextHandle {
	insertText: (text: string) => void;
	focus: () => void;
}

const COLORS = TEXT_COLORS;

const TBTN: CSSProperties = {
	minWidth: 26,
	height: 26,
	borderRadius: 6,
	border: "1px solid transparent",
	background: "transparent",
	color: "var(--ink-2)",
	cursor: "pointer",
	fontSize: 13,
	fontFamily: "var(--w-font-body)",
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	padding: "0 5px",
};

export const RichText = forwardRef<
	RichTextHandle,
	{
		value: string;
		onChange: (html: string) => void;
		placeholder?: string;
		minHeight?: number;
	}
>(function RichText({ value, onChange, placeholder, minHeight = 150 }, ref) {
	const elRef = useRef<HTMLDivElement>(null);
	const lastHtml = useRef<string>(value);
	const [colorOpen, setColorOpen] = useState(false);

	useImperativeHandle(ref, () => ({
		insertText(text: string) {
			const el = elRef.current;
			if (!el) return;
			el.focus();
			// Vlož jako text (zachová řádky) na aktuální kurzor.
			document.execCommand("insertText", false, text);
			lastHtml.current = el.innerHTML;
			onChange(el.innerHTML);
		},
		focus() {
			elRef.current?.focus();
		},
	}));

	// Přepiš innerHTML jen při vnější změně (ne při psaní) — jinak skáče kurzor.
	// biome-ignore lint/correctness/useExhaustiveDependencies: řízeno lastHtml, ne onChange
	useEffect(() => {
		const el = elRef.current;
		if (el && value !== lastHtml.current) {
			el.innerHTML = value;
			lastHtml.current = value;
		}
	}, [value]);

	function emit() {
		const el = elRef.current;
		if (!el) return;
		lastHtml.current = el.innerHTML;
		onChange(el.innerHTML);
	}

	/** Formátovací příkaz — nekrade fokus editoru (mousedown preventDefault na toolbaru). */
	function cmd(command: string, val?: string) {
		elRef.current?.focus();
		try {
			// Barva přes CSS span (<span style=color>), ne deprecated <font color>.
			if (command === "foreColor") document.execCommand("styleWithCSS", false, "true");
			document.execCommand(command, false, val);
		} catch {
			/* starší prohlížeč — demo bez formátování */
		}
		emit();
	}

	const isEmpty = !value || value === "<br>" || value.replace(/<[^>]*>/g, "").trim() === "";

	return (
		<div
			style={{
				border: "1px solid var(--line)",
				borderRadius: 12,
				background: "var(--panel-2)",
				overflow: "hidden",
			}}
		>
			{/* toolbar */}
			<div
				// biome-ignore lint/a11y/noStaticElementInteractions: toolbar drží výběr v editoru
				onMouseDown={(e) => e.preventDefault()}
				style={{
					display: "flex",
					alignItems: "center",
					gap: 2,
					padding: "5px 7px",
					borderBottom: "1px solid var(--line)",
					flexWrap: "wrap",
				}}
			>
				<button
					type="button"
					style={{ ...TBTN, fontWeight: 800 }}
					title="Tučně"
					onClick={() => cmd("bold")}
				>
					B
				</button>
				<button
					type="button"
					style={{ ...TBTN, fontStyle: "italic" }}
					title="Kurzíva"
					onClick={() => cmd("italic")}
				>
					I
				</button>
				<button
					type="button"
					style={{ ...TBTN, textDecoration: "underline" }}
					title="Podtržení"
					onClick={() => cmd("underline")}
				>
					U
				</button>
				<span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 3px" }} />
				<button
					type="button"
					style={TBTN}
					title="Odrážky"
					onClick={() => cmd("insertUnorderedList")}
				>
					•
				</button>
				<button
					type="button"
					style={TBTN}
					title="Odkaz"
					onClick={() => {
						const url = window.prompt("Adresa odkazu (URL):", "https://");
						if (url) cmd("createLink", url);
					}}
				>
					↗
				</button>
				<span style={{ width: 1, height: 16, background: "var(--line)", margin: "0 3px" }} />
				{/* barva textu */}
				<div style={{ position: "relative" }}>
					<button
						type="button"
						style={{ ...TBTN, fontWeight: 700 }}
						title="Barva textu"
						onClick={() => setColorOpen((v) => !v)}
					>
						A<span style={{ fontSize: 8, marginLeft: 1 }}>▾</span>
					</button>
					{colorOpen && (
						<div
							style={{
								position: "absolute",
								top: 30,
								left: 0,
								zIndex: 60,
								display: "flex",
								gap: 5,
								padding: 7,
								background: "var(--panel)",
								border: "1px solid var(--line)",
								borderRadius: 10,
								boxShadow: "var(--shadow)",
							}}
						>
							{COLORS.map((c) => (
								<button
									key={c.css}
									type="button"
									title={c.label}
									onClick={() => {
										cmd("foreColor", c.css);
										setColorOpen(false);
									}}
									style={{
										width: 18,
										height: 18,
										borderRadius: "50%",
										border: "1px solid var(--line)",
										background: c.css,
										cursor: "pointer",
										flex: "none",
									}}
								/>
							))}
						</div>
					)}
				</div>
			</div>

			{/* editor */}
			<div style={{ position: "relative" }}>
				{isEmpty && placeholder && (
					<div
						style={{
							position: "absolute",
							top: 11,
							left: 13,
							color: "var(--ink-3)",
							fontFamily: "var(--w-font-body)",
							fontSize: 13.5,
							pointerEvents: "none",
						}}
					>
						{placeholder}
					</div>
				)}
				<div
					ref={elRef}
					contentEditable
					role="textbox"
					tabIndex={0}
					aria-multiline="true"
					aria-label={placeholder ?? "Tělo zprávy"}
					data-rte
					onInput={emit}
					onBlur={emit}
					suppressContentEditableWarning
					style={{
						minHeight,
						maxHeight: 380,
						overflow: "auto",
						padding: "11px 13px",
						fontFamily: "var(--w-font-body)",
						fontSize: 13.5,
						lineHeight: 1.55,
						color: "var(--ink)",
						outline: "none",
					}}
				/>
			</div>
		</div>
	);
});
