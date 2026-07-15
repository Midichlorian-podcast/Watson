import { useTranslation } from "@watson/i18n";
import { Icon } from "@watson/ui";
import { copyDeepLink, type DeepLinkEntity } from "../lib/deepLink";
import { showToast } from "../lib/toast";

export function CopyLinkButton({
	entity,
	id,
	workspaceId,
	className = "",
}: {
	entity: DeepLinkEntity;
	id: string;
	workspaceId?: string | null;
	className?: string;
}) {
	const { t } = useTranslation();
	const label = t("deepLink.copy");
	return (
		<button
			type="button"
			aria-label={label}
			title={label}
			onClick={async () => {
				const copied = await copyDeepLink(entity, id, workspaceId);
				showToast(t(copied ? "deepLink.copied" : "deepLink.copyFailed"));
			}}
			className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-panel-2 hover:text-ink ${className}`}
		>
			<Icon name="odkaz" size={16} />
		</button>
	);
}
