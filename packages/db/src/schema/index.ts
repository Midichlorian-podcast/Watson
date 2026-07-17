/**
 * Datový model Watsona — agregace všech tabulek.
 * Členěno dle MASTER §4 + §11/§12. Invarianty R1–R9 jsou popsané u jednotlivých tabulek;
 * ty, které nejdou vyjádřit schématem (R1 hloubka, R2/R3 odvozené dokončení, R9 provázání),
 * vynucuje app/sync vrstva — viz komentáře.
 */

export * from "./auth";
export * from "./automation";
export * from "./availability";
export * from "./bookings";
export * from "./collab";
export * from "./contacts";
export * from "./employeeIntegration";
export * from "./enums";
export * from "./flow";
export * from "./goals";
export * from "./imports";
export * from "./intake";
export * from "./knowledge";
export * from "./lists";
export * from "./mail";
export * from "./meetings";
export * from "./polls";
export * from "./projectMilestones";
export * from "./publicApi";
export * from "./structured";
export * from "./system";
export * from "./task";
export * from "./taskAcceptances";
export * from "./workspace";
