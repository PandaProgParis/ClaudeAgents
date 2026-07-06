/** Adresse locale annoncée par une commande de fond (serveur de dev…), telle qu'elle apparaît dans sa sortie. */
const LOCAL_URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>)\]]*)?/;

/** Rien n'est deviné : sans adresse écrite par la commande elle-même, pas de lien. */
export function extractLocalUrl(text: string): string | undefined {
  return LOCAL_URL_PATTERN.exec(text)?.[0];
}
