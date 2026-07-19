import { useTranslation } from "@watson/i18n";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	insertMentionToken,
	mentionMatchAt,
	selectedMentionIds,
} from "../lib/commentMentions";

type ComposerMember = { id: string; name: string };

export function CommentComposer({
	value,
	onChange,
	members,
	placeholder,
	submitLabel,
	onSubmit,
	onCancel,
	autoFocus = false,
}: {
	value: string;
	onChange: (value: string) => void;
	members: ComposerMember[];
	placeholder: string;
	submitLabel: string;
	onSubmit: (body: string, mentionUserIds: string[]) => Promise<void> | void;
	onCancel?: () => void;
	autoFocus?: boolean;
}) {
	const { t } = useTranslation();
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const [cursor, setCursor] = useState(value.length);
	const [selected, setSelected] = useState<Set<string>>(() => new Set());
	const [busy, setBusy] = useState(false);
	const match = mentionMatchAt(value, cursor);
	const suggestions = useMemo(() => {
		if (!match) return [];
		const query = match.query.toLocaleLowerCase();
		return members
			.filter((member) => !query || member.name.toLocaleLowerCase().includes(query))
			.slice(0, 5);
	}, [match, members]);

	useEffect(() => {
		if (!value) setSelected(new Set());
	}, [value]);
	useEffect(() => {
		if (autoFocus) inputRef.current?.focus();
	}, [autoFocus]);

	const choose = (member: ComposerMember) => {
		if (!match) return;
		const inserted = insertMentionToken(value, match, member.name);
		onChange(inserted.value);
		setSelected((current) => new Set(current).add(member.id));
		setCursor(inserted.cursor);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.setSelectionRange(inserted.cursor, inserted.cursor);
		});
	};

	const submit = async () => {
		const body = value.trim();
		if (!body || busy) return;
		setBusy(true);
		try {
			await onSubmit(body, selectedMentionIds(body, selected, members));
		} finally {
			setBusy(false);
		}
	};

	const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Enter" && suggestions[0] && !event.shiftKey) {
			event.preventDefault();
			choose(suggestions[0]);
			return;
		}
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void submit();
		}
	};

	return (
		<div className="relative">
			<textarea
				ref={inputRef}
				rows={2}
				value={value}
				onChange={(event) => {
					onChange(event.target.value);
					setCursor(event.target.selectionStart);
				}}
				onClick={(event) => setCursor(event.currentTarget.selectionStart)}
				onKeyUp={(event) => setCursor(event.currentTarget.selectionStart)}
				onKeyDown={keyDown}
				placeholder={placeholder}
				className="min-h-[58px] w-full resize-y rounded-lg border border-line bg-panel-2 px-3 py-2 font-body text-ink outline-none focus:border-brass"
				style={{ fontSize: 13 }}
			/>
			{match && suggestions.length > 0 && (
				<div
					className="absolute right-0 left-0 z-20 overflow-hidden rounded-lg border border-line bg-card shadow-lg"
					style={{ top: "calc(100% + 4px)" }}
				>
					{suggestions.map((member) => (
						<button
							key={member.id}
							type="button"
							onMouseDown={(event) => event.preventDefault()}
							onClick={() => choose(member)}
							className="flex min-h-11 w-full items-center border-line border-b px-3 text-left font-display font-semibold text-ink last:border-b-0 hover:bg-panel-2"
							style={{ fontSize: 12.5 }}
						>
							@{member.name}
						</button>
					))}
				</div>
			)}
			<div className="mt-1.5 flex items-center gap-2">
				<span className="min-w-0 flex-1 font-body text-ink-3" style={{ fontSize: 10.5 }}>
					{t("detail.mentionHint")}
				</span>
				{onCancel && (
					<button
						type="button"
						onClick={onCancel}
						className="min-h-11 rounded-lg px-3 font-display font-semibold text-ink-3 hover:bg-panel-2"
						style={{ fontSize: 11.5 }}
					>
						{t("common.cancel")}
					</button>
				)}
				<button
					type="button"
					disabled={!value.trim() || busy}
					onClick={() => void submit()}
					className="min-h-11 rounded-lg bg-brass px-3 font-display font-semibold text-white disabled:opacity-50"
					style={{ fontSize: 11.5 }}
				>
					{busy ? t("common.saving") : submitLabel}
				</button>
			</div>
		</div>
	);
}
