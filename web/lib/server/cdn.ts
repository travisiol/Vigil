/**
 * Cache partagé de Vercel (CDN) pour les données lues par tout le monde (F-078).
 * Sur Vercel, chaque visite pouvait tomber sur une copie différente du serveur, avec sa propre mémoire :
 * listes différentes d'un rafraîchissement à l'autre, démarrages à froid. Avec ce cache, Vercel garde UNE réponse
 * quelques secondes et la sert à tous ; une seule copie la recalcule en arrière-plan, et reste chaude.
 * En local, l'en-tête est sans effet.
 */
type Handler<C> = (req: Request, ctx: C) => Promise<Response> | Response;
export function cdn<C>(sMaxAge: number, swr: number, handler: Handler<C>): Handler<C> {
  return async (req: Request, ctx: C) => {
    const res = await handler(req, ctx);
    if (res.status === 200 && !res.headers.has("cache-control")) res.headers.set("Cache-Control", `public, max-age=0, s-maxage=${sMaxAge}, stale-while-revalidate=${swr}`);
    return res;
  };
}
