"use client";
import { useEffect, useState } from "react";

/**
 * Logo de token qui ne casse jamais : l'initiale s'affiche tout de suite, le vrai logo se pose dessus dès qu'il charge.
 * Le logo passe par le cache de Vigil (/api/img), qui essaie les relais IPFS à notre place et garde l'image :
 * plus de 429 des relais publics, plus de centaines d'erreurs dans la console.
 */
export default function TokenIcon({ src, alt, symbol }: { src: string | null; alt: string; symbol?: string }) {
  const [loaded, setLoaded] = useState(false);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setBroken(false);
  }, [src]);

  const letter = (symbol || alt || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 1).toUpperCase() || "?";
  const https = src?.startsWith("ipfs://") ? `https://ipfs.io/ipfs/${src.slice(7)}` : src;
  const url = https && /^https:\/\//.test(https) ? `/api/img?u=${encodeURIComponent(https)}` : null;
  return (
    <span className="ph ph-letter icon-wrap" aria-hidden={!alt}>
      {letter}
      {url && !broken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={url} src={url} alt={alt} decoding="async" style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoaded(true)} onError={() => setBroken(true)} />
      )}
    </span>
  );
}
