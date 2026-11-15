/**
 * État désactivé commun à tous les boutons : clairement inactif mais lisible
 * (texte ink-soft sur surface-2 : plus de 6:1 en clair comme en sombre).
 * Pas d'opacité : elle donnait un bleu boueux et un texte à 2:1.
 * Jetons pleins uniquement (table de marque : ni color-mix ni classe /NN).
 * Les variantes « disabled: » passent après « hover: » et « active: » dans Tailwind.
 */
const BASE =
  "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-ink-soft disabled:opacity-100 disabled:brightness-100";

/** Bouton qui a déjà une bordure : elle prend la couleur des séparateurs, sans halo. */
export const DISABLED_BORDERED = `${BASE} disabled:border-line disabled:shadow-none`;

/** Bouton sans bordure : liseré intérieur de 2 px (la taille du bouton ne bouge pas). */
export const DISABLED_PLAIN = `${BASE} disabled:shadow-[inset_0_0_0_2px_var(--os-line)]`;
