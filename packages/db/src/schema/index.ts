/**
 * Datový model Watsona — agregace všech tabulek.
 * Členěno dle MASTER §4 + §11/§12. Invarianty R1–R9 jsou popsané u jednotlivých tabulek;
 * ty, které nejdou vyjádřit schématem (R1 hloubka, R2/R3 odvozené dokončení, R9 provázání),
 * vynucuje app/sync vrstva — viz komentáře.
 */

export * from "./auth";
export * from "./collab";
export * from "./contacts";
export * from "./enums";
export * from "./flow";
export * from "./goals";
export * from "./lists";
export * from "./meetings";
export * from "./system";
export * from "./task";
export * from "./workspace";
