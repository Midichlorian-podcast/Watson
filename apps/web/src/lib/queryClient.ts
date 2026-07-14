import { QueryClient } from "@tanstack/react-query";

/**
 * Sdílený QueryClient — vlastní modul, aby ho mohl PowerSync lifecycle
 * (CC-P0-03) vyčistit při změně identity; cache jednoho účtu nesmí
 * přežít do session jiného účtu.
 */
export const queryClient = new QueryClient();
