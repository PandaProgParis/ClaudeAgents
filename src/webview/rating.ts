import { starFills } from '../banner';
import { STRINGS, type Locale } from '../i18n';
import type { MarketplaceRating } from '../marketplace';

/**
 * Pose la vraie note du Marketplace sur l'encart de notation : chaque étoile reçoit son remplissage (--fill,
 * dessiné par cards.css sous la classe `rated`) et le nombre de votes s'écrit à gauche des étoiles.
 * Sans note lue, ou sans aucun avis, l'encart garde ses cinq étoiles allumées d'invitation.
 */
export const RATED_CLASS = 'rated';

export function applyRating(banner: Element | null, rating: MarketplaceRating | undefined, locale: Locale): void {
  const stars = banner?.querySelector<HTMLElement>('.stars');
  const votes = banner?.querySelector<HTMLElement>('.votes');
  if (!stars || !votes) {
    return;
  }
  // Écrites de 5 à 1 dans le DOM : on les remet dans l'ordre affiché.
  const displayed = [...stars.querySelectorAll<HTMLElement>('.star')].reverse();
  if (rating === undefined || rating.count === 0) {
    stars.classList.remove(RATED_CLASS);
    displayed.forEach((star) => star.style.removeProperty('--fill'));
    votes.textContent = '';
    votes.removeAttribute('title');
    return;
  }
  const fills = starFills(rating.average);
  displayed.forEach((star, index) => star.style.setProperty('--fill', `${fills[index]}%`));
  stars.classList.add(RATED_CLASS);
  votes.textContent = `(${rating.count})`;
  votes.title = STRINGS[locale].rateVotes(rating.count, rating.average);
}
