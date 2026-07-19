export type ProgressTask = { completed_at: string | null };

export type TaskProgress = {
	done: number;
	total: number;
	percent: number;
	isComplete: boolean;
};

/** Immediate child progress. A parent remains independently completable (R3). */
export function taskProgress(children: ProgressTask[]): TaskProgress {
	const total = children.length;
	const done = children.filter((child) => Boolean(child.completed_at)).length;
	return {
		done,
		total,
		percent: total === 0 ? 0 : Math.round((done / total) * 100),
		isComplete: total > 0 && done === total,
	};
}

