import "server-only";
import { join } from "node:path";

/**
 * Dossier des données du serveur (mémoire des devs, suivi, bulletin, registre des fees).
 * En local : web/.vigil-data. Sur Vercel, le disque est en lecture seule sauf /tmp (effacé quand l'instance s'arrête) :
 * les données y vivent le temps de l'instance, et tout se reconstruit depuis la blockchain.
 */
export const ON_VERCEL = !!process.env.VERCEL;
export const DATA_DIR = ON_VERCEL ? "/tmp/vigil-data" : join(/* turbopackIgnore: true */ process.cwd(), ".vigil-data");
