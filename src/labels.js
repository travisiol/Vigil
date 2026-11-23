import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(readFileSync(path.join(here, 'labels.json'), 'utf8'));

// data/labels.local.json : tes propres labels, fusionnés par-dessus la liste de base.
const localPath = path.join(here, '..', 'data', 'labels.local.json');
let local = {};
if (existsSync(localPath)) {
  try { local = JSON.parse(readFileSync(localPath, 'utf8')); } catch { /* fichier invalide : ignoré */ }
}

export const LABELS = { ...base, ...local };
export const labelOf = (address) => LABELS[address] || null;

// Ajoute ou retire un label local (depuis le tableau de bord) : pris en compte tout de suite et gardé dans data/labels.local.json.
export function setLocalLabel(address, label) {
  let cur = {};
  if (existsSync(localPath)) { try { cur = JSON.parse(readFileSync(localPath, 'utf8')); } catch { cur = {}; } }
  if (label) { cur[address] = label; LABELS[address] = label; } else { delete cur[address]; delete LABELS[address]; if (base[address]) LABELS[address] = base[address]; }
  writeFileSync(localPath, JSON.stringify(cur, null, 2));
}
