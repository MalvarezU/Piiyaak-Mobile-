/** Normalización para búsqueda: minúsculas + sin tildes (equivale al unaccent() del servidor). */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
