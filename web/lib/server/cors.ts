/**
 * Données publiques en lecture seule : lisibles par l'extension Vigil depuis n'importe quel serveur
 * (en ligne, ou http://localhost pour les tests) `[F-093]`.
 */
type Handler<C> = (req: Request, ctx: C) => Promise<Response> | Response;

export function cors<C>(handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const res = await handler(req, ctx);
    try {
      res.headers.set("Access-Control-Allow-Origin", "*");
      return res;
    } catch {
      // en-têtes figés : on recopie la réponse
      const copy = new Response(res.body, res);
      copy.headers.set("Access-Control-Allow-Origin", "*");
      return copy;
    }
  };
}
