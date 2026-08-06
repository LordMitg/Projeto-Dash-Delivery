/**
 * Geracao de slug.
 *
 * Extraido de `menuRoutes.ts`, onde era uma funcao local, para ser reaproveitado
 * na criacao de negocios (o slug do tenant e unico e vem do nome informado).
 */

/** Converte "Bebidas Geladas" em "bebidas-geladas". */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    // Remove diacriticos separados pelo NFD.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
