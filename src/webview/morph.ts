/**
 * Morph DOM minimal par clé (`data-key`) : synchronise un arbre réel avec l'état cible
 * en réutilisant les nœuds existants au lieu de tout recréer. Préserve l'identité des
 * éléments → les animations CSS continuent, les tooltips natifs restent ouverts et la
 * sélection de texte survit aux rafraîchissements (250 ms).
 */

const TEXT_NODE = 3;

function keyOf(node: Node): string | undefined {
  return node instanceof Element ? (node.getAttribute('data-key') ?? undefined) : undefined;
}

function syncAttributes(current: Element, next: Element): void {
  for (const attr of [...current.attributes]) {
    if (!next.hasAttribute(attr.name)) {
      current.removeAttribute(attr.name);
    }
  }
  for (const attr of [...next.attributes]) {
    if (current.getAttribute(attr.name) !== attr.value) {
      current.setAttribute(attr.name, attr.value);
    }
  }
}

function sameShape(a: Node, b: Node): boolean {
  if (a.nodeType !== b.nodeType) {
    return false;
  }
  return !(a instanceof Element) || !(b instanceof Element) || a.tagName === b.tagName;
}

/** Synchronise un élément (attributs + descendance). */
export function morph(current: Element, next: Element): void {
  syncAttributes(current, next);
  morphChildren(current, next);
}

/** Synchronise uniquement les enfants (pour la racine, dont les attributs ne doivent pas bouger). */
export function morphChildren(current: Element, next: Element): void {
  const keyed = new Map<string, Element>();
  for (const child of [...current.children]) {
    const key = child.getAttribute('data-key');
    if (key) {
      keyed.set(key, child);
    }
  }
  const nextNodes = [...next.childNodes];
  for (let i = 0; i < nextNodes.length; i++) {
    const nextNode = nextNodes[i];
    const existing: Node | undefined = current.childNodes[i];
    const key = keyOf(nextNode);
    const match = key !== undefined ? keyed.get(key) : undefined;
    if (match) {
      keyed.delete(key as string);
      if (existing !== match) {
        current.insertBefore(match, existing ?? null);
      }
      morph(match, nextNode as Element);
    } else if (
      existing !== undefined &&
      key === undefined &&
      keyOf(existing) === undefined &&
      sameShape(existing, nextNode)
    ) {
      if (existing.nodeType === TEXT_NODE) {
        if (existing.nodeValue !== nextNode.nodeValue) {
          existing.nodeValue = nextNode.nodeValue;
        }
      } else if (existing instanceof Element) {
        morph(existing, nextNode as Element);
      }
    } else {
      // Nouveau nœud (ou incompatible) : on insère la version cible ; l'ancien nœud
      // glisse vers la droite et sera réutilisé plus loin ou élagué en fin de passe.
      current.insertBefore(nextNode, existing ?? null);
    }
  }
  while (current.childNodes.length > nextNodes.length) {
    current.removeChild(current.lastChild as Node);
  }
}
