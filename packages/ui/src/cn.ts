import clsx, { type ClassValue } from "clsx";

/** Drobný helper pro skládání tříd. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
