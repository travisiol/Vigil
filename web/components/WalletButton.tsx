"use client";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useEffect, useRef, useState } from "react";
import { short } from "@/lib/format";

/** "Connect" quand rien n'est connecté, l'adresse courte sinon (copier / changer / déconnecter). */
export default function WalletButton() {
  const { publicKey, wallet, disconnect, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  if (!mounted || !publicKey)
    return (
      <button className="btn btn-main" style={{ height: 40 }} onClick={() => setVisible(true)} disabled={mounted && connecting}>
        {mounted && connecting ? "Connecting…" : "Connect"}
      </button>
    );

  const addr = publicKey.toBase58();
  return (
    <div className="wbtn" ref={ref}>
      <button className="addrbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {wallet?.adapter.icon ? <img src={wallet.adapter.icon} alt="" /> : <i />}
        {short(addr)}
      </button>
      {open && (
        <div className="menu" role="menu">
          <button
            role="menuitem"
            onClick={() =>
              navigator.clipboard.writeText(addr).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              })
            }
          >
            {copied ? "Copied" : "Copy address"}
          </button>
          <button role="menuitem" onClick={() => { setOpen(false); setVisible(true); }}>Change wallet</button>
          <button role="menuitem" onClick={() => { setOpen(false); disconnect(); }}>Disconnect</button>
        </div>
      )}
    </div>
  );
}
