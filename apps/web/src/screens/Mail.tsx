import { MailScreen } from "../mail/MailScreen";

/**
 * Mail — integrovaný mailový klient (handoff 2026-07-10, WatsonMail.dc.html).
 * Demo modul se seed daty; reálný backend = program M1–M3 (files/MAIL_*.md).
 * Stav modulu drží MailProvider v AppLayout (badge v sidebaru žije i mimo route).
 */
export function Mail() {
	return <MailScreen />;
}
