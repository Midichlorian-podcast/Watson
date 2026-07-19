/** Provider timeout musí být od běžného upstream selhání rozlišitelný pro retry i SLO. */
export function providerFailureStatus(error: unknown): 502 | 504 {
	if (!(error instanceof Error)) return 502;
	const signature = `${error.name} ${error.message}`;
	return /timeout|timed out/i.test(signature) ? 504 : 502;
}
