import { insertMentionToken, mentionMatchAt, selectedMentionIds } from "./commentMentions";

const check = (condition: unknown, label: string) => {
	if (!condition) throw new Error(label);
};

const match = mentionMatchAt("Prosím @Pet");
check(match?.query === "Pet", "rozpozná rozepsanou zmínku");
if (!match) throw new Error("zmínka chybí");
const inserted = insertMentionToken("Prosím @Pet", match, "Petra Nováková");
check(inserted.value === "Prosím @Petra Nováková ", "vloží celé jméno");
check(mentionMatchAt("mail@example.com") === null, "e-mail není zmínka");
check(mentionMatchAt("@Petra, hotovo") === null, "uzavřená zmínka znovu neotevře nabídku");
check(
	selectedMentionIds(
		"@Petra Nováková prosím",
		["petra", "tomas"],
		[
			{ id: "petra", name: "Petra Nováková" },
			{ id: "tomas", name: "Tomáš Marek" },
		],
	).join(",") === "petra",
	"odebraná zmínka se neodešle",
);

console.log("commentMentions: parsing, insertion and stable targets passed");
