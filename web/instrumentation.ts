/**
 * Au démarrage du serveur (F-076) : le flux des lancements, le guetteur (Final stretch, Migrated) et le bulletin des verdicts
 * démarrent tout seuls, sans attendre qu'un visiteur ouvre le site. Sinon, rien n'est suivi ni noté quand personne n'est connecté.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const port = process.env.PORT || "3100";
  const kick = (tries: number) =>
    setTimeout(() => {
      fetch(`http://127.0.0.1:${port}/api/new`).catch(() => tries > 0 && kick(tries - 1));
    }, 4000);
  kick(10);
}
