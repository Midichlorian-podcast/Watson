// env?. — soubor importují i tsx test skripty mimo Vite (import.meta.env tam není)
export const API_URL = import.meta.env?.VITE_API_URL ?? "http://localhost:8787";
